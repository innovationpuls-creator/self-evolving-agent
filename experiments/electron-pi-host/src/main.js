import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxToolCall,
  fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const appRoot = app.getAppPath();
const smokeTest = process.argv.includes("--smoke-test");
const sandboxSmokeTest = process.argv.includes("--sandbox-smoke-test");
const nodeBootstrapSmokeTest = process.argv.includes("--node-bootstrap-smoke-test");
const nodePermissionSmokeTest = process.argv.includes("--node-permission-smoke-test");
const nodePiSmokeTest = process.argv.includes("--node-pi-smoke-test");
const hostId = randomUUID();
const hostState = {
  session: undefined,
  faux: undefined,
  activeTools: [],
  extensionNames: [],
  busy: false,
  server: undefined,
  port: undefined,
  origin: undefined,
  window: undefined,
  tray: undefined,
  quitting: false,
};

const userDataOverride = process.env.PI_HOST_DATA_DIR;
if (userDataOverride) app.setPath("userData", path.resolve(userDataOverride));

function appResource(...segments) {
  return path.join(appRoot, ...segments);
}

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readRequestJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error("Request body exceeds 4096 bytes");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function createPiHost() {
  const dataRoot = app.getPath("userData");
  const workspace = path.join(dataRoot, "workspace");
  const agentDir = path.join(dataRoot, "pi-agent");
  await mkdir(workspace, { recursive: true });
  await mkdir(agentDir, { recursive: true });

  const fixture = path.join(workspace, "read-me.txt");
  await writeFile(fixture, await readFile(appResource("fixtures", "read-me.txt")), "utf8");

  const faux = fauxProvider({ provider: "faux", api: "faux" });
  const model = faux.getModel();
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);

  const extensionPath = appResource("extensions", "reflection-probe.js");
  const resourceLoader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    additionalExtensionPaths: [extensionPath],
  });
  await resourceLoader.reload();

  const { session, extensionsResult } = await createAgentSession({
    cwd: workspace,
    agentDir,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(workspace),
    tools: ["read", "reflection_probe"],
  });

  hostState.session = session;
  hostState.faux = faux;
  hostState.activeTools = session.getActiveToolNames();
  hostState.extensionNames = (extensionsResult.extensions ?? []).map((extension) => extension.name ?? extension.path ?? "unknown");

  return { fixture };
}

function collectToolExecutionEvents(session) {
  const events = [];
  const unsubscribe = session.subscribe((event) => {
    if (!event.type.startsWith("tool_execution_")) return;
    events.push({
      type: event.type,
      toolName: event.toolName ?? event.name ?? event.toolCall?.name ?? null,
      toolCallId: event.toolCallId ?? null,
    });
  });
  return { events, unsubscribe };
}

async function runScenario(scenario, fixture) {
  if (hostState.busy) {
    const error = new Error("The shared Pi session is busy");
    error.statusCode = 409;
    throw error;
  }
  if (scenario !== "builtin-read" && scenario !== "extension") {
    const error = new Error("Unknown prototype scenario");
    error.statusCode = 400;
    throw error;
  }

  hostState.busy = true;
  const toolName = scenario === "builtin-read" ? "read" : "reflection_probe";
  const toolArgs = scenario === "builtin-read"
    ? { file_path: fixture }
    : { note: "loaded-from-app-bundle" };
  const { events, unsubscribe } = collectToolExecutionEvents(hostState.session);

  hostState.faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall(toolName, toolArgs),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage(`faux-finished:${toolName}`),
  ]);

  try {
    await hostState.session.prompt(`Run the ${toolName} tool for the prototype check.`);
    return {
      hostId,
      pid: process.pid,
      scenario,
      activeTools: hostState.activeTools,
      toolEvents: events,
      assistantText: hostState.session.getLastAssistantText(),
      pendingFauxResponses: hostState.faux.getPendingResponseCount(),
    };
  } finally {
    unsubscribe();
    hostState.busy = false;
  }
}

