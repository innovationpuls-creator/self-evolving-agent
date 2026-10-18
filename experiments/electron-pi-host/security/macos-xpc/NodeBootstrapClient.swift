import Darwin
import Dispatch
import Foundation
import XPC

struct NodeBootstrapRequest: Codable {
    let mode: String
    let echo: String?
    let probes: NodeProbePaths?
    let history: [NodeHistoryItem]?
    var hostEndpoint: XPCEndpoint?
}

struct NodeHistoryItem: Codable { let id: String; let text: String }
struct NodeKnowledgeUpdate: Codable { let topic: String; let summary: String; let sourceIDs: [String] }
struct NodeProbePaths: Codable {
    let fakeCredentialPath: String
    let fakeSkillPath: String
    let hostKnowledgePath: String
    let networkProbeURL: String
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
struct HostBridgeEvent: Encodable {
    let kind = "host_bridge_request"
    let request: HostBridgeRequest
}
struct ClientOutput: Encodable {
    let kind = "result"
    let response: NodeBootstrapResponse
}

final class PendingResponses: @unchecked Sendable {
    private let condition = NSCondition()
    private var responses: [String: HostBridgeResponse] = [:]

    func resolve(_ response: HostBridgeResponse) {
        condition.lock()
        responses["\(response.kind):\(response.requestID)"] = response
        condition.broadcast()
        condition.unlock()
    }

    func wait(kind: String, requestID: String) -> HostBridgeResponse {
        let key = "\(kind):\(requestID)"
        let deadline = Date().addingTimeInterval(15)
        condition.lock()
        defer { condition.unlock() }
        while responses[key] == nil && condition.wait(until: deadline) {
            // Wait for the trusted Host to answer this one typed model request.
        }
        return responses.removeValue(forKey: key) ?? HostBridgeResponse(
            kind: kind,
            requestID: requestID,
            ok: false,
            assistantMessageJSON: nil,
            error: "host_model_response_timeout"
        )
    }
}

let outputLock = NSLock()
func writeJSONLine<T: Encodable>(_ value: T) throws {
    let encoded = try JSONEncoder().encode(value) + Data([0x0a])
    outputLock.lock()
    defer { outputLock.unlock() }
    FileHandle.standardOutput.write(encoded)
}

func readInputLine() -> String? {
    var bytes: [UInt8] = []
    while true {
        var byte: UInt8 = 0
        let count = Darwin.read(STDIN_FILENO, &byte, 1)
        if count <= 0 { return bytes.isEmpty ? nil : String(decoding: bytes, as: UTF8.self) }
        if byte == 0x0a { return String(decoding: bytes, as: UTF8.self) }
        bytes.append(byte)
    }
}

func serviceArgument() -> String {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: "--service"), args.indices.contains(index + 1) else {
        return "com.electron.pi-host-prototype.node-bootstrap"
    }
    return args[index + 1]
}

do {
    guard let firstLine = readInputLine(), let input = firstLine.data(using: .utf8) else {
        throw NSError(domain: "TD13Client", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing initial XPC request"])
    }
    var request = try JSONDecoder().decode(NodeBootstrapRequest.self, from: input)
    let pending = PendingResponses()
    let listener = XPCListener(targetQueue: DispatchQueue.global(qos: .userInitiated)) { incoming in
        incoming.accept { (hostRequest: HostBridgeRequest) -> HostBridgeResponse in
            do { try writeJSONLine(HostBridgeEvent(request: hostRequest)) }
            catch { return HostBridgeResponse(kind: hostRequest.kind, requestID: hostRequest.requestID, ok: false, assistantMessageJSON: nil, error: "host_event_write_failed") }
            let responseKind = hostRequest.kind == "model_request" ? "model_response" : hostRequest.kind
            return pending.wait(kind: responseKind, requestID: hostRequest.requestID)
        }
    }
    request.hostEndpoint = listener.endpoint

    DispatchQueue.global(qos: .userInitiated).async {
        while let line = readInputLine(), let data = line.data(using: .utf8) {
            if let response = try? JSONDecoder().decode(HostBridgeResponse.self, from: data) {
                pending.resolve(response)
            }
        }
    }

    let session = try XPCSession(xpcService: serviceArgument())
    let response: NodeBootstrapResponse = try session.sendSync(request)
    session.cancel(reason: "XPC Reflection request completed")
    try writeJSONLine(ClientOutput(response: response))
    if !response.success { exit(EXIT_FAILURE) }
} catch {
    fputs("XPC bootstrap request failed: \(error)\n", stderr)
    exit(EXIT_FAILURE)
}
