import Dispatch
import Foundation
import XPC

private let serviceName = "com.electron.pi-host-prototype.node-bootstrap"

struct NodeHistoryItem: Codable { let id: String; let text: String }
struct NodeKnowledgeUpdate: Codable { let topic: String; let summary: String; let sourceIDs: [String] }
struct NodeProbePaths: Codable {
    let fakeCredentialPath: String
    let fakeSkillPath: String
    let hostKnowledgePath: String
    let networkProbeURL: String
}
struct NodeBootstrapRequest: Codable {
    let mode: String
    let echo: String?
    let probes: NodeProbePaths?
    let history: [NodeHistoryItem]?
    let hostEndpoint: XPCEndpoint?
}
struct WorkerBootstrapRequest: Codable {
    let mode: String
    let echo: String?
    let probes: NodeProbePaths?
    let history: [NodeHistoryItem]?
}
struct NodeSecurityProbe: Codable {
    let credentialReadDenied: Bool
    let formalSkillReadDenied: Bool
    let hostKnowledgeWriteDenied: Bool
    let networkDenied: Bool
    let credentialReadErrorCode: String?
    let formalSkillReadErrorCode: String?
    let hostKnowledgeWriteErrorCode: String?
    let networkErrorCode: String?
}
struct NodeChildProbe: Codable {
    let started: Bool
    let exitStatus: Int32?
    let workerPID: Int32?
    let security: NodeSecurityProbe?
    let error: String?
}
struct NodeBootstrapReply: Codable {
    let ok: Bool
    let nodeVersion: String
    let workerPID: Int32
    let echo: String?
    let security: NodeSecurityProbe?
    let child: NodeChildProbe?
    let toolNames: [String]?
    let toolEvents: [String]?
    let readHistoryResult: [NodeHistoryItem]?
    let knowledgeUpdate: NodeKnowledgeUpdate?
    let loadedSkills: Int?
    let loadedExtensions: Int?
    let modelProvider: String?
    let processEnvironmentKeys: [String]?
    let modelCalls: [String]?
    let modelError: String?
    let abortObserved: Bool?
    let error: String?
}
struct HostBridgeRequest: Codable {
    let kind: String
    let requestID: String
    let modelID: String?
    let contextJSON: String?
}
struct HostBridgeResponse: Codable {
    let kind: String
    let requestID: String
    let ok: Bool
    let assistantMessageJSON: String?
    let error: String?
}
struct NodeBootstrapResponse: Codable {
    let success: Bool
    let servicePID: Int32
    let workerPID: Int32?
    let nodeVersion: String?
    let echo: String?
    let security: NodeSecurityProbe?
    let child: NodeChildProbe?
    let toolNames: [String]?
    let toolEvents: [String]?
    let readHistoryResult: [NodeHistoryItem]?
    let knowledgeUpdate: NodeKnowledgeUpdate?
    let loadedSkills: Int?
    let loadedExtensions: Int?
    let modelProvider: String?
    let processEnvironmentKeys: [String]?
    let modelCalls: [String]?
    let modelError: String?
    let abortObserved: Bool?
    let error: String?
}

func readLine(_ handle: FileHandle) -> Data? {
    var line = Data()
    while true {
        guard let byte = try? handle.read(upToCount: 1), !byte.isEmpty else {
            return line.isEmpty ? nil : line
        }
        if byte[0] == 0x0a { return line }
        line.append(byte)
    }
}

func failed(_ error: String) -> NodeBootstrapResponse {
    NodeBootstrapResponse(
        success: false,
        servicePID: getpid(),
        workerPID: nil,
        nodeVersion: nil,
        echo: nil,
        security: nil,
        child: nil,
        toolNames: nil,
        toolEvents: nil,
        readHistoryResult: nil,
        knowledgeUpdate: nil,
        loadedSkills: nil,
        loadedExtensions: nil,
        modelProvider: nil,
        processEnvironmentKeys: nil,
        modelCalls: nil,
        modelError: nil,
        abortObserved: nil,
        error: error
    )
}

