import fs from "fs/promises";

const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES"]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Write a file with retries on transient Windows lock errors (EBUSY, etc.). */
export async function writeFileWithRetry(
  filePath: string,
  data: Buffer | Uint8Array,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<void> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 250;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.writeFile(filePath, data);
      return;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      const retryable = err.code != null && RETRYABLE.has(err.code);
      if (!retryable || attempt === maxAttempts) throw e;
      await sleep(baseDelayMs * attempt);
    }
  }
}
