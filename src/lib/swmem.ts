/**
 * Client-side encryption for the .swmem memory archive format.
 *
 * Why this lives in the browser, not the server:
 *   The passphrase must never reach the backend (anything that touches
 *   prod-side TLS termination, CDN/WAF logs, or operator infrastructure
 *   is a leak risk). The admin server only ever sees the plaintext
 *   payload over the existing authenticated /api/proxy session — the
 *   .swmem container is opened and resealed locally.
 *
 * Algorithm (v1):
 *   * KDF: PBKDF2-SHA256, 600_000 iterations (OWASP 2023 recommendation
 *     for SHA-256). Argon2id is the preferred upgrade and is reserved for
 *     a future format_version=2 once a small WASM Argon2 build is
 *     vendored. The format header carries the kdf name + parameters so a
 *     v1 file remains decodable after that change.
 *   * Cipher: AES-256-GCM (WebCrypto native, includes the auth tag — any
 *     ciphertext or header tamper fails decryption with `OperationError`).
 *   * Salt: 16 random bytes, fresh per export.
 *   * Nonce: 12 random bytes, fresh per export.
 *
 * File layout:
 *   bytes 0..5    "SWMEM1"            magic
 *   bytes 6..9    uint32 LE           JSON-header length N
 *   bytes 10..10+N JSON header        encryption metadata (no secrets)
 *   bytes 10+N..  ciphertext+gcm-tag  AEAD-protected payload
 *
 * The header carries the encryption metadata in cleartext so a future
 * decoder can pick the right KDF/cipher without trial-and-error. It does
 * NOT carry the passphrase, the derived key, or any plaintext payload
 * fields.
 */

import type { MemoryExportPayload } from './api'

export const SWMEM_MAGIC = 'SWMEM1'
export const SWMEM_FORMAT = 'statewave-memory-export'
export const SWMEM_FORMAT_VERSION = 1

const KDF_ITERATIONS = 600_000
const SALT_BYTES = 16
const NONCE_BYTES = 12
const KEY_BITS = 256

export interface SwmemHeader {
  format: typeof SWMEM_FORMAT
  format_version: number
  encryption_algorithm: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA256'
  kdf_params: { iterations: number; hash: 'SHA-256' }
  salt: string // base64
  nonce: string // base64
  created_at: string
}

export class SwmemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwmemError'
  }
}

// ─── base64 helpers (browser-friendly) ───────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ─── KDF ─────────────────────────────────────────────────────────────────────

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ─── Encrypt ────────────────────────────────────────────────────────────────

/**
 * Build a .swmem blob from a plaintext payload + passphrase. Returns a
 * single Uint8Array suitable for `new Blob([buf]).then(saveAs)` etc.
 *
 * Throws SwmemError on weak input. The passphrase strength check is
 * intentionally minimal here — UI should validate length / show a meter
 * before getting this far.
 */
export async function encryptSwmem(
  payload: MemoryExportPayload,
  passphrase: string,
): Promise<Uint8Array> {
  if (!passphrase || passphrase.length < 8) {
    throw new SwmemError('Passphrase must be at least 8 characters.')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const key = await deriveKey(passphrase, salt)

  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
      key,
      plaintext as unknown as BufferSource,
    ),
  )

  const header: SwmemHeader = {
    format: SWMEM_FORMAT,
    format_version: SWMEM_FORMAT_VERSION,
    encryption_algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    kdf_params: { iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    created_at: new Date().toISOString(),
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))

  const magicBytes = new TextEncoder().encode(SWMEM_MAGIC)
  const out = new Uint8Array(magicBytes.length + 4 + headerBytes.length + ciphertext.length)
  let off = 0
  out.set(magicBytes, off)
  off += magicBytes.length
  // little-endian uint32 header length
  new DataView(out.buffer).setUint32(off, headerBytes.length, true)
  off += 4
  out.set(headerBytes, off)
  off += headerBytes.length
  out.set(ciphertext, off)
  return out
}

// ─── Decrypt ────────────────────────────────────────────────────────────────

