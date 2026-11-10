// UUIDv5 (SHA-1) без внешних зависимостей: в Apps Script нет crypto и npm.

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha1(bytes: number[]): number[] {
  const msg = bytes.slice();
  const bitLen = bytes.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  for (const w of [hi, lo]) msg.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80).fill(0);
  const rol = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let i = 0; i < msg.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = (((msg[i + t * 4] ?? 0) << 24) | ((msg[i + t * 4 + 1] ?? 0) << 16) | ((msg[i + t * 4 + 2] ?? 0) << 8) | (msg[i + t * 4 + 3] ?? 0)) >>> 0;
    }
    for (let t = 16; t < 80; t++) w[t] = rol(((w[t - 3] ?? 0) ^ (w[t - 8] ?? 0) ^ (w[t - 14] ?? 0) ^ (w[t - 16] ?? 0)) >>> 0, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (rol(a, 5) + (f >>> 0) + e + k + (w[t] ?? 0)) >>> 0;
      e = d; d = c; c = rol(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) out.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255);
  return out;
}

/** Стандартное пространство имён URL (RFC 4122). */
export const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export function uuidv5(name: string, namespace: string = NAMESPACE_URL): string {
  const ns = (namespace.replace(/-/g, '').match(/../g) ?? []).map((h) => parseInt(h, 16));
  const hash = sha1(ns.concat(utf8(name))).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** id операции по номеру банковской операции. Совпадает с id уже загруженных операций. */
export function vcbTxnId(orderNumber: string, suffix = ''): string {
  return uuidv5(`vcb:${orderNumber}${suffix}`);
}