function callReflectionXpcClient(payload, serviceName, handleHostBridgeRequest, timeoutMs = 30_000) {
  const helper = path.resolve(process.resourcesPath, "..", "Helpers", "ReflectionBridge.app", "Contents", "MacOS", "reflection-xpc-client");
  const args = serviceName ? ["--service", serviceName] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(helper, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stderr = [];
    let settled = false;
    let response;
    let hostBridgeRequests = 0;
    let hostBridgeReplies = 0;
    let resultEvents = 0;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`XPC client exceeded ${timeoutMs} milliseconds (hostBridgeRequests=${hostBridgeRequests}, hostBridgeReplies=${hostBridgeReplies}, resultEvents=${resultEvents})`));
    }, timeoutMs);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.kind === "host_bridge_request") {
        hostBridgeRequests += 1;
        const responseKind = event.request?.kind === "model_request"
          ? "model_response"
          : event.request?.kind ?? "model_request";
        Promise.resolve(handleHostBridgeRequest?.(event.request) ?? {
          kind: responseKind,
          requestID: event.request?.requestID ?? "missing-request-id",
          ok: false,
          error: "host_model_channel_unavailable",
        }).then((reply) => {
          if (!settled) {
            hostBridgeReplies += 1;
            child.stdin.write(`${JSON.stringify(reply)}\n`);
          }
        }, (error) => {
          if (!settled) {
            hostBridgeReplies += 1;
            child.stdin.write(`${JSON.stringify({
              kind: responseKind,
              requestID: event.request?.requestID ?? "missing-request-id",
              ok: false,
              error: serializeError(error),
            })}\n`);
          }
        });
      } else if (event.kind === "result") {
        resultEvents += 1;
        response = event.response;
        child.stdin.end();
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const details = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(`Reflection XPC client exited ${code ?? signal}: ${details || JSON.stringify(response)}`));
        return;
      }
      if (!response) reject(new Error("Reflection XPC client returned no result event"));
      else resolve(response);
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

