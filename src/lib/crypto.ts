import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/* ---------- Random tokens (invitation links, sessions, reset links) ---------- */

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes, so a database leak doesn't leak live links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* ---------- Passwords (local development provider) ---------- */

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function passwordProblems(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "Use 200 characters or fewer.";
  if (/^(.)\1+$/.test(password)) return "Avoid repeating a single character.";
  return null;
}

/* ---------- Encryption at rest (MFA secrets, integration tokens) ---------- */

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not configured");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognized encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/* ---------- TOTP (RFC 6238) for authenticator apps ---------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretB32: string, step: number, digits = 6, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac(algo, base32Decode(secretB32)).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Checks a 6-digit code allowing ±1 step of clock drift. Returns the matched step
 * so the caller can reject replays (a step at or before the last accepted one).
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now(), lastStep?: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / 30);
  for (const s of [current - 1, current, current + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    const expected = Buffer.from(totpAt(secretB32, s));
    if (timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

export function totpUri(secretB32: string, account: string, issuer = "Bluewater Collective"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
