/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry an async operation with exponential backoff. */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1000,
  factor = 2
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(delayMs * Math.pow(factor, i));
    }
  }
  throw lastError;
}
