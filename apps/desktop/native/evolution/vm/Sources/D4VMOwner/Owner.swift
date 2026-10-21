import Containerization
import ContainerizationOS
import CryptoKit
import Foundation
import Virtualization
import Darwin

private enum ProbeError: Error { case configuration, cancelled, outputLimit, cleanupFailed }

private enum Wire {
    static let lock = NSLock()
    static func send(_ value: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

private final class OutputBudget: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func consume(_ data: Data, _ stream: String) throws {
        lock.lock()
        defer { lock.unlock() }
        guard data.count <= 4 * 1024 * 1024 - count else { throw ProbeError.outputLimit }
        count += data.count
        for offset in stride(from: 0, to: data.count, by: 32768) {
            Wire.send(["kind": "output", "stream": stream,
                       "base64": data.subdata(in: offset..<min(offset + 32768, data.count)).base64EncodedString()])
        }
    }
}

private final class Output: Writer, @unchecked Sendable {
    let budget: OutputBudget
    let stream: String
    let exceeded: @Sendable () -> Void
    init(_ budget: OutputBudget, _ stream: String, _ exceeded: @escaping @Sendable () -> Void) {
        self.budget = budget; self.stream = stream; self.exceeded = exceeded
    }
    func write(_ data: Data) throws {
        do { try budget.consume(data, stream) } catch { exceeded(); throw error }
    }
    func close() throws {}
}

private final class Input: ReaderStream, Sendable {
    let values: AsyncStream<Data>
    let continuation: AsyncStream<Data>.Continuation
    init() {
        let pair = AsyncStream<Data>.makeStream(bufferingPolicy: .bufferingOldest(8))
        values = pair.stream; continuation = pair.continuation
    }
    func stream() -> AsyncStream<Data> { values }
}

private struct Configuration: Decodable, Sendable {
    let activityId: String
    let kernel: String
    let initfs: String
    let rootfs: String
    let arguments: [String]
    let deadlineSeconds: Int
    let store: String?
    let initImage: String?
    let image: String?
    let nodeExecutable: String?
    let runtimeArchive: String?
    func validate() throws {
        guard UUID(uuidString: activityId) != nil,
              kernel.hasPrefix("/"), initfs.hasPrefix("/"), rootfs.hasPrefix("/"),
              !arguments.isEmpty, arguments.count <= 128,
              arguments.reduce(0, { $0 + $1.utf8.count }) <= 65536,
              (1...300).contains(deadlineSeconds) else { throw ProbeError.configuration }
    }
}

private actor Lifetime {
    private var container: LinuxContainer?
    private var revoked = false
    private var closing = false
    private var stopTask: Task<Void, Never>?
    private var cleanupFailed = false
    private let id: String
    init(_ id: String) { self.id = id }
    func run(_ vm: LinuxContainer, nodeExecutable: String?, runtimeArchive: String?) async throws {
        guard !revoked else { throw ProbeError.cancelled }
        container = vm
        do {
            try await vm.create()
            guard !revoked else { throw ProbeError.cancelled }
            try await vm.start()
            guard !revoked else { throw ProbeError.cancelled }
            if let nodeExecutable {
                guard nodeExecutable.hasPrefix("/") else { throw ProbeError.configuration }
                try await vm.copyIn(from: URL(fileURLWithPath: nodeExecutable),
                                    to: URL(fileURLWithPath: "/usr/local/bin/node"), mode: 0o755)
                guard !revoked else { throw ProbeError.cancelled }
            }
            if let runtimeArchive {
                guard runtimeArchive.hasPrefix("/") else { throw ProbeError.configuration }
                try await vm.copyIn(from: URL(fileURLWithPath: runtimeArchive),
                                    to: URL(fileURLWithPath: "/opt/d4-runtime.tar"))
                let unpack = try await vm.exec("bootstrap") { process in
                    process.arguments = ["/bin/tar", "--no-same-owner", "-xf", "/opt/d4-runtime.tar", "-C", "/opt"]
                    process.capabilities = .init(capabilities: [])
                    process.noNewPrivileges = true
                    process.stderr = Output(OutputBudget(), "stderr", {})
                }
                try await unpack.start()
                let unpackStatus = try await unpack.wait()
                Wire.send(["kind": "bootstrapExit", "exitCode": unpackStatus.exitCode])
                guard unpackStatus.exitCode == 0 else { throw ProbeError.configuration }
                // This sentinel is written through the trusted management plane.
                let sentinel = try await vm.exec("bootstrap-ready") { process in
                    process.arguments = ["/usr/bin/touch", "/opt/runtime/ready"]
                    process.capabilities = .init(capabilities: [])
                    process.noNewPrivileges = true
                }
                try await sentinel.start()
                guard try await sentinel.wait().exitCode == 0 else { throw ProbeError.configuration }
            }
            Wire.send(["kind": "ready", "activityId": id, "ownerPid": getpid()])
            let sampler = Task {
                while !Task.isCancelled {
                    if let stats = try? await vm.statistics() {
                        var values: [String: Any] = ["kind": "statistics", "activityId": id]
                        if let p = stats.process { values["tasks"] = p.current; values["tasksLimit"] = p.limit }
                        if let m = stats.memory { values["memoryBytes"] = m.usageBytes; values["memoryLimit"] = m.limitBytes }
                        if let c = stats.cpu { values["cpuUsec"] = c.usageUsec; values["throttledUsec"] = c.throttledTimeUsec }
                        if let e = stats.memoryEvents { values["oomKill"] = e.oomKill; values["oom"] = e.oom }
                        Wire.send(values)
                    }
                    do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                }
            }
            defer { sampler.cancel() }
            let status = try await vm.wait()
            if let final = try? await vm.statistics(categories: .memoryEvents), let e = final.memoryEvents {
                Wire.send(["kind": "finalMemoryEvents", "activityId": id, "oomKill": e.oomKill, "oom": e.oom])
            }
            Wire.send(["kind": "workloadExited", "activityId": id, "exitCode": status.exitCode])
            await stop("workload_exit")
            if cleanupFailed { throw ProbeError.cleanupFailed }
        } catch {
            await stop("execution_error")
            throw error
        }
    }
    func stop(_ reason: String) async {
        revoked = true
        if let stopTask { await stopTask.value; return }
        guard !closing else { return }
        closing = true
        let vm = container
        let id = id
        let task = Task {
            let watchdog = Task.detached {
                try? await Task.sleep(for: .seconds(5))
                if !Task.isCancelled { Darwin._exit(124) }
            }
            defer { watchdog.cancel() }
            do {
                if let vm { try await vm.stop() }
                Wire.send(["kind": vm == nil ? "notCreated" : "stopReturned", "activityId": id,
                           "reason": reason, "ownerPid": getpid()])
            } catch {
                self.cleanupFailed = true
                Wire.send(["kind": "stopFailed", "activityId": id, "reason": reason])
            }
        }
        stopTask = task
        await task.value
    }
}

@main
struct Owner {
    static func main() async {
        do { try await run() }
        catch {
            Wire.send(["kind": "error", "code": "d4_vm_probe_failed", "diagnostic": String(describing: error)])
            Darwin.exit(1)
        }
    }
    private static func run() async throws {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--capabilities"] {
            Wire.send(["protocol": 1, "sdk": "0.52.1", "virtualizationSupported": VZVirtualMachine.isSupported,
                       "executionAdmission": false])
            return
        }
        // Experimental entry only. Not connected to Skill publication or the
        // normal product Tool surface. Its caller must be the trusted harness.
        guard args.count == 2, ["--prepare", "--probe"].contains(args[0]) else { throw ProbeError.configuration }
        let configFile = try FileHandle(forReadingFrom: URL(fileURLWithPath: args[1]))
        defer { try? configFile.close() }
        let bytes = try configFile.read(upToCount: 131073) ?? Data()
        guard bytes.count <= 131072 else { throw ProbeError.configuration }
        let c = try JSONDecoder().decode(Configuration.self, from: bytes)
        try c.validate()
        let kernel = Kernel(path: URL(fileURLWithPath: c.kernel), platform: .linuxArm)
        if args[0] == "--prepare" {
            guard let store = c.store, store.hasPrefix("/"), let initImage = c.initImage, let ref = c.image,
                  initImage.contains("@sha256:"), ref.contains("@sha256:") else { throw ProbeError.configuration }
            var manager = try await ContainerManager(kernel: kernel, initfsReference: initImage,
                                                     root: URL(fileURLWithPath: store), network: nil)
            let image = try await manager.imageStore.get(reference: ref, pull: true)
            let vm = try await manager.create(c.activityId, image: image,
                rootfsSizeInBytes: 2 * 1024 * 1024 * 1024, networking: false) { _ in }
            Wire.send(["kind": "prepared", "activityId": c.activityId, "rootfs": vm.rootfs.source,
                       "initfs": URL(fileURLWithPath: store).appendingPathComponent("initfs.ext4").path,
                       "imageDigest": image.digest])
            return
        }
        guard VZVirtualMachine.isSupported else { throw ProbeError.configuration }
        let diskLease = open(c.rootfs, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
        guard diskLease >= 0 else { throw ProbeError.configuration }
        defer { close(diskLease) }
        var disk = stat()
        guard fstat(diskLease, &disk) == 0, disk.st_mode & S_IFMT == S_IFREG,
              disk.st_size == 2 * 1024 * 1024 * 1024, disk.st_uid == getuid() else { throw ProbeError.configuration }
        // VZDiskImageStorageDeviceAttachment acquires the actual image lock.
        // A separate flock here prevents VZ itself from attaching the disk.
        let root = Mount.block(format: "ext4", source: c.rootfs, destination: "/", options: [])
        let initial = Mount.block(format: "ext4", source: c.initfs, destination: "/", options: ["ro"])
        let manager = VZVirtualMachineManager(kernel: kernel, initialFilesystem: initial)
        let lifetime = Lifetime(c.activityId)
        let budget = OutputBudget()
        let input = Input()
        guard let launcherURL = Bundle.module.url(forResource: "guest-launcher", withExtension: "py") else {
            throw ProbeError.configuration
        }
        let launcher = try String(contentsOf: launcherURL, encoding: .utf8)
        let launcherHash = SHA256.hash(data: Data(launcher.utf8)).map { String(format: "%02x", $0) }.joined()
        guard launcherHash == "7617cd8697b8b2a211a55370191efa2a45cb8660c55ac68110cf61ba7ff6f8dc" else {
            throw ProbeError.configuration
        }
        let cancel: @Sendable () -> Void = { Task { await lifetime.stop("output_limit") } }
        let container = try LinuxContainer(c.activityId, rootfs: root, vmm: manager,
            vm: VMResources(cpus: 2, memoryInBytes: 1024 * 1024 * 1024 + VMResources.guestMemoryOverhead)) { config in
            config.cpus = 1
            config.memoryInBytes = 1024 * 1024 * 1024
            config.interfaces = []; config.sockets = []; config.virtualization = false
            config.unified = ["pids.max": "128", "memory.swap.max": "0", "memory.oom.group": "1"]
            config.process.arguments = ["/usr/local/bin/python3", "-c", launcher] + c.arguments
            config.process.workingDirectory = "/tmp"
            config.process.user = .init(uid: 1000, gid: 1000)
            config.process.capabilities = .init(capabilities: [])
            config.process.noNewPrivileges = true
            config.process.environmentVariables = ["PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "TMPDIR=/tmp"]
            config.process.stdout = Output(budget, "stdout", cancel)
            config.process.stderr = Output(budget, "stderr", cancel)
            config.process.stdin = input
        }
        let eof = Task {
            var count = 0
            var buffer = Data()
            do {
                for try await byte in FileHandle.standardInput.bytes {
                    count += 1
                    guard count <= 32 * 1024 * 1024, buffer.count < 65536 else {
                        await lifetime.stop("input_limit"); return
                    }
                    buffer.append(byte)
                    if byte == 10 {
                        if case .dropped = input.continuation.yield(buffer) {
                            await lifetime.stop("input_backpressure"); return
                        }
                        buffer.removeAll(keepingCapacity: true)
                    }
                }
            } catch {}
            input.continuation.finish()
            await lifetime.stop("host_eof")
        }
        let timeout = Task {
            do { try await Task.sleep(for: .seconds(c.deadlineSeconds)) } catch { return }
            await lifetime.stop("deadline")
        }
        defer { eof.cancel(); timeout.cancel() }
        try await lifetime.run(container, nodeExecutable: c.nodeExecutable, runtimeArchive: c.runtimeArchive)
    }
}
