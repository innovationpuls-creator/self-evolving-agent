import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [allowedRoot, protectedRoot, secretFile, portText] = process.argv.slice(2);
const result = {
  allowedWrite: false,
  protectedWriteDenied: false,
  secretReadDenied: false,
  childProtectedWriteDenied: false,
  networkDenied: false,
};

writeFileSync(path.join(allowedRoot, "allowed.md"), "reflection output\n");
result.allowedWrite = true;

try {
  writeFileSync(path.join(protectedRoot, "direct.txt"), "must not be written\n");
} catch {
  result.protectedWriteDenied = true;
}

try {
  readFileSync(secretFile, "utf8");
} catch {
  result.secretReadDenied = true;
}

const childCode = `const fs = require("node:fs"); try { fs.writeFileSync(process.argv[1], "escape"); process.exit(3); } catch { process.exit(0); }`;
const child = spawnSync(process.execPath, ["-e", childCode, path.join(protectedRoot, "child.txt")], {
  encoding: "utf8",
  timeout: 5000,
});
result.childProtectedWriteDenied = child.status === 0;

try {
  await fetch(`http://127.0.0.1:${portText}/probe`);
  result.networkDenied = false;
} catch {
  result.networkDenied = true;
}

process.stdout.write(`${JSON.stringify(result)}\n`);
if (Object.values(result).some((value) => !value)) process.exitCode = 1;
