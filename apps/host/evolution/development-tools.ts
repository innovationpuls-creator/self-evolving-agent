import { access, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Type } from 'typebox';
import {
  defineTool,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { contained, SkillError } from '../skills/skills.js';
import { activityResult, type ActivityService, type ActivityResult } from './activities.js';

export function developmentTools(
  activities: ActivityService,
  id: string,
  workspace: string,
  submit: (value: ActivityResult) => Promise<void>,
): ToolDefinition[] {
  const path = async (absolute: string) => {
    const a = activities.assertRunning(id);
    const target = a.grant.targets.find((t) => contained(t.directory, resolve(absolute)));
    if (!target) throw new SkillError('只能修改此次授权的候选目录', 403);
    let cursor = absolute;
    for (;;) {
      try {
        if (!contained(target.directory, await realpath(cursor))) throw new SkillError('文件路径越出候选目录', 403);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        cursor = dirname(cursor);
      }
    }
  };
  const write = createWriteToolDefinition(workspace, {
    operations: {
      async mkdir(p) {
        await path(p);
        await mkdir(p, { recursive: true });
      },
      async writeFile(p, text) {
        await path(p);
        await writeFile(p, text);
      },
    },
  });
  const edit = createEditToolDefinition(workspace, {
    operations: {
      async access(p) {
        await path(p);
        await access(p);
      },
      async readFile(p) {
        await path(p);
        return readFile(p);
      },
      async writeFile(p, text) {
        await path(p);
        await writeFile(p, text);
      },
    },
  });
  const bash = createBashToolDefinition(workspace, { exposeSessionEnvironment: false });
  return [
    defineTool(write),
    defineTool(edit),
    defineTool({
      ...bash,
      async execute(...args: Parameters<typeof bash.execute>) {
        activities.assertRunning(id);
        return bash.execute(...args);
      },
    }),
    {
      name: 'evolution_complete',
      label: '提交能力成果',
      description:
        'Finish this authorized activity. Submit package paths and reproducible Tool probes (expectedText is a substring of the actual text result), or packages:[] when investigation produced no code. Host checks and publishes automatically after the session settles. Never claim publication before the Host result.',
      promptGuidelines: [
        'Use only authorized candidate directories. Independently investigate, implement, install dependencies and test as needed. Do not edit product storage or formal versions. Submit all changed packages once, with actual Tool probes for every executable Skill.',
      ],
      executionMode: 'sequential',
      parameters: Type.Unsafe<ActivityResult>(
        JSON.parse(
          JSON.stringify(
            Type.Object({
              summary: Type.String({ minLength: 1, maxLength: 12000 }),
              packages: Type.Array(
                Type.Object({
                  target: Type.String(),
                  skillFile: Type.String(),
                  extensions: Type.Array(Type.String()),
                  knowledgeFiles: Type.Optional(Type.Array(Type.String())),
                  probes: Type.Array(
                    Type.Object({
                      tool: Type.String(),
                      args: Type.Record(Type.String(), Type.Unknown()),
                      expectedText: Type.String({ minLength: 1 }),
                    }),
                  ),
                }),
              ),
            }),
          ),
        ),
      ),
      async execute(_callId, input, signal) {
        signal?.throwIfAborted();
        activities.assertRunning(id);
        await submit(activityResult.parse(input));
        return { content: [{ type: 'text', text: '成果已提交，等待本次运行结束后由 Host 检查与生效。' }], details: {} };
      },
    },
  ];
}
