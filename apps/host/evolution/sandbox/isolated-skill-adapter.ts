import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { IsolatedExecutionContract, IsolatedSkillAdapter } from '../../skills/isolated-execution.js';
import { isolatedFactoryName } from '../../skills/isolated-execution.js';
import type { SkillVersion } from '../../skills/skills.js';
import { VMChannel, type VMProbeConfiguration } from './vm-channel.js';
import { VMAssets } from './vm-assets.js';

const declarations = z
  .array(
    z
      .object({
        name: z.string().regex(/^d4_[a-z0-9_]{1,60}$/),
        label: z.string().max(256),
        description: z.string().max(4096),
        parameters: z.record(z.string(), z.unknown()),
        exposure: z.enum(['direct', 'model-only', 'codemode', 'deferred', 'hidden']).optional(),
        defaultActive: z.boolean().optional(),
      })
      .strict(),
  )
  .max(32);
const response = z.object({
  isError: z.boolean(),
  result: z.object({
    content: z.array(z.object({ type: z.literal('text'), text: z.string().max(32768) }).strict()).max(32),
    details: z.unknown().optional(),
  }),
});

/** Opt-in experimental backend. The application does not enable it by default. */
export class VMIsolatedSkillAdapter implements IsolatedSkillAdapter {
  readonly observations: Array<{ version: string; activity: string; events: unknown[] }> = [];
  private constructor(
    private options: VMProbeConfiguration,
    readonly runtimeDigest: string,
  ) {}
  static async create(options: VMProbeConfiguration) {
    const assets = await VMAssets.capture(options);
    return new VMIsolatedSkillAdapter({ ...options, assets }, assets.digest);
  }
  supports(contract: IsolatedExecutionContract) {
    return (
      contract.kind === 'd4-vm-v1' &&
      contract.permissionProfile === 'd4-data-only-v1' &&
      contract.runtimeDigest === this.runtimeDigest
    );
  }
  async open(version: SkillVersion, packagePath: string) {
    if (!version.execution || !this.supports(version.execution)) throw new Error('isolated_contract_mismatch');
    const files: Array<{ path: string; base64: string }> = [];
    let bytes = 0;
    const collect = async (directory: string, prefix = '') => {
      for (const name of await readdir(directory)) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const path = join(directory, name),
          info = await lstat(path);
        if (info.isDirectory()) await collect(path, relative);
        else if (info.isFile()) {
          bytes += info.size;
          if (bytes > 32768 || files.length >= 128) throw new Error('isolated_projection_limit');
          files.push({ path: relative, base64: (await readFile(path)).toString('base64') });
        } else throw new Error('isolated_projection_file_type');
      }
    };
    await collect(packagePath);
    let channel: VMChannel | undefined;
    let expected: string | undefined;
    let turn = randomUUID();
    let closed = false;
    let generation = 0;
    let opening: Promise<VMChannel> | undefined;
    let starting: VMChannel | undefined;
    let stopping: Promise<void> | undefined;
    let quarantined = false;
    const startedTurns = new WeakMap<VMChannel, string>();
    const stop = async () => {
      if (stopping) return stopping;
      generation++;
      const old = channel;
      const pending = opening;
      stopping = (async () => {
        try {
          await Promise.all([old?.close(), starting?.close()]);
          await pending?.catch(() => {});
          if (channel === old) channel = undefined;
        } catch (error) {
          quarantined = true;
          throw error;
        } finally {
          stopping = undefined;
        }
      })();
      return stopping;
    };
    const ensure = async () => {
      await stopping;
      if (quarantined) throw new Error('isolated_owner_quarantined');
      if (closed) throw new Error('isolated_version_closed');
      if (channel) return channel;
      if (opening) return opening;
      const epoch = generation;
      const next = new VMChannel(this.options);
      starting = next;
      opening = (async () => {
        try {
          await next.start();
          const tools = declarations.parse(
            await next.request({ kind: 'load', extensions: version.extensions, versionDigest: version.digest, files }),
          );
          if (expected && JSON.stringify(tools) !== expected) throw new Error('isolated_declaration_changed');
          expected = JSON.stringify(tools);
          if (closed || epoch !== generation) throw new Error('isolated_open_revoked');
          channel = next;
          this.observations.push({ version: version.id, activity: next.id, events: next.events });
          return next;
        } catch (error) {
          await next.close();
          throw error;
        } finally {
          starting = undefined;
          opening = undefined;
        }
      })();
      return opening;
    };
    const readyForTurn = async () => {
      const current = await ensure();
      if (startedTurns.get(current) !== turn) {
        await current.request({ kind: 'agent_start', turn });
        startedTurns.set(current, turn);
      }
      return current;
    };
    await ensure();
    const tools = declarations.parse(JSON.parse(expected!));
    return {
      name: isolatedFactoryName(version.id),
      factory: (pi: Parameters<import('@earendil-works/pi-coding-agent').ExtensionFactory>[0]) => {
        pi.on('agent_start', async () => {
          turn = randomUUID();
          const epoch = generation;
          try {
            await readyForTurn();
          } catch (error) {
            const cancelled = epoch !== generation;
            await stop();
            if (!cancelled) throw error;
          }
        });
        for (const tool of tools)
          pi.registerTool({
            ...tool,
            parameters: tool.parameters as ToolDefinition['parameters'],
            executionMode: 'sequential',
            execute: async (_id, args, signal) => {
              try {
                const result = response.parse(
                  await (await readyForTurn()).request({ kind: 'call', name: tool.name, args }, signal),
                );
                if (result.isError)
                  throw new Error('isolated_tool_failed:' + result.result.content.map((c) => c.text).join('\n'));
                return { ...result.result, details: result.result.details };
              } catch (error) {
                await stop();
                throw error;
              }
            },
          });
      },
      revoke: stop,
      close: async () => {
        closed = true;
        await stop();
      },
    };
  }
}
