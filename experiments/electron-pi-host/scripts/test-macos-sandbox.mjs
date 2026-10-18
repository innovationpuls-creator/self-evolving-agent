import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.error("This probe requires macOS sandbox-exec.");
  process.exit(2);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-reflection-sandbox-"));
const physicalTempRoot = await realpath(tempRoot);
const allowedRoot = path.join(physicalTempRoot, "allowed");
const protectedRoot = path.join(physicalTempRoot, "protected");
const secretRoot = path.join(physicalTempRoot, "private");
const secretFile = path.join(secretRoot, "credential.txt");
const profilePath = path.join(tempRoot, "reflection.sb");
await Promise.all([
  mkdir(allowedRoot),
  mkdir(protectedRoot),
  mkdir(secretRoot),
  writeFile(secretFile, "fake-secret-for-sandbox-test\n"),
]);
const profileTemplate = await readFile(path.join(projectRoot, "security", "reflection.sb.in"), "utf8");
const profile = profileTemplate
  .replaceAll("__ALLOWED_WRITE_ROOT__", JSON.stringify(allowedRoot))
  .replaceAll("__DENIED_READ_ROOT__", JSON.stringify(secretRoot));
await writeFile(profilePath, profile);

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("reachable\n");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const port = server.address().port;
  const run = spawnSync("/usr/bin/sandbox-exec", [
    "-f", profilePath,
    process.execPath,
    path.join(projectRoot, "security", "sandbox-child.mjs"),
    allowedRoot,
    protectedRoot,
    secretFile,
    String(port),
  ], {
    encoding: "utf8",
    timeout: 15000,
  });

  const resultLine = run.stdout.trim().split("\n").at(-1);
  const result = resultLine ? JSON.parse(resultLine) : undefined;
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, `sandbox-exec exit=${run.status}; stderr=${run.stderr}; stdout=${run.stdout}`);
  assert.deepEqual(result, {
    allowedWrite: true,
    protectedWriteDenied: true,
    secretReadDenied: true,
    childProtectedWriteDenied: true,
    networkDenied: true,
  });
  console.log(JSON.stringify({
    outcome: "PASS",
    enforcement: "macOS Seatbelt via sandbox-exec",
    profile: "deny default; allow reads; allow writes only under approved knowledge path; deny private reads; allow process creation",
    checks: result,
    stderr: run.stderr.trim(),
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}