func startNode(_ request: NodeBootstrapRequest) -> NodeBootstrapResponse {
    let serviceContents = Bundle.main.bundleURL.appendingPathComponent("Contents")
    let nodeURL = serviceContents.appendingPathComponent("MacOS/ReflectionNode")
    let workerURL = serviceContents.appendingPathComponent("Resources/node-bootstrap.mjs")
    guard let hostEndpoint = request.hostEndpoint else { return failed("Missing trusted Host callback endpoint") }

    do {
        let hostSession = try XPCSession(endpoint: hostEndpoint, targetQueue: DispatchQueue.global(qos: .userInitiated))
        let workerRequest = WorkerBootstrapRequest(
            mode: request.mode,
            echo: request.echo,
            probes: request.probes,
            history: request.history
        )
        let encoded = try JSONEncoder().encode(workerRequest).base64EncodedString()
        let process = Process()
        process.executableURL = nodeURL
        process.arguments = [workerURL.path, encoded]
        let inheritedEnvironment = ProcessInfo.processInfo.environment
        process.environment = [
            "PATH": "/usr/bin:/bin",
            "TMPDIR": inheritedEnvironment["TMPDIR"] ?? "/tmp",
            "PI_OFFLINE": "1",
            "PI_SKIP_VERSION_CHECK": "1",
            "PI_TELEMETRY": "0",
            "TD12_XPC_SERVICE_PID": String(getpid()),
        ]

        let stdout = Pipe()
        let stderr = Pipe()
        let stdin = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()

        let writeLock = NSLock()
        let outstanding = DispatchGroup()
        func writeToWorker(_ response: HostBridgeResponse) {
            guard let data = try? JSONEncoder().encode(response) + Data([0x0a]) else { return }
            writeLock.lock()
            defer { writeLock.unlock() }
            guard process.isRunning else { return }
            try? stdin.fileHandleForWriting.write(contentsOf: data)
        }
        var workerReply: NodeBootstrapReply?
        while let line = readLine(stdout.fileHandleForReading) {
            guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if let kind = object["kind"] as? String, kind == "model_request" || kind == "model_cancel" {
                guard let message = try? JSONDecoder().decode(HostBridgeRequest.self, from: line) else { continue }
                outstanding.enter()
                do {
                    try hostSession.send(message) { (result: Result<HostBridgeResponse, any Error>) in
                        defer { outstanding.leave() }
                        switch result {
                        case .success(let hostResponse):
                            if message.kind == "model_request" {
                                writeToWorker(HostBridgeResponse(
                                    kind: "model_response",
                                    requestID: message.requestID,
                                    ok: hostResponse.ok,
                                    assistantMessageJSON: hostResponse.assistantMessageJSON,
                                    error: hostResponse.error
                                ))
                            }
                        case .failure(let error):
                            if message.kind == "model_request" {
                                writeToWorker(HostBridgeResponse(
                                    kind: "model_response",
                                    requestID: message.requestID,
                                    ok: false,
                                    assistantMessageJSON: nil,
                                    error: "host_xpc_failed: \(error)"
                                ))
                            }
                        }
                    }
                } catch {
                    outstanding.leave()
                    if message.kind == "model_request" {
                        writeToWorker(HostBridgeResponse(
                            kind: "model_response",
                            requestID: message.requestID,
                            ok: false,
                            assistantMessageJSON: nil,
                            error: "host_xpc_failed: \(error)"
                        ))
                    }
                }
                continue
            }
            workerReply = try? JSONDecoder().decode(NodeBootstrapReply.self, from: line)
            if workerReply != nil { break }
        }
        process.waitUntilExit()
        _ = outstanding.wait(timeout: .now() + 2)
        hostSession.cancel(reason: "Reflection Worker completed")
        stdin.fileHandleForWriting.closeFile()
        let diagnostics = stdout.fileHandleForReading.readDataToEndOfFile()
        let stderrText = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0, let reply = workerReply else {
            return failed(stderrText.isEmpty ? String(data: diagnostics, encoding: .utf8) ?? "Node exited \(process.terminationStatus)" : stderrText)
        }
        return NodeBootstrapResponse(
            success: reply.ok,
            servicePID: getpid(),
            workerPID: reply.workerPID,
            nodeVersion: reply.nodeVersion,
            echo: reply.echo,
            security: reply.security,
            child: reply.child,
            toolNames: reply.toolNames,
            toolEvents: reply.toolEvents,
            readHistoryResult: reply.readHistoryResult,
            knowledgeUpdate: reply.knowledgeUpdate,
            loadedSkills: reply.loadedSkills,
            loadedExtensions: reply.loadedExtensions,
            modelProvider: reply.modelProvider,
            processEnvironmentKeys: reply.processEnvironmentKeys,
            modelCalls: reply.modelCalls,
            modelError: reply.modelError,
            abortObserved: reply.abortObserved,
            error: reply.error
        )
    } catch {
        return failed(String(describing: error))
    }
}

let listener = try XPCListener(service: serviceName) { incoming in
    incoming.accept { (request: NodeBootstrapRequest) -> NodeBootstrapResponse in
        startNode(request)
    }
}
_ = listener
dispatchMain()
