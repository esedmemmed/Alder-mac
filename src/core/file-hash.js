// The OpenSubtitles file hash (Stremio's videoHash): the file size plus the sum of the 64-bit little-endian words of the first
// and of the last 64 KiB, mod 2^64, as 16 lowercase hex digits. Pure: the platforms bring the bytes (their own HTTP).
// Two 32-bit halves and plain doubles instead of BigInt (Tizen 5.5's Chromium 69 has none): a half-sum of at most
// 16384 words of < 2^32 stays below 2^46, so every step is exact.

export const CHUNK = 65536;
export const MIN_SIZE = CHUNK * 2;
const TWO32 = 4294967296;

function view(bytes) {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new Error('bytes expected');
}

function hex8(n) {
  const s = n.toString(16);
  return '00000000'.slice(s.length) + s;
}

/** The hash of a file of [size] bytes whose first and last 65536 bytes are [headBytes] and [tailBytes]; null under 131072 bytes. */
export function openSubtitlesHash(size, headBytes, tailBytes) {
  if (!Number.isFinite(size) || size < MIN_SIZE) return null;
  let lo = size % TWO32;
  let hi = Math.floor(size / TWO32);
  [view(headBytes), view(tailBytes)].forEach((b) => {
    if (b.length !== CHUNK) throw new Error('short read');
    for (let i = 0; i < CHUNK; i += 8) {
      lo += (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 16777216;
      hi += (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16)) + b[i + 7] * 16777216;
    }
  });
  hi += Math.floor(lo / TWO32);
  return hex8(hi % TWO32) + hex8(lo % TWO32);
}

/**
 * Reads the two ends through [fetchRange](start, endInclusive) -> Promise of the bytes (or of { bytes, total }, where total is the
 * whole file's size from a Content-Range header) and hashes them. The head's total wins over [size], the stream's hint, which can be
 * wrong (a tail range from a wrong size answers 416); [size] is only used when the head's answer carries no total.
 * Resolves { hash, size } (size: the one used), null for a file under 131072 bytes; rejects when the ends cannot be read.
 */
export async function hashFromRanges(size, fetchRange) {
  const split = (r) => (r && r.bytes ? r : { bytes: r, total: null });
  const head = split(await fetchRange(0, CHUNK - 1));
  const real = Number(head.total) > 0 ? Number(head.total) : 0;
  const total = real || (Number(size) > 0 ? Number(size) : 0);
  if (!total) throw new Error('size unknown');
  if (total < MIN_SIZE) return null;
  const tail = split(await fetchRange(total - CHUNK, total - 1));
  return { hash: openSubtitlesHash(total, head.bytes, tail.bytes), size: total };
}
