import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Atomically write data to a file by writing to a temporary file first,
 * then renaming. This prevents partial writes from corrupting the target file.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  const tmpFile = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    fs.writeFileSync(tmpFile, data, 'utf8');
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Read a JSON file, apply a mutator function, and write it back atomically.
 * Returns the result of the mutator. Provides a simple read-modify-write
 * pattern with atomic saves.
 */
export function atomicJsonUpdate<T>(
  filePath: string,
  mutator: (data: T) => T,
  fallback: T,
): T {
  let data: T = fallback;
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      data = fallback;
    }
  }
  const updated = mutator(data);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  atomicWriteFileSync(filePath, JSON.stringify(updated, null, 2));
  return updated;
}
