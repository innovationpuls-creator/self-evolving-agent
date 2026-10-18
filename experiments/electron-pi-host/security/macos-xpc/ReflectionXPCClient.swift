import Foundation
import XPC

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

func serviceArgument() -> String {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: "--service"), args.indices.contains(index + 1) else {
        return "com.electron.pi-host-prototype.reflection"
    }
    return args[index + 1]
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONDecoder().decode(ProbeRequest.self, from: input)
    let session = try XPCSession(xpcService: serviceArgument())
    let response: ProbeResponse = try session.sendSync(request)
    let output = try JSONEncoder().encode(response)
    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data([0x0a]))
    if !response.success { exit(EXIT_FAILURE) }
} catch {
    fputs("XPC request failed: \(error)\n", stderr)
    exit(EXIT_FAILURE)
}
