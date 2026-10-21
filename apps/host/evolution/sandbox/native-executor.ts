import { NativeReflectionExecutor } from '../../reflection/native-executor.js';
/** Fixed isolated prototype; no production Evolution entry or privileged fallback. */
export class NativeD4Executor extends NativeReflectionExecutor {
  protected override get executionProfile(): 'd4' {
    return 'd4';
  }
}
