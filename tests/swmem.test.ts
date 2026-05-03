import { describe, it, expect } from 'vitest'
import {
  encryptSwmem,
  decryptSwmem,
  previewDecryptedPayload,
  SwmemError,
  SWMEM_MAGIC,
  SWMEM_FORMAT,
  SWMEM_FORMAT_VERSION,
  type SwmemHeader,
} from '../src/lib/swmem'
import type { MemoryExportPayload } from '../src/lib/api'

/**
 * Crypto contract for the .swmem container.
 *
 * These tests run in happy-dom which provides WebCrypto. PBKDF2 with
 * 600_000 iterations is heavy by design — keep test payloads tiny so the
 * round-trips stay sub-second per test.
 */

function fakePayload(overrides: Partial<MemoryExportPayload> = {}): MemoryExportPayload {
  return {
    format: 'statewave-memory-payload',
    format_version: 1,
    export_id: 'export-abc',
    exported_at: '2026-05-01T00:00:00Z',
    export_scope: 'episodes_memories_sources',
    subjects: [{ original_subject_id: 'user-1', metadata: {} }],
    episodes: [{ subject_id: 'user-1', payload: { hi: true } }],
    memories: [{ subject_id: 'user-1', kind: 'fact', content: 'remembered fact' }],
    sources: [],
    metadata: {},
    ...overrides,
  }
}

function readHeader(blob: Uint8Array): SwmemHeader {
  const magic = new TextDecoder().decode(blob.slice(0, SWMEM_MAGIC.length))
  expect(magic).toBe(SWMEM_MAGIC)
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const headerLen = view.getUint32(SWMEM_MAGIC.length, true)
  const start = SWMEM_MAGIC.length + 4
  return JSON.parse(new TextDecoder().decode(blob.slice(start, start + headerLen)))
}

describe('encryptSwmem / decryptSwmem', () => {
  it('round-trips a payload with the correct passphrase', async () => {
    const payload = fakePayload()
    const blob = await encryptSwmem(payload, 'correct-horse-battery')
    const result = await decryptSwmem(blob, 'correct-horse-battery')
    expect(result.payload).toEqual(payload)
  })

  it('header carries the encryption metadata in cleartext (no secrets)', async () => {
    const blob = await encryptSwmem(fakePayload(), 'a-strong-passphrase')
    const header = readHeader(blob)
    expect(header.format).toBe(SWMEM_FORMAT)
    expect(header.format_version).toBe(SWMEM_FORMAT_VERSION)
    expect(header.encryption_algorithm).toBe('AES-256-GCM')
    expect(header.kdf).toBe('PBKDF2-SHA256')
    expect(header.kdf_params.iterations).toBeGreaterThanOrEqual(600_000)
    expect(header.kdf_params.hash).toBe('SHA-256')
    expect(typeof header.salt).toBe('string')
    expect(typeof header.nonce).toBe('string')
    expect(typeof header.created_at).toBe('string')
    // Whatever else the header carries, the passphrase must NOT be in it.
    const headerJson = JSON.stringify(header)
    expect(headerJson).not.toContain('a-strong-passphrase')
  })

  it('encrypted body is not parseable as the plaintext payload', async () => {
    const payload = fakePayload()
    const blob = await encryptSwmem(payload, 'opensesame123')
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    const headerLen = view.getUint32(SWMEM_MAGIC.length, true)
    const ciphertext = blob.slice(SWMEM_MAGIC.length + 4 + headerLen)
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(ciphertext)
    // The plaintext payload contains "remembered fact" — encryption must hide it.
    expect(asText).not.toContain('remembered fact')
    expect(asText).not.toContain('"original_subject_id"')
  })

  it('rejects a wrong passphrase with the standard message', async () => {
    const blob = await encryptSwmem(fakePayload(), 'right-pass-1234')
    await expect(decryptSwmem(blob, 'wrong-pass-XXXX')).rejects.toThrow(SwmemError)
    await expect(decryptSwmem(blob, 'wrong-pass-XXXX')).rejects.toThrow(
      'Wrong passphrase or corrupted file.',
    )
  })

  it('rejects tampered ciphertext with the same message as wrong-passphrase', async () => {
    const blob = await encryptSwmem(fakePayload(), 'opensesame123')
    // Flip the last byte of the AEAD tag region.
    const tampered = new Uint8Array(blob)
    tampered[tampered.length - 1] ^= 0x01
    await expect(decryptSwmem(tampered, 'opensesame123')).rejects.toThrow(
      'Wrong passphrase or corrupted file.',
    )
  })

  it('rejects a file without the SWMEM1 magic', async () => {
    const garbage = new TextEncoder().encode('NOTA SWMEM file at all')
    await expect(decryptSwmem(garbage, 'whatever-pass')).rejects.toThrow(
      'Not a Statewave memory archive (.swmem).',
    )
  })

  it('rejects an unsupported format version', async () => {
    const blob = await encryptSwmem(fakePayload(), 'opensesame123')
    // Rewrite the header's format_version to 99 — keep length identical so
    // the offsets still parse.
    const header = readHeader(blob)
    const tampered: SwmemHeader = { ...header, format_version: 99 as 1 }
    const tamperedJson = new TextEncoder().encode(JSON.stringify(tampered))
    expect(tamperedJson.length).toBeGreaterThan(0)
    // Build a fresh blob with the bumped version header and the same body —
    // we can't reuse the ciphertext meaningfully because the AEAD will fail
    // first, but the format-version check runs BEFORE decryption.
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    const oldHeaderLen = view.getUint32(SWMEM_MAGIC.length, true)
    const body = blob.slice(SWMEM_MAGIC.length + 4 + oldHeaderLen)
    const out = new Uint8Array(SWMEM_MAGIC.length + 4 + tamperedJson.length + body.length)
    out.set(new TextEncoder().encode(SWMEM_MAGIC), 0)
    new DataView(out.buffer).setUint32(SWMEM_MAGIC.length, tamperedJson.length, true)
    out.set(tamperedJson, SWMEM_MAGIC.length + 4)
    out.set(body, SWMEM_MAGIC.length + 4 + tamperedJson.length)
    await expect(decryptSwmem(out, 'opensesame123')).rejects.toThrow(
      /Unsupported \.swmem format version/i,
    )
  })

  it('rejects passphrases shorter than 8 chars at encrypt time', async () => {
    await expect(encryptSwmem(fakePayload(), 'tiny')).rejects.toThrow(SwmemError)
  })

  it('previewDecryptedPayload returns counts and original ids', async () => {
    const blob = await encryptSwmem(
      fakePayload({
        subjects: [
          { original_subject_id: 'a', metadata: {} },
          { original_subject_id: 'b', metadata: {} },
        ],
      }),
      'opensesame123',
    )
    const { payload } = await decryptSwmem(blob, 'opensesame123')
    const preview = previewDecryptedPayload(payload)
    expect(preview.subject_count).toBe(2)
    expect(preview.episode_count).toBe(1)
    expect(preview.memory_count).toBe(1)
    expect(preview.original_subject_ids).toEqual(['a', 'b'])
  })
})