async function runMacOsSandboxSmoke(fixture) {
  const root = path.join(app.getPath("userData"), `td12-canaries-${process.pid}`);
  const credentialPath = path.join(root, "host-credentials", "fake-credential.json");
  const skillPath = path.join(root, "formal-skills", "example", "SKILL.md");
  const knowledgePath = path.join(root, "host-knowledge", "knowledge.json");
  const history = [
    { id: "history-1", text: "The learner prefers short explanations with source-linked notes." },
    { id: "history-2", text: "The learner asked to keep generated memory updates reviewable." },
  ];
  const historyIds = new Set(history.map((item) => item.id));
  await Promise.all([
    mkdir(path.dirname(credentialPath), { recursive: true }),
    mkdir(path.dirname(skillPath), { recursive: true }),
    mkdir(path.dirname(knowledgePath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(credentialPath, JSON.stringify({ kind: "fake-test-credential", value: "not-a-real-secret" }), { mode: 0o600 }),
    writeFile(skillPath, "---\nname: Example\n---\nTrusted host-only canary Skill.\n", { mode: 0o600 }),
  ]);

  const networkServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("host-network-canary\n");
  });
  await new Promise((resolve, reject) => {
    networkServer.once("error", reject);
    networkServer.listen(0, "127.0.0.1", resolve);
  });

  try {
    const hostCredentialVisible = (await readFile(credentialPath, "utf8")).includes("not-a-real-secret");
    const networkProbeURL = `http://127.0.0.1:${networkServer.address().port}/probe`;
    const hostNetworkReachable = (await (await fetch(networkProbeURL)).text()).includes("host-network-canary");
    const request = {
      history,
      fakeCredentialPath: credentialPath,
      fakeSkillPath: skillPath,
      hostKnowledgePath: knowledgePath,
      networkProbeURL,
    };

    let response;
    let xpcError;
    try {
      response = await callReflectionXpcClient(request);
    } catch (error) {
      xpcError = serializeError(error);
    }

    const knowledgeUpdate = response?.knowledgeUpdate;
    const knowledgeUpdateValid = knowledgeUpdate?.topic === "reflection"
      && typeof knowledgeUpdate.summary === "string"
      && knowledgeUpdate.summary.trim().length > 0
      && knowledgeUpdate.summary.length <= 240
      && Array.isArray(knowledgeUpdate.sourceIDs)
      && knowledgeUpdate.sourceIDs.length > 0
      && knowledgeUpdate.sourceIDs.every((id) => historyIds.has(id));
    let knowledgeUpdateCommitted = false;
    if (knowledgeUpdateValid) {
      await writeFile(knowledgePath, `${JSON.stringify(knowledgeUpdate, null, 2)}\n`, { mode: 0o600 });
      const persisted = JSON.parse(await readFile(knowledgePath, "utf8"));
      knowledgeUpdateCommitted = persisted.summary === knowledgeUpdate.summary;
    }

    let missingServiceRejected = false;
    try {
      await callReflectionXpcClient(request, "com.electron.pi-host-prototype.td12-missing-service");
    } catch {
      missingServiceRejected = true;
    }

    const hostAfterFailure = await runScenario("builtin-read", fixture);
    const checks = {
      hostPositiveControlCanReadFakeCredential: hostCredentialVisible,
      hostPositiveControlCanReachLoopback: hostNetworkReachable,
      xpcServiceAndPiWorkerRan: Boolean(response?.success && response.servicePID > 0 && response.workerPID > 0),
      piSdkToolCallingReadSuppliedHistory: Boolean(response?.readHistoryResult.length === history.length
        && response.readHistoryResult[0]?.id === history[0].id
        && response.toolEvents.includes("tool_execution_end:read_simulated_history")),
      piSdkToolCallingSubmittedUpdate: Boolean(response?.toolEvents.includes("tool_execution_end:submit_knowledge_update")
        && knowledgeUpdateValid
        && knowledgeUpdateCommitted),
      onlyTwoExplicitToolsWereAvailable: Boolean(response?.toolNames.length === 2
        && response.toolNames.includes("read_simulated_history")
        && response.toolNames.includes("submit_knowledge_update")),
      noFormalSkillsOrExtensionsLoaded: Boolean(response?.loadedSkills === 0 && response.loadedExtensions === 0),
      appSandboxDeniedFakeCredential: Boolean(response?.security.credentialReadDenied),
      appSandboxDeniedFormalSkill: Boolean(response?.security.formalSkillReadDenied),
      appSandboxDeniedHostKnowledgeWrite: Boolean(response?.security.hostKnowledgeWriteDenied),
      appSandboxDeniedLoopbackNetwork: Boolean(response?.security.networkDenied),
      spawnedNodeInheritedFileAndNetworkBoundary: Boolean(response?.security.childNodeStarted
        && response.security.childCredentialReadDenied
        && response.security.childKnowledgeWriteDenied
        && response.security.childNetworkDenied),
      missingServiceFailedClosed: missingServiceRejected,
      normalPiHostContinuedAfterSandboxFailure: hostAfterFailure.assistantText === "faux-finished:read"
        && hostAfterFailure.pendingFauxResponses === 0,
    };
    return {
      checks,
      response: response ?? null,
      xpcError: xpcError ?? null,
      missingServiceRejected,
      hostAfterFailure: {
        assistantText: hostAfterFailure.assistantText,
        pendingFauxResponses: hostAfterFailure.pendingFauxResponses,
      },
    };
  } finally {
    await new Promise((resolve) => networkServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

async function runMacOsNodeBootstrapSmoke(fixture) {
  const serviceName = "com.electron.pi-host-prototype.node-bootstrap";
  const request = { mode: "bootstrap", echo: "td12-node-bootstrap" };
  const response = await callReflectionXpcClient(request, serviceName);
  const missingServiceRejected = await callReflectionXpcClient(request, "com.electron.pi-host-prototype.td12-missing-service")
    .then(() => false, () => true);
  const hostAfterFailure = await runScenario("builtin-read", fixture);
  const checks = {
    signedNodeStartedByXpcService: Boolean(response.success && response.servicePID > 0 && response.workerPID > 0),
    pinnedNodeVersionReturned: response.nodeVersion === "v24.22.0",
    workerReturnedRequestData: response.echo === request.echo,
    missingServiceFailedClosed: missingServiceRejected,
    normalPiHostContinuedAfterSandboxFailure: hostAfterFailure.assistantText === "faux-finished:read"
      && hostAfterFailure.pendingFauxResponses === 0,
  };
  return {
    checks,
    response,
    hostAfterFailure: {
      assistantText: hostAfterFailure.assistantText,
      pendingFauxResponses: hostAfterFailure.pendingFauxResponses,
    },
  };
}

async function runMacOsNodePermissionSmoke(fixture, includePiSmoke = false) {
  const root = path.join(app.getPath("userData"), `td12-node-permissions-${process.pid}-${randomUUID()}`);
  const credentialPath = path.join(root, "host-credentials", "fake-credential.json");
  const skillPath = path.join(root, "formal-skills", "example", "SKILL.md");
  const knowledgePath = path.join(root, "host-knowledge", "knowledge.json");
  const knowledgeCanary = "host-knowledge-canary-unchanged\n";
  await Promise.all([
    mkdir(path.dirname(credentialPath), { recursive: true }),
    mkdir(path.dirname(skillPath), { recursive: true }),
    mkdir(path.dirname(knowledgePath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(credentialPath, JSON.stringify({ kind: "fake-test-credential", value: "not-a-real-secret" }), { mode: 0o600 }),
    writeFile(skillPath, "---\nname: Example\n---\nTrusted host-only canary Skill.\n", { mode: 0o600 }),
    writeFile(knowledgePath, knowledgeCanary, { mode: 0o600 }),
  ]);

  let loopbackRequests = 0;
  const networkServer = createServer((_request, response) => {
    loopbackRequests += 1;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("host-network-canary\n");
  });
  await new Promise((resolve, reject) => {
    networkServer.once("error", reject);
    networkServer.listen(0, "127.0.0.1", resolve);
  });

  try {
    const history = [
      { id: "history-1", text: "The learner prefers short explanations with source-linked notes." },
      { id: "history-2", text: "The learner wants generated knowledge updates to remain reviewable." },
    ];
    const hostCredentialReadable = (await readFile(credentialPath, "utf8")).includes("not-a-real-secret");
    const hostSkillReadable = (await readFile(skillPath, "utf8")).includes("host-only canary");
    const hostKnowledgeReadable = (await readFile(knowledgePath, "utf8")) === knowledgeCanary;
    const networkProbeURL = `http://127.0.0.1:${networkServer.address().port}/probe`;
    const hostNetworkReachable = (await (await fetch(networkProbeURL)).text()).includes("host-network-canary");
    const requestsAfterHostControl = loopbackRequests;
    const response = await callReflectionXpcClient({
      mode: "probe",
      probes: { fakeCredentialPath: credentialPath, fakeSkillPath: skillPath, hostKnowledgePath: knowledgePath, networkProbeURL },
    }, "com.electron.pi-host-prototype.node-bootstrap");
    const knowledgeAfterProbe = await readFile(knowledgePath, "utf8");
    const direct = response.security;
    const child = response.child;
    const childSecurity = child?.security;
    const hostAfterProbe = await runScenario("builtin-read", fixture);
    const checks = {
      hostPositiveControlCanReadFakeCredential: hostCredentialReadable,
      hostPositiveControlCanReadFormalSkill: hostSkillReadable,
      hostPositiveControlCanReadKnowledge: hostKnowledgeReadable,
      hostPositiveControlCanReachLoopback: hostNetworkReachable,
      signedNodeReturnedPermissionProbe: Boolean(response.success && direct && child),
      osDeniedFakeCredentialRead: Boolean(direct?.credentialReadDenied),
      osDeniedFormalSkillRead: Boolean(direct?.formalSkillReadDenied),
      osDeniedHostKnowledgeWrite: Boolean(direct?.hostKnowledgeWriteDenied),
      osDeniedLoopbackNetwork: Boolean(direct?.networkDenied),
      hostKnowledgeCanaryUnchanged: knowledgeAfterProbe === knowledgeCanary,
      signedNodeChildStartedAndReturned: Boolean(child?.started && child.exitStatus === 0 && child.workerPID > 0 && childSecurity),
      childOsDeniedFakeCredentialRead: Boolean(childSecurity?.credentialReadDenied),
      childOsDeniedFormalSkillRead: Boolean(childSecurity?.formalSkillReadDenied),
      childOsDeniedHostKnowledgeWrite: Boolean(childSecurity?.hostKnowledgeWriteDenied),
      childOsDeniedLoopbackNetwork: Boolean(childSecurity?.networkDenied),
      workerNetworkDidNotReachLoopback: loopbackRequests === requestsAfterHostControl,
      normalPiHostContinuedAfterPermissionProbe: hostAfterProbe.assistantText === "faux-finished:read"
        && hostAfterProbe.pendingFauxResponses === 0,
    };
    let piEvidence;
    let bridgeProbeEvidence;
    if (includePiSmoke) {
      if (Object.values(checks).every(Boolean)) {
        bridgeProbeEvidence = await runMacOsNodeBridgeProbe();
        Object.assign(checks, bridgeProbeEvidence.checks);
        if (Object.values(checks).every(Boolean)) {
          piEvidence = await runMacOsNodePiSmoke(fixture, knowledgePath, knowledgeCanary, history, loopbackRequests, () => loopbackRequests);
          Object.assign(checks, piEvidence.checks);
        } else {
          checks.piSdkRunSkippedBecauseBridgeProbeFailed = false;
        }
      } else {
        checks.piSdkRunSkippedBecausePermissionProbesFailed = false;
      }
    }
    return {
      checks,
      response,
      probePaths: { credentialPath, skillPath, knowledgePath, networkProbeURL },
      bridgeProbeEvidence,
      piEvidence,
      loopbackRequests,
      hostAfterProbe: { assistantText: hostAfterProbe.assistantText, pendingFauxResponses: hostAfterProbe.pendingFauxResponses },
    };
  } finally {
    await new Promise((resolve) => networkServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

async function runMacOsNodeBridgeProbe() {
  let received = 0;
  let response;
  let error;
  try {
    response = await callReflectionXpcClient(
      { mode: "bridge-probe" },
      "com.electron.pi-host-prototype.node-bootstrap",
      async (request) => {
        received += 1;
        if (request?.kind !== "model_request" || request.modelID !== "reflection-host-approved"
          || request.contextJSON !== JSON.stringify({ messages: [] })) {
          return {
            kind: "model_response",
            requestID: request?.requestID ?? "invalid-request",
            ok: false,
            error: "bridge_probe_request_rejected",
          };
        }
        return {
          kind: "model_response",
          requestID: request.requestID,
          ok: true,
          assistantMessageJSON: JSON.stringify({
            role: "assistant",
            content: [{ type: "text", text: "xpc-bridge-ok" }],
          }),
        };
      },
      10_000,
    );
  } catch (caught) {
    error = serializeError(caught);
  }
  const checks = {
    xpcWorkerHostModelRequestRoundTrip: received === 1 && response?.success === true
      && response.modelProvider === "xpc-probe"
      && response.echo === "xpc-bridge-ok"
      && response.modelCalls?.length === 1
      && response.modelCalls[0] === "reflection-host-approved",
  };
  return { checks, response: response ?? null, error: error ?? null, hostRequestsReceived: received };
}

async function runMacOsNodePiSmoke(fixture, knowledgePath, knowledgeCanary, history, requestsBeforePi, getLoopbackRequests) {
  const hostChannel = await createHostFauxModelChannel(history, "pi-reflection");
  const response = await callReflectionXpcClient(
    { mode: "pi-reflection", history },
    "com.electron.pi-host-prototype.node-bootstrap",
    hostChannel.handle,
    10_000,
  );
  const historyIds = new Set(history.map((item) => item.id));
  const update = response.knowledgeUpdate;
  const updateKeys = update ? Object.keys(update).sort().join(",") : "";
  const updateValid = update?.topic === "reflection"
    && typeof update.summary === "string"
    && update.summary.trim().length > 0
    && update.summary.length <= 240
    && Array.isArray(update.sourceIDs)
    && update.sourceIDs.length > 0
    && update.sourceIDs.length <= 8
    && update.sourceIDs.every((id) => historyIds.has(id))
    && updateKeys === "sourceIDs,summary,topic";
  const knowledgeBeforeCommit = await readFile(knowledgePath, "utf8");
  let knowledgeCommitted = false;
  if (updateValid && knowledgeBeforeCommit === knowledgeCanary) {
    await writeFile(knowledgePath, `${JSON.stringify(update, null, 2)}\n`, { mode: 0o600 });
    const persisted = JSON.parse(await readFile(knowledgePath, "utf8"));
    knowledgeCommitted = persisted.summary === update.summary
      && persisted.sourceIDs.length === update.sourceIDs.length
      && persisted.sourceIDs.every((id) => historyIds.has(id));
  }
  const hostAfterPi = await runScenario("builtin-read", fixture);
  const expectedEnvironmentKeys = ["PATH", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY", "TD12_XPC_SERVICE_PID", "TMPDIR", "__CF_USER_TEXT_ENCODING"];
  const actualEnvironmentKeys = response.processEnvironmentKeys ?? [];
  const checks = {
    piSdk130WorkerStartedWithPinnedNode: Boolean(response.success && response.nodeVersion === "v24.22.0" && response.workerPID > 0),
    fauxProviderUsedByTrustedHostWithoutWorkerNetwork: response.modelProvider === "reflection-host-bridge"
      && hostChannel.modelProvider === "td13-host-faux"
      && getLoopbackRequests() === requestsBeforePi,
    piSdkReadSimulatedHistory: Boolean(response.readHistoryResult?.length === history.length
      && response.readHistoryResult.every((item, index) => item.id === history[index].id && item.text === history[index].text)
      && response.toolEvents?.includes("tool_execution_end:read_simulated_history")),
    piSdkSubmittedKnowledgeUpdateToolCall: Boolean(response.toolEvents?.includes("tool_execution_end:submit_knowledge_update")),
    onlyTwoExplicitToolsAvailable: Boolean(response.toolNames?.length === 2
      && response.toolNames.includes("read_simulated_history")
      && response.toolNames.includes("submit_knowledge_update")),
    threePiProviderRoundsRelayedThroughHost: response.modelCalls?.length === 3
      && hostChannel.modelRequests === 3
      && hostChannel.fauxCalls === 3,
    secondModelRoundContainsPriorToolResult: hostChannel.contexts.some((context) => /toolResult|tool_result/i.test(context)),
    hostAuthorizedFixedModelAndBoundedTranscript: hostChannel.authorizedRequests === 3
      && hostChannel.deniedRequests === 0
      && hostChannel.maxContextBytes <= 65_536,
    modelChannelContainsNoCredentialOrResourceProxyFields: hostChannel.requestSchemaValid
      && !hostChannel.modelPayloads.includes("not-a-real-secret")
      && !JSON.stringify(response).includes("not-a-real-secret"),
    noSkillsOrExtensionsLoaded: response.loadedSkills === 0 && response.loadedExtensions === 0,
    workerEnvironmentIsCredentialFreeAllowlist: JSON.stringify(actualEnvironmentKeys) === JSON.stringify(expectedEnvironmentKeys),
    hostValidatedAndCommittedBoundedKnowledgeUpdate: knowledgeBeforeCommit === knowledgeCanary && updateValid && knowledgeCommitted,
    normalPiHostContinuedAfterPiWorker: hostAfterPi.assistantText === "faux-finished:read" && hostAfterPi.pendingFauxResponses === 0,
  };
  const unauthorized = await runHostChannelNegativeCase(history, "pi-unauthorized-model", "model_not_authorized");
  const upstreamError = await runHostChannelNegativeCase(history, "pi-error", "mock_upstream_unavailable");
  const cancellation = await runHostChannelNegativeCase(history, "pi-cancel", "model_request_aborted");
  Object.assign(checks, {
    hostRejectedUnapprovedModelID: unauthorized.hostDenied === 1 && unauthorized.response.success
      && unauthorized.response.modelError?.includes("model_not_authorized"),
    upstreamFailureReachedWorkerAsPiError: upstreamError.hostUpstreamErrors === 1
      && upstreamError.response.success
      && upstreamError.response.modelError?.includes("mock_upstream_unavailable"),
    PiAbortSignalSentHostCancellationAndWorkerContinued: cancellation.hostCancelRequests === 1
      && cancellation.response.success
      && cancellation.response.abortObserved === true,
  });
  await hostChannel.cleanup();
  return {
    checks,
    response,
    hostChannel: hostChannel.evidence(),
    negativeCases: { unauthorized, upstreamError, cancellation },
    hostAfterPi: { assistantText: hostAfterPi.assistantText, pendingFauxResponses: hostAfterPi.pendingFauxResponses },
  };
}

async function createHostFauxModelChannel(history, mode) {
  const isolatedHostAgentDir = await mkdtemp(path.join(os.tmpdir(), "td13-host-faux-"));
  const faux = fauxProvider({
    provider: "td13-host-faux",
    api: "faux",
    models: [{
      id: "td13-faux-model",
      name: "TD-13 Host Faux Model",
      input: ["text"],
      reasoning: false,
      contextWindow: 8192,
      maxTokens: 1024,
    }],
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(isolatedHostAgentDir, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const sourceID = history[0]?.id ?? "history-1";
  if (mode === "pi-error") {
    faux.setResponses([async () => { throw new Error("mock_upstream_unavailable"); }]);
  } else if (mode === "pi-cancel") {
    faux.setResponses([async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return fauxAssistantMessage("late Faux response");
    }]);
  } else {
    faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall("read_simulated_history", {})], { stopReason: "toolUse" }),
      () => fauxAssistantMessage([fauxToolCall("submit_knowledge_update", {
        topic: "reflection",
        summary: "The simulated history records a preference for concise, source-linked learning notes.",
        source_ids: [sourceID],
      })], { stopReason: "toolUse" }),
      () => fauxAssistantMessage("Prepared one source-linked candidate for host validation."),
    ]);
  }

  const controllers = new Map();
  const contexts = [];
  const modelPayloads = [];
  let modelRequests = 0;
  let authorizedRequests = 0;
  let deniedRequests = 0;
  let hostCancelRequests = 0;
  let hostUpstreamErrors = 0;
  let maxContextBytes = 0;
  let requestSchemaValid = true;

  async function handle(request) {
    const keys = Object.keys(request ?? {}).sort().join(",");
    if (request?.kind === "model_cancel") {
      hostCancelRequests += 1;
      controllers.get(request.requestID)?.abort();
      return { kind: "model_cancel", requestID: request.requestID, ok: true };
    }

    modelRequests += 1;
    requestSchemaValid &&= keys === "contextJSON,kind,modelID,requestID"
      && typeof request.requestID === "string"
      && typeof request.modelID === "string"
      && typeof request.contextJSON === "string";
    if (request.modelID !== "reflection-host-approved") {
      deniedRequests += 1;
      return { kind: "model_response", requestID: request.requestID, ok: false, error: "model_not_authorized" };
    }
    const contextBytes = Buffer.byteLength(request.contextJSON ?? "", "utf8");
    maxContextBytes = Math.max(maxContextBytes, contextBytes);
    if (contextBytes > 65_536) {
      deniedRequests += 1;
      return { kind: "model_response", requestID: request.requestID, ok: false, error: "model_context_too_large" };
    }
    let context;
    try { context = JSON.parse(request.contextJSON); } catch {
      deniedRequests += 1;
      return { kind: "model_response", requestID: request.requestID, ok: false, error: "model_context_invalid" };
    }
    if (!context || Object.keys(context).join(",") !== "messages" || !Array.isArray(context.messages) || context.messages.length > 200) {
      deniedRequests += 1;
      return { kind: "model_response", requestID: request.requestID, ok: false, error: "model_context_invalid" };
    }
    authorizedRequests += 1;
    const contextJSON = JSON.stringify(context);
    contexts.push(contextJSON);
    modelPayloads.push(contextJSON);
    const abortController = new AbortController();
    controllers.set(request.requestID, abortController);
    try {
      const message = await modelRuntime.completeSimple(faux.getModel(), { messages: context.messages }, {
        signal: abortController.signal,
      });
      if (message.stopReason === "error") {
        hostUpstreamErrors += 1;
        const error = mode === "pi-error" ? "mock_upstream_unavailable" : "host_model_failed";
        return { kind: "model_response", requestID: request.requestID, ok: false, error };
      }
      return {
        kind: "model_response",
        requestID: request.requestID,
        ok: true,
        assistantMessageJSON: JSON.stringify(message),
      };
    } finally {
      controllers.delete(request.requestID);
    }
  }

  return {
    handle,
    modelProvider: faux.provider.id,
    get modelRequests() { return modelRequests; },
    get authorizedRequests() { return authorizedRequests; },
    get deniedRequests() { return deniedRequests; },
    get hostCancelRequests() { return hostCancelRequests; },
    get hostUpstreamErrors() { return hostUpstreamErrors; },
    get fauxCalls() { return faux.state.callCount; },
    contexts,
    modelPayloads,
    get maxContextBytes() { return maxContextBytes; },
    get requestSchemaValid() { return requestSchemaValid; },
    evidence() {
      return {
        modelProvider: faux.provider.id,
        modelRequests,
        authorizedRequests,
        deniedRequests,
        hostCancelRequests,
        hostUpstreamErrors,
        fauxCalls: faux.state.callCount,
        maxContextBytes,
        requestSchemaValid,
        requestFields: ["kind", "requestID", "modelID", "contextJSON"],
        responseFields: ["kind", "requestID", "ok", "assistantMessageJSON", "error"],
      };
    },
    async cleanup() { await rm(isolatedHostAgentDir, { recursive: true, force: true }); },
  };
}

async function runHostChannelNegativeCase(history, mode, expectedError) {
  const channel = await createHostFauxModelChannel(history, mode);
  const response = await callReflectionXpcClient(
    { mode, history },
    "com.electron.pi-host-prototype.node-bootstrap",
    channel.handle,
  );
  const result = {
    mode,
    response,
    hostDenied: channel.deniedRequests,
    hostCancelRequests: channel.hostCancelRequests,
    hostUpstreamErrors: channel.hostUpstreamErrors,
    modelErrorMatches: response.modelError?.includes(expectedError) === true,
  };
  await channel.cleanup();
  return result;
}

async function createHttpHost(fixture) {
  const html = await readFile(appResource("web", "index.html"));
  const server = createServer((request, response) => {
    void (async () => {
      const expectedHost = `127.0.0.1:${hostState.port}`;
      if (request.headers.host !== expectedHost) {
        sendJson(response, 403, { error: "Loopback Host header required" });
        return;
      }
      const origin = request.headers.origin;
      if (origin && origin !== hostState.origin) {
        sendJson(response, 403, { error: "Same-origin requests only" });
        return;
      }

      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && request.url === "/api/health") {
        sendJson(response, 200, {
          hostId,
          pid: process.pid,
          port: hostState.port,
          agentReady: Boolean(hostState.session),
          activeTools: hostState.activeTools,
          extensions: hostState.extensionNames,
          busy: hostState.busy,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/run") {
        if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
          sendJson(response, 415, { error: "application/json required" });
          return;
        }
        try {
          const body = await readRequestJson(request);
          sendJson(response, 200, await runScenario(body.scenario, fixture));
        } catch (error) {
          sendJson(response, error.statusCode ?? 500, { error: serializeError(error) });
        }
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    })().catch((error) => {
      if (!response.headersSent) sendJson(response, 500, { error: serializeError(error) });
      else response.destroy(error);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(process.env.PI_HOST_PORT ?? 0), "127.0.0.1", resolve);
  });

  hostState.server = server;
  hostState.port = server.address().port;
  hostState.origin = `http://127.0.0.1:${hostState.port}`;
  return hostState.origin;
}

function showWindow() {
  if (!hostState.window) return;
  hostState.window.show();
  hostState.window.focus();
}

function createWindow(origin) {
  const window = new BrowserWindow({
    width: 820,
    height: 700,
    minWidth: 620,
    minHeight: 520,
    title: "Pi Host Prototype",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on("close", (event) => {
    if (hostState.quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    hostState.window = undefined;
  });
  hostState.window = window;
  void window.loadURL(origin);
  return window;
}

function createTray() {
  const icon = nativeImage.createFromPath(appResource("assets", "tray-icon.svg"));
  const tray = new Tray(icon);
  tray.setToolTip("Pi Host Prototype");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", click: showWindow },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.on("double-click", showWindow);
  hostState.tray = tray;
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${value.error ?? "request failed"}`);
  return value;
}

async function runSmokeTest(origin, window, fixture) {
  const checks = {};
  try {
    const before = await getJson(`${origin}/api/health`);
    checks.hostAutoStarted = before.agentReady && before.pid === process.pid;
    checks.extensionLoaded = before.activeTools.includes("reflection_probe");

    const native = await getJson(`${origin}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ scenario: "builtin-read" }),
    });
    checks.piNativeReadCalled = native.toolEvents.some((event) => event.type === "tool_execution_end" && event.toolName === "read");
    checks.piNativeReadCompleted = native.pendingFauxResponses === 0 && native.assistantText === "faux-finished:read";

    const extension = await getJson(`${origin}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ scenario: "extension" }),
    });
    checks.extensionToolCalled = extension.toolEvents.some((event) => event.type === "tool_execution_end" && event.toolName === "reflection_probe");
    checks.extensionToolCompleted = extension.pendingFauxResponses === 0 && extension.assistantText === "faux-finished:reflection_probe";

    window.close();
    checks.windowHiddenAfterClose = !window.isVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await getJson(`${origin}/api/health`);
    checks.hostSurvivedWindowClose = after.hostId === before.hostId && after.pid === before.pid && after.agentReady;

    let sandboxEvidence;
    let nodeBootstrapEvidence;
    let nodePermissionEvidence;
    if (sandboxSmokeTest) {
      sandboxEvidence = await runMacOsSandboxSmoke(fixture);
      Object.assign(checks, sandboxEvidence.checks);
    }
    if (nodeBootstrapSmokeTest) {
      nodeBootstrapEvidence = await runMacOsNodeBootstrapSmoke(fixture);
      Object.assign(checks, nodeBootstrapEvidence.checks);
    }
    if (nodePermissionSmokeTest) {
      if (Object.values(checks).every(Boolean)) {
        nodePermissionEvidence = await runMacOsNodePermissionSmoke(fixture, nodePiSmokeTest);
        Object.assign(checks, nodePermissionEvidence.checks);
      } else {
        checks.permissionProbesSkippedBecauseBootstrapFailed = false;
      }
    }
    if (nodePiSmokeTest && !nodePermissionSmokeTest) {
      checks.piSdkRunSkippedBecausePermissionProbesWereNotRequested = false;
    }

    const report = {
      outcome: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      checks,
      host: { hostId, pid: process.pid, origin, node: process.versions.node, electron: process.versions.electron },
      activeTools: after.activeTools,
      loadedExtensions: after.extensions,
      provider: "Pi Faux Provider (local; no network)",
      sandboxEvidence,
      nodeBootstrapEvidence,
      nodePermissionEvidence,
    };
    const reportFile = process.env.PI_HOST_SMOKE_REPORT
      ? path.resolve(process.env.PI_HOST_SMOKE_REPORT)
      : path.join(os.tmpdir(), `pi-host-smoke-${process.pid}.json`);
    await mkdir(path.dirname(reportFile), { recursive: true });
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`SMOKE_REPORT=${reportFile}`);
    console.log(JSON.stringify(report));
    app.quit();
  } catch (error) {
    const report = { outcome: "FAIL", checks, error: serializeError(error), pid: process.pid };
    console.error(JSON.stringify(report));
    app.exit(1);
  }
}

app.whenReady().then(async () => {
  const { fixture } = await createPiHost();
  const origin = await createHttpHost(fixture);
  createTray();
  const window = createWindow(origin);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
    else showWindow();
  });
  app.on("window-all-closed", () => {
    // The host and tray deliberately outlive all renderer windows.
  });
  app.on("before-quit", () => {
    hostState.quitting = true;
    hostState.session?.dispose();
    hostState.server?.close();
  });
  console.log(JSON.stringify({ event: "agent-host-ready", hostId, pid: process.pid, origin, node: process.versions.node }));
  if (smokeTest || sandboxSmokeTest || nodeBootstrapSmokeTest || nodePermissionSmokeTest || nodePiSmokeTest) {
    setTimeout(() => void runSmokeTest(origin, window, fixture), 150);
  }
}).catch((error) => {
  console.error(`Pi Host startup failed: ${serializeError(error)}`);
  app.exit(1);
});
