import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
const command = promisify(execFile);
const probes = [
  'd4-vm-acceptance',
  'd4-vm-formal-acceptance',
  'd4-vm-failure-acceptance',
  'd4-vm-host-crash',
  'd4-vm-overhead',
];
if (process.env.AGENT_APP_PATH) probes.push('d4-vm-desktop-acceptance');
const receipt = {
  time: new Date().toISOString(),
  admission: false,
  executionCompleted: false,
  probes: [] as Array<{ name: string; completed: boolean; output: string }>,
  blockers: [
    'host_provisioning_and_control_plane_aggregate_budget_unproven',
    'full_filesystem_lifecycle_network_dependency_matrix_incomplete',
    'vm_real_model_development_and_independent_retest_not_established',
  ],
};
await mkdir(resolve('release/d4-vm-evidence'), { recursive: true });
for (const name of probes) {
  try {
    const result = await command(process.execPath, ['--import', 'tsx', `scripts/${name}.ts`], {
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    });
    receipt.probes.push({ name, completed: true, output: result.stdout.slice(-4096) });
  } catch (error) {
    receipt.probes.push({ name, completed: false, output: String(error).slice(-4096) });
    break;
  }
}
receipt.executionCompleted = receipt.probes.length === probes.length && receipt.probes.every((p) => p.completed);
await writeFile(resolve('release/d4-vm-evidence/admission.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
// Successful experiments never silently promote an incomplete security gate.
process.exitCode = 1;
