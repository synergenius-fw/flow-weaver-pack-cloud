/**
 * File mutation lock. Serializes concurrent mutations to the same file.
 *
 * Prevents file corruption when rapid Studio mutations (e.g. dragging nodes)
 * trigger concurrent write operations.
 */
import * as path from 'node:path';

const fileMutationLocks = new Map<string, Promise<void>>();

export function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const normalizedPath = path.resolve(filePath);
  const existingChain = fileMutationLocks.get(normalizedPath) || Promise.resolve();

  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const resultPromise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const newChain = existingChain.then(async () => {
    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });

  fileMutationLocks.set(normalizedPath, newChain);

  newChain.finally(() => {
    if (fileMutationLocks.get(normalizedPath) === newChain) {
      fileMutationLocks.delete(normalizedPath);
    }
  });

  return resultPromise;
}
