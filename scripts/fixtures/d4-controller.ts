import { NativeD4Executor } from '../../apps/host/evolution/sandbox/native-executor.js';
await new NativeD4Executor(process.argv[2]).execute(
  { kind: 'start', mode: 'hang' },
  async (op, input) => {
    if (op !== 'evidence') throw Error('denied');
    console.log(JSON.stringify(input));
    return {};
  },
  AbortSignal.timeout(30000),
);
