import Foundation
import Virtualization
import Darwin

// Public API feasibility comparison: owned disposable file, no VM launch.
// Its result is not a complete storage-confidentiality or lifecycle proof.
let directory = CommandLine.arguments.count > 1
    ? URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    : FileManager.default.temporaryDirectory
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let file = directory.appendingPathComponent("attachment-\(UUID().uuidString).img")
let fd = open(file.path, O_RDWR | O_CREAT | O_EXCL, 0o600)
guard fd >= 0 else { fatalError("exclusive fixture creation failed") }
guard ftruncate(fd, 2 * 1024 * 1024) == 0 else { fatalError("fixture sizing failed") }
guard unlink(file.path) == 0 else { fatalError("fixture unlink failed") }
let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
defer { close(fd) }
var results: [String: Any] = ["admission": false, "vmStarted": false,
    "scope": "public native VZ attachment feasibility with unlinked regular file",
    "creationWindowProtected": false]
do {
    let attachment = try VZDiskBlockDeviceStorageDeviceAttachment(
        fileHandle: handle, readOnly: false, synchronizationMode: .full)
    results["regularFileHandleAttachment"] = String(describing: type(of: attachment))
} catch { results["regularFileHandleRejected"] = String(describing: error) }
do {
    let attachment = try VZDiskImageStorageDeviceAttachment(
        url: URL(fileURLWithPath: "/dev/fd/\(fd)"), readOnly: false,
        cachingMode: .uncached, synchronizationMode: .full)
    results["unlinkedFDImageAttachment"] = String(describing: type(of: attachment))
} catch { results["unlinkedFDImageRejected"] = String(describing: error) }
print(String(data: try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]), encoding: .utf8)!)
