import { vi } from 'vitest';

type ProcessLike = { getBuiltinModule?: (id: string) => unknown };

/** `process` as the `node:crypto` fast path sees it; absent outside Node. */
const proc = (globalThis as { process?: ProcessLike }).process;

/** Whether this runtime has the Node fast path at all (Node.js >= 22.3). */
export const hasNodeFastPath = typeof proc?.getBuiltinModule === 'function';

/**
 * Replaces `process.getBuiltinModule` for the duration of one test and returns
 * the function that puts the original back.
 *
 * `undefined` (see {@link usePortableCrypto}) makes the Node fast path look
 * unavailable, so signing falls back to Web Crypto / the portable MD5; any
 * other value stands in for `node:crypto` itself. A no-op on runtimes without
 * the method.
 */
export function stubGetBuiltinModule(module: unknown): () => void {
  if (!hasNodeFastPath) {
    return () => {};
  }
  const spy = vi.spyOn(proc as { getBuiltinModule: (id: string) => unknown }, 'getBuiltinModule');
  spy.mockReturnValue(module);
  return () => spy.mockRestore();
}

/** Forces the portable (non-Node) crypto path; see {@link stubGetBuiltinModule}. */
export function usePortableCrypto(): () => void {
  return stubGetBuiltinModule(undefined);
}
