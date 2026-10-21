import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

function destination(path: string): string {
  path = resolve(path);
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(destination(parent), basename(path));
  }
}

export function desktopPackagePolicy(env: NodeJS.ProcessEnv = process.env) {
  const xpc = env.AGENT_D4_SANDBOX_PROTOTYPE === '1';
  const vm = env.AGENT_D4_VM_PROTOTYPE === '1';
  if (xpc && vm) throw new Error('D4 XPC and VM experiments require separate packages');
  const profile = vm ? 'd4-vm-client' : xpc ? 'd4-sandbox' : 'desktop';
  const out = env.AGENT_PACKAGE_OUT ?? (vm || xpc ? `release/${profile}` : 'release');
  if ((vm || xpc) && [destination('release'), destination('release/desktop')].includes(destination(out)))
    throw new Error('Experimental components cannot overwrite the desktop package');
  return { xpc, vm, profile, out };
}