export interface DecryptedSwmem {
  header: SwmemHeader
  payload: MemoryExportPayload
}

/**
 * Open a .swmem blob with a passphrase.
 *
 * Throws SwmemError with a stable user-facing message:
 *   * "Not a Statewave memory archive (.swmem)" on magic mismatch
 *   * "Unsupported .swmem format version: N" on version mismatch
 *   * "Wrong passphrase or corrupted file." on AEAD failure (the
 *     WebCrypto OperationError is intentionally squashed so a tampered
 *     ciphertext and a wrong passphrase look identical to the user)
 */
export async function decryptSwmem(
  blob: Uint8Array,
  passphrase: string,
): Promise<DecryptedSwmem> {
  const magic = new TextDecoder().decode(blob.slice(0, SWMEM_MAGIC.length))
  if (magic !== SWMEM_MAGIC) {
    throw new SwmemError('Not a Statewave memory archive (.swmem).')
  }
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const headerLen = view.getUint32(SWMEM_MAGIC.length, true)
  const headerStart = SWMEM_MAGIC.length + 4
  const headerEnd = headerStart + headerLen
  if (headerEnd > blob.length) {
    throw new SwmemError('Corrupted .swmem header.')
  }

  let header: SwmemHeader
  try {
    header = JSON.parse(new TextDecoder().decode(blob.slice(headerStart, headerEnd)))
  } catch {
    throw new SwmemError('Corrupted .swmem header.')
  }
  if (header.format !== SWMEM_FORMAT) {
    throw new SwmemError(`Unexpected .swmem format: ${String(header.format)}`)
  }
  if (header.format_version !== SWMEM_FORMAT_VERSION) {
    throw new SwmemError(`Unsupported .swmem format version: ${header.format_version}`)
  }
  if (header.encryption_algorithm !== 'AES-256-GCM' || header.kdf !== 'PBKDF2-SHA256') {
    throw new SwmemError(
      `Unsupported .swmem encryption (algo=${header.encryption_algorithm}, kdf=${header.kdf})`,
    )
  }

  const salt = base64ToBytes(header.salt)
  const nonce = base64ToBytes(header.nonce)
  const ciphertext = blob.slice(headerEnd)

  const key = await deriveKey(passphrase, salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource,
    )
  } catch {
    // WebCrypto throws OperationError for both wrong key and tampered
    // ciphertext. Surfacing one message keeps the error space simple and
    // doesn't leak whether the key derivation succeeded.
    throw new SwmemError('Wrong passphrase or corrupted file.')
  }

  let payload: MemoryExportPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new SwmemError('Decrypted .swmem payload was not valid JSON.')
  }
  if (payload?.format !== 'statewave-memory-payload') {
    throw new SwmemError(
      `Decrypted payload has unexpected format: ${String(payload?.format)}`,
    )
  }
  return { header, payload }
}

/**
 * Cheap structural preview of a decrypted payload, for the import UI.
 * Returns counts and original subject ids without re-iterating large
 * arrays or running the import.
 */
export function previewDecryptedPayload(
  payload: MemoryExportPayload,
): {
  format_version: number
  exported_at: string
  export_scope: string
  subject_count: number
  episode_count: number
  memory_count: number
  source_count: number
  original_subject_ids: string[]
} {
  const subjects = Array.isArray(payload.subjects) ? payload.subjects : []
  const episodes = Array.isArray(payload.episodes) ? payload.episodes : []
  const memories = Array.isArray(payload.memories) ? payload.memories : []
  const sources = Array.isArray(payload.sources) ? payload.sources : []
  return {
    format_version: payload.format_version,
    exported_at: payload.exported_at,
    export_scope: payload.export_scope,
    subject_count: subjects.length,
    episode_count: episodes.length,
    memory_count: memories.length,
    source_count: sources.length,
    original_subject_ids: subjects
      .map((s) => (s as Record<string, unknown>).original_subject_id)
      .filter((s): s is string => typeof s === 'string'),
  }
}
