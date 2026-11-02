import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** SHA-256 en flux d'un Blob (sans le charger en entier en mémoire). */
export async function sha256Blob(blob: Blob, onProgress?: (done: number, total: number) => void): Promise<string> {
  const h = sha256.create();
  const reader = blob.stream().getReader();
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    h.update(r.value);
    done += r.value.byteLength;
    onProgress?.(done, blob.size);
  }
  return bytesToHex(h.digest());
}

export function sha256Bytes(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function createSha256() {
  const h = sha256.create();
  return {
    update(chunk: Uint8Array) {
      h.update(chunk);
    },
    hex(): string {
      return bytesToHex(h.digest());
    },
  };
}
