import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeReflectionExecutor } from '../apps/host/reflection/native-executor.js';

/** Protocol fixture only: bypasses package validation to exercise malformed bytes, never a product executor. */
class ProtocolFixture extends NativeReflectionExecutor {
  override async available() {
    return { available: true };
  }
}
async function fixture(source: string, run: (executor: ProtocolFixture) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-protocol-')),
    app = join(dir, 'Agent.app');
  const helper = join(app, 'Contents/Helpers/ReflectionBridge.app/Contents/MacOS/reflection-bridge');
  await mkdir(join(helper, '..'), { recursive: true });
  await writeFile(
    helper,
    `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>process.exit(0));\n${source}\n`,
    { mode: 0o700 },
  );
  try {
    await run(new ProtocolFixture(app));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
for (const malformed of ['null', '[]', '"text"', '{'])
  test(`malformed Worker protocol ${malformed} fails locally`, async () => {
    await fixture(`console.log(${JSON.stringify(malformed)});`, async (executor) => {
      await assert.rejects(executor.execute({ kind: 'start' }, async () => null, new AbortController().signal));
    });
  });
test('unserializable Host response ends only the Reflection run', async () => {
  await fixture(`console.log(JSON.stringify({kind:'request',requestId:'one',operation:'read'}));`, async (executor) => {
    await assert.rejects(
      executor.execute(
        { kind: 'start' },
        async (operation) => (operation === 'cancel' ? null : 1n),
        new AbortController().signal,
      ),
    );
  });
});
test('synchronous Host handler failure returns a bounded operation error', async () => {
  await fixture(
    `console.log(JSON.stringify({kind:'request',requestId:'one',operation:'read'}));let buffer='';process.stdin.on('data',data=>{buffer+=data;for(const line of buffer.split('\\n').slice(0,-1)){try{const m=JSON.parse(line);if(m.kind==='response')console.log(JSON.stringify({kind:'finished',ok:!m.ok}));}catch{}}});`,
    async (executor) => {
      await executor.execute(
        { kind: 'start' },
        () => {
          throw new Error('private exception');
        },
        new AbortController().signal,
      );
    },
  );
});
test('terminal message with outstanding operation revokes and settles it before rejecting', async () => {
  let revoked = false,
    settled = false;
  await fixture(
    `console.log(JSON.stringify({kind:'request',requestId:'one',operation:'model'}));console.log(JSON.stringify({kind:'finished',ok:true}));`,
    async (executor) => {
      let complete!: () => void;
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      await assert.rejects(
        executor.execute(
          { kind: 'start' },
          async (operation) => {
            if (operation === 'cancel') {
              revoked = true;
              complete();
              return null;
            }
            await pending;
            settled = true;
            return null;
          },
          new AbortController().signal,
        ),
      );
    },
  );
  assert.equal(revoked, true);
  assert.equal(settled, true);
});

test('failure revokes synchronously before queued operations can commit', async () => {
  let revoked = false,
    committed = false;
  await fixture(
    `process.stdout.write(JSON.stringify({kind:'request',requestId:'one',operation:'write'})+'\\nnull\\n');`,
    async (executor) => {
      await assert.rejects(
        executor.execute(
          {},
          async (operation) => {
            if (operation === 'cancel') revoked = true;
            else if (!revoked) committed = true;
            return null;
          },
          new AbortController().signal,
        ),
      );
    },
  );
  assert.equal(revoked, true);
  assert.equal(committed, false);
});
test('requests buffered after terminal success are rejected without dispatch', async () => {
  let writes = 0;
  await fixture(
    `process.stdout.write(JSON.stringify({kind:'finished',ok:true})+'\\n'+JSON.stringify({kind:'request',requestId:'late',operation:'write'})+'\\n');`,
    async (executor) => {
      await assert.rejects(
        executor.execute(
          {},
          async (operation) => {
            if (operation === 'write') writes++;
            return null;
          },
          new AbortController().signal,
        ),
      );
    },
  );
  assert.equal(writes, 0);
});
