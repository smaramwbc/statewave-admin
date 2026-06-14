/**
 * Tests for the encrypted on-disk secrets store.
 *
 * The store is the durable side of the admin-settings flow — if these
 * tests break, an operator who confirmed a new password loses access on
 * next restart. The round-trip + the corruption-detection + the
 * missing-key fallback are all load-bearing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SecretsStore,
  getStoreConfig,
  _resetStoreForTests,
} from '../server/admin-secrets-store'

let workdir: string

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'statewave-secrets-test-'))
  _resetStoreForTests()
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('getStoreConfig', () => {
  it('disables persistence when master key is unset', () => {
    const cfg = getStoreConfig({ STATEWAVE_ADMIN_STATE_DIR: workdir } as NodeJS.ProcessEnv)
    expect(cfg.masterKey).toBeNull()
  })

  it('disables persistence when master key is too short (<8 chars)', () => {
    const cfg = getStoreConfig({
      STATEWAVE_ADMIN_MASTER_KEY: 'short',
      STATEWAVE_ADMIN_STATE_DIR: workdir,
    } as NodeJS.ProcessEnv)
    expect(cfg.masterKey).toBeNull()
  })

  it('accepts a sufficiently long master key', () => {
    const cfg = getStoreConfig({
      STATEWAVE_ADMIN_MASTER_KEY: 'a-decent-passphrase',
      STATEWAVE_ADMIN_STATE_DIR: workdir,
    } as NodeJS.ProcessEnv)
    expect(cfg.masterKey).toBe('a-decent-passphrase')
    expect(cfg.filePath).toMatch(/secrets\.enc$/)
  })
})

describe('SecretsStore — disabled', () => {
  it('status() is "disabled" when no master key', () => {
    const store = new SecretsStore({ masterKey: null, filePath: join(workdir, 'secrets.enc') })
    expect(store.status()).toBe('disabled')
  })

  it('load() returns empty without reading any file', () => {
    const filePath = join(workdir, 'secrets.enc')
    writeFileSync(filePath, 'whatever junk') // would normally throw
    const store = new SecretsStore({ masterKey: null, filePath })
    expect(store.load()).toEqual({})
  })

  it('write() is a no-op and returns false', () => {
    const filePath = join(workdir, 'secrets.enc')
    const store = new SecretsStore({ masterKey: null, filePath })
    const ok = store.write({ admin_password: 'x' })
    expect(ok).toBe(false)
    expect(existsSync(filePath)).toBe(false)
  })
})

describe('SecretsStore — round trip', () => {
  it('write → load returns the same blob', () => {
    const filePath = join(workdir, 'secrets.enc')
    const store = new SecretsStore({ masterKey: 'test-passphrase-12345', filePath })
    store.write({ admin_password: 'hunter2', statewave_api_key: 'sk-abc' })
    expect(store.load()).toEqual({ admin_password: 'hunter2', statewave_api_key: 'sk-abc' })
  })

  it('a fresh process can decrypt with the same master key', () => {
    // Simulates a server restart: write with one store instance, read
    // with another that has no in-memory state.
    const filePath = join(workdir, 'secrets.enc')
    new SecretsStore({ masterKey: 'test-passphrase-12345', filePath }).write({
      admin_password: 'persisted',
    })
    const fresh = new SecretsStore({ masterKey: 'test-passphrase-12345', filePath })
    expect(fresh.load()).toEqual({ admin_password: 'persisted' })
  })

  it('the on-disk file is NOT plaintext', () => {
    // Defense-in-depth: if someone copies the volume off the box, they
    // shouldn't see the password in the ciphertext blob even casually.
    const filePath = join(workdir, 'secrets.enc')
    new SecretsStore({ masterKey: 'test-passphrase-12345', filePath }).write({
      admin_password: 'this-must-not-leak',
    })
    const raw = readFileSync(filePath, 'utf8')
    expect(raw).not.toContain('this-must-not-leak')
    expect(raw).not.toContain('hunter2')
    // Sanity: it IS the JSON envelope we expect.
    const envelope = JSON.parse(raw)
    expect(envelope).toMatchObject({
      v: 1,
      salt: expect.any(String),
      nonce: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
    })
  })

  it('merges writes — a later patch keeps unrelated fields', () => {
    const filePath = join(workdir, 'secrets.enc')
    const store = new SecretsStore({ masterKey: 'test-passphrase-12345', filePath })
    store.write({ admin_password: 'a', statewave_api_key: 'b' })
    store.write({ admin_password: 'a2' })
    expect(store.load()).toEqual({ admin_password: 'a2', statewave_api_key: 'b' })
  })

  it('uses a fresh nonce + salt on every write', () => {
    // Two writes of the same blob must produce different ciphertexts,
    // otherwise an attacker comparing two snapshots could detect "no
    // change" and infer rotation state.
    const filePath = join(workdir, 'secrets.enc')
    const store = new SecretsStore({ masterKey: 'test-passphrase-12345', filePath })
    store.write({ admin_password: 'same-value' })
    const first = readFileSync(filePath, 'utf8')
    store.write({ admin_password: 'same-value' })
    const second = readFileSync(filePath, 'utf8')
    expect(first).not.toEqual(second)
  })
})

describe('SecretsStore — corruption / wrong key', () => {
  it('load() throws and sets status="corrupt" when the master key is wrong', () => {
    const filePath = join(workdir, 'secrets.enc')
    new SecretsStore({ masterKey: 'test-passphrase-12345', filePath }).write({
      admin_password: 'a',
    })
    const wrongKey = new SecretsStore({ masterKey: 'totally-different', filePath })
    expect(() => wrongKey.load()).toThrow()
    expect(wrongKey.status()).toBe('corrupt')
  })

  it('write() overwrites a corrupt file (recovery path)', () => {
    // After a master-key rotation, the old file is undecryptable. The
    // operator re-enters their secrets; the next write must succeed,
    // producing a file readable under the new key.
    const filePath = join(workdir, 'secrets.enc')
    new SecretsStore({ masterKey: 'old-key-passphrase', filePath }).write({
      admin_password: 'old',
    })
    const newStore = new SecretsStore({ masterKey: 'new-key-passphrase', filePath })
    expect(() => newStore.load()).toThrow() // corrupt under new key
    newStore.write({ admin_password: 'new' })
    expect(newStore.load()).toEqual({ admin_password: 'new' })
  })

  it('load() throws for a tampered ciphertext (auth tag mismatch)', () => {
    // GCM is authenticated — flipping one byte of the ciphertext must
    // cause decryption to fail, not silently produce garbage that
    // accidentally validates.
    const filePath = join(workdir, 'secrets.enc')
    const store = new SecretsStore({ masterKey: 'test-passphrase-12345', filePath })
    store.write({ admin_password: 'a' })
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    // Flip one base64 char in the ciphertext.
    const ct = Buffer.from(raw.ciphertext, 'base64')
    ct[0] = ct[0] ^ 0x01
    raw.ciphertext = ct.toString('base64')
    writeFileSync(filePath, JSON.stringify(raw))
    expect(() => store.load()).toThrow()
  })
})

describe('SecretsStore — missing file', () => {
  it('load() returns {} when the file doesn\'t exist yet (fresh deploy)', () => {
    const store = new SecretsStore({
      masterKey: 'test-passphrase-12345',
      filePath: join(workdir, 'never-created.enc'),
    })
    expect(store.load()).toEqual({})
    expect(store.status()).toBe('ready')
  })
})
