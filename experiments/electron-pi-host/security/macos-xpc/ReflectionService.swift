import Foundation
import XPC
import Dispatch

private let serviceName = "com.electron.pi-host-prototype.reflection"

struct HistoryItem: Codable {
    let id: String
    let text: String
}

struct ProbeRequest: Codable {
    let history: [HistoryItem]
    let fakeCredentialPath: String
    let fakeSkillPath: String
    let hostKnowledgePath: String
    let networkProbeURL: String
}

struct ProbeResponse: Codable {
    let success: Bool
    let servicePID: Int32
    let workerPID: Int32?
    let nodeVersion: String?
    let electronVersion: String?
    let toolNames: [String]
    let toolEvents: [String]
    let readHistoryResult: [HistoryItem]
    let knowledgeUpdate: KnowledgeUpdate?
    let security: SecurityProbe
    let error: String?
}

struct KnowledgeUpdate: Codable {
    let topic: String
    let summary: String
    let sourceIDs: [String]
}

struct SecurityProbe: Codable {
    let credentialReadDenied: Bool
    let formalSkillReadDenied: Bool
    let hostKnowledgeWriteDenied: Bool
    let networkDenied: Bool
    let childNodeStarted: Bool
    let childCredentialReadDenied: Bool
    let childKnowledgeWriteDenied: Bool
    let childNetworkDenied: Bool
}

func bridgeContentsURL() -> URL {
    Bundle.main.bundleURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}

func runWorker(_ request: ProbeRequest) -> ProbeResponse {
    let bridgeContents = bridgeContentsURL()
    let appContents = bridgeContents
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let serviceContents = Bundle.main.bundleURL.appendingPathComponent("Contents")
    let nodeURL = serviceContents.appendingPathComponent("MacOS/ReflectionNode")
    let workerURL = appContents.appendingPathComponent("Resources/app.asar/security/macos-xpc/worker.mjs")

    do {
        let encoded = try JSONEncoder().encode(request).base64EncodedString()
        let process = Process()
        process.executableURL = nodeURL
        process.arguments = [workerURL.path, encoded]
        process.environment = ProcessInfo.processInfo.environment.merging([
            "ELECTRON_RUN_AS_NODE": "1",
            "TD12_XPC_SERVICE_PID": String(getpid()),
        ]) { _, new in new }

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()

        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let diagnostics = stderr.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let message = String(data: diagnostics, encoding: .utf8) ?? "worker exited \(process.terminationStatus)"
            return failed(message)
        }
        return try JSONDecoder().decode(ProbeResponse.self, from: output)
    } catch {
        return failed(String(describing: error))
    }
}

func failed(_ message: String) -> ProbeResponse {
    ProbeResponse(
        success: false,
        servicePID: getpid(),
        workerPID: nil,
        nodeVersion: nil,
        electronVersion: nil,
        toolNames: [],
        toolEvents: [],
        readHistoryResult: [],
        knowledgeUpdate: nil,
        security: SecurityProbe(
            credentialReadDenied: false,
            formalSkillReadDenied: false,
            hostKnowledgeWriteDenied: false,
            networkDenied: false,
            childNodeStarted: false,
            childCredentialReadDenied: false,
            childKnowledgeWriteDenied: false,
            childNetworkDenied: false
        ),
        error: message
    )
}

let listener = try XPCListener(service: serviceName) { incoming in
    incoming.accept { (request: ProbeRequest) -> ProbeResponse in
        runWorker(request)
    }
}

_ = listener
dispatchMain()
