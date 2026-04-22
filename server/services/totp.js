/**
 * TOTP (RFC 6238) + backup-code helpers.
 *
 * We implement this ourselves to avoid pulling `speakeasy` — the algorithm is
 * HMAC-SHA1 over the current timestep, truncated to 6 digits. Tested against
 * oathtool for interoperability with Google Authenticator / 1Password / Authy.
 *
 * Base32 encode/decode below matches RFC 4648 (no padding in the output — some
 * authenticators reject padded secrets even though the RFC allows them).
 */

import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  const buf = Buffer.alloc(Math.floor((clean.length * 5) / 8));
  let bits = 0, value = 0, i = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      buf[i++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return buf.slice(0, i);
}

/** Generate a 20-byte random TOTP secret, base32-encoded for display. */
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** Build an otpauth:// URL that authenticator apps can import via QR. */
export function buildOtpauthUrl({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secretBytes, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * Verify a 6-digit TOTP. Accepts the current, previous, and next timestep
 * (±30s) to tolerate small clock drift between server and authenticator.
 */
export function verifyTotp(base32Secret, submittedCode) {
  if (!/^\d{6}$/.test(submittedCode || '')) return false;
  const secretBytes = base32Decode(base32Secret);
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    if (hotp(secretBytes, now + offset) === submittedCode) return true;
  }
  return false;
}

/** Generate N human-readable backup codes ("a1b2c3-d4e5f6"). */
export function generateBackupCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const a = crypto.randomBytes(3).toString('hex');
    const b = crypto.randomBytes(3).toString('hex');
    codes.push(`${a}-${b}`);
  }
  return codes;
}

export async function hashBackupCodes(codes) {
  return Promise.all(codes.map((c) => bcryptjs.hash(c, 8)));
}

/**
 * Try to consume a backup code. Returns the updated array (with the used slot
 * replaced by null) or null if no match. Callers persist the array themselves.
 */
export async function consumeBackupCode(hashes, submitted) {
  for (let i = 0; i < hashes.length; i++) {
    if (!hashes[i]) continue;
    if (await bcryptjs.compare(submitted, hashes[i])) {
      const next = hashes.slice();
      next[i] = null;
      return next;
    }
  }
  return null;
}
