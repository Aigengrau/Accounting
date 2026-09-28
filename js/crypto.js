/**
 * Optional passcode encryption.
 *
 * Without a passcode your entries sit in IndexedDB as plain text — readable by
 * anyone who unlocks your phone and opens developer tools. With one, they are
 * encrypted with AES-GCM using a key derived from the passcode, and the passcode
 * itself is never stored anywhere.
 *
 * That last part is the whole point, and also the danger: nobody can recover your
 * data if you forget it. Not you, not me, not a support desk. The app says so
 * before you turn it on and pushes you to export a backup first.
 *
 * Uses the browser's own WebCrypto — no library, nothing hand-rolled.
 */

const ITERATIONS = 250_000; // ~0.3s on a mid-range phone; slow enough to resist guessing
const SALT_BYTES = 16;
const IV_BYTES = 12;        // 96 bits, the standard for AES-GCM

const enc = new TextEncoder();
const dec = new TextDecoder();

/** True when this browser can do the crypto. Requires a secure context. */
export function isAvailable() {
  return typeof crypto !== 'undefined'
    && typeof crypto.subtle !== 'undefined'
    && typeof crypto.getRandomValues === 'function';
}

export function randomSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * Stretches a passcode into an AES key.
 * PBKDF2 is deliberately slow, so a short passcode still costs real time to
 * attack offline.
 */
export async function deriveKey(passcode, salt) {
  if (!isAvailable()) throw new Error('This browser cannot encrypt data.');
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts any JSON-serialisable value. A fresh IV every time, as GCM requires. */
export async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = enc.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

/**
 * Decrypts a blob from encryptJson.
 * A wrong passcode fails the GCM authentication tag, so it throws rather than
 * returning garbage. That is what makes "try to decrypt" a valid passcode check.
 */
export async function decryptJson(key, blob) {
  const iv = new Uint8Array(blob.iv);
  const ciphertext = new Uint8Array(blob.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(dec.decode(plaintext));
}

/** Rough feedback on passcode strength, shown while you type. */
export function ratePasscode(passcode) {
  const s = String(passcode || '');
  if (s.length === 0) return { level: 'none', label: '', ok: false };
  if (s.length < 4) return { level: 'weak', label: 'Too short — use at least 4 characters', ok: false };

  const digitsOnly = /^\d+$/.test(s);
  const sequential = /^(0123|1234|2345|3456|4567|5678|6789|9876|4321|1111|0000)/.test(s);

  if (sequential) return { level: 'weak', label: 'Too easy to guess', ok: false };
  if (digitsOnly && s.length < 6) return { level: 'weak', label: 'A 4-digit PIN is guessable — 6+ digits is better', ok: true };
  if (digitsOnly) return { level: 'fair', label: 'Digits only. A word or phrase would be stronger', ok: true };
  if (s.length < 8) return { level: 'fair', label: 'Reasonable', ok: true };
  return { level: 'strong', label: 'Strong', ok: true };
}
