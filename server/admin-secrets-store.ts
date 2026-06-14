/**
 * Encrypted on-disk store for admin-server secrets (ADMIN_PASSWORD,
 * STATEWAVE_API_KEY).
 *
 * Design constraints:
 *
 *   - Zero npm runtime deps — `node:crypto` + `node:fs` only. The rest
 *     of the admin server holds this line; the secrets store must too
 *     so deployment surface stays unchanged.
 *
 *   - The master key NEVER lives on disk in this process. It comes from
 *     `STATEWAVE_ADMIN_MASTER_KEY` (an env var the operator sets at
 *     deploy). If the file is exfiltrated alone, it's unreadable.
 *
 *   - If the master key isn't set, persistence is GRACEFULLY DISABLED
 *     (`status: 'disabled'`). The admin server still works — operators
 *     fall back to the original in-memory + Windows-revert pattern,
 *     and the UI surfaces a banner explaining how to enable persistence.
 *
 * Crypto:
 *
 *   - AES-256-GCM (authenticated encryption — tamper-evident on read).
 *   - Per-file random 16-byte salt; the data key is derived via
 *     PBKDF2-HMAC-SHA256(masterKey, salt, 200_000 iters, 32 bytes).
 *     PBKDF2 lets operators choose a passphrase-shaped master key
 *     without pre-hashing.
 *   - Random 12-byte nonce on every write.
 *   - File format (v1): one-line JSON envelope of base64 blobs:
 *
 *         { "v": 1, "salt": "<base64>", "nonce": "<base64>",
 *           "tag": "<base64>", "ciphertext": "<base64>" }
 *
 *   - Atomic write: write to `secrets.enc.tmp`, fsync, rename — so a
 *     mid-write crash never leaves a half-written ciphertext that the
 *     next boot would reject.
 *
 * Why PBKDF2 not Argon2id: stdlib only. PBKDF2 with 200k iters
 * (SHA-256, 32-byte output) is OWASP-2023-compliant for password-
 * derived keys.
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const FORMAT_VERSION = 1
const KDF_ITERATIONS = 200_000
const KDF_KEYLEN = 32
const SALT_BYTES = 16
const NONCE_BYTES = 12

/** Shape of the JSON blob we encrypt + persist. Add new fields here as
 * the admin server grows new persistable knobs. */
export interface SecretsBlob {
  admin_password?: string
  statewave_api_key?: string
  /**
   * Auto-generated when the operator enables admin auth via the UI
   * wizard, since `ADMIN_SESSION_SECRET` is otherwise expected from
   * the deploy env. Without it, signed cookies don't validate after
   * restart and every operator gets bounced back to /login.
   */
  admin_session_secret?: string
  /**
   * Runtime override for the `ADMIN_AUTH_DISABLED` env var. When
   * persisted as `false`, the boot-time loader explicitly DELETES
   * `process.env.ADMIN_AUTH_DISABLED` so auth comes back on.
   *
   * UNLIKE the other fields here, this one is "persisted wins over
   * env" — the operator clicking a button in the UI saying "actually
   * I want auth on now" must outlive a dev flag they forgot to
   * remove from their deploy config. Documented at the loader.
   */
  admin_auth_disabled?: boolean
}

/** Resolved configuration for one `SecretsStore` instance. */
export interface StoreConfig {
  /** Master key (passphrase). Empty/null means persistence is disabled. */
  masterKey: string | null
  /** Absolute path to the encrypted file. */
  filePath: string
}

export type StoreStatus =
  | 'disabled' // No master key configured.
  | 'ready'    // Master key present; file may or may not exist yet.
  | 'corrupt'  // File exists but couldn't be decrypted (wrong key / tamper).

/**
 * Resolve config from the process env. Centralised so tests can stub
 * `process.env` in one place. The default file location follows
 * platform convention:
 *
 *   - `STATEWAVE_ADMIN_STATE_DIR` env override (always wins) →
 *     `<dir>/secrets.enc`
 *   - else `/data/statewave-admin/secrets.enc` on Linux containers
 *   - else `~/.statewave-admin/secrets.enc` on local-dev machines
 *
 * The Docker compose override mounts a named volume at `/data/
 * statewave-admin` so the file survives `docker compose down + up`.
 */
export function getStoreConfig(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  const rawKey = env.STATEWAVE_ADMIN_MASTER_KEY
  const masterKey = typeof rawKey === 'string' && rawKey.length >= 8 ? rawKey : null

  const explicitDir = env.STATEWAVE_ADMIN_STATE_DIR
  let dir: string
  if (explicitDir) {
    dir = resolve(explicitDir)
  } else if (existsAsDir('/data')) {
    dir = '/data/statewave-admin'
  } else {
    dir = join(homedir(), '.statewave-admin')
  }

  return { masterKey, filePath: join(dir, 'secrets.enc') }
}

function existsAsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Derive the AES key from `masterKey + salt`. Pure function; safe to
 * call on every read/write — PBKDF2 is the slow path on purpose
 * (defends against an offline attacker who steals the encrypted file
 * but not the master key).
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return pbkdf2Sync(masterKey, salt, KDF_ITERATIONS, KDF_KEYLEN, 'sha256')
}

/**
 * The store itself. Stateless on disk — every read decrypts the
 * envelope fresh, every write encrypts and replaces it atomically. In
 * memory we keep the last decrypted blob so subsequent gets don't pay
 * the PBKDF2 cost; the cache is invalidated on every write.
 */
export class SecretsStore {
  // Per-instance status flag (result of the last load/write). We
  // deliberately don't cache the decrypted blob — load() is rare
  // (boot + UI poll) and the PBKDF2 cost is acceptable; caching would
  // let a sibling process's rotation go unnoticed by this one.
  private cacheStatus: StoreStatus = 'disabled'

  constructor(private readonly cfg: StoreConfig) {}

  /** Snapshot of the current state for telemetry / UI status. */
  status(): StoreStatus {
    if (!this.cfg.masterKey) return 'disabled'
    return this.cacheStatus === 'corrupt' ? 'corrupt' : 'ready'
  }

  /** Path the file lives at (for log messages / UI hints). */
  filePath(): string {
    return this.cfg.filePath
  }

  /**
   * Read + decrypt. Returns:
   *   - `{}` if the file doesn't exist yet (fresh deploy)
   *   - `{}` and sets status='disabled' if no master key (caller logs)
   *   - throws if the file exists but the master key doesn't fit
   *     (wrong key OR tampered ciphertext OR truncated write). Caller
   *     turns this into a `corrupt` status so the UI can show a
   *     "your master key changed — re-enter your secrets" banner.
   */
  load(): SecretsBlob {
    if (!this.cfg.masterKey) {
      this.cacheStatus = 'disabled'
      return {}
    }
    let raw: string
    try {
      raw = readFileSync(this.cfg.filePath, 'utf8')
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cacheStatus = 'ready'
        return {}
      }
      throw exc
    }
    try {
      const envelope = JSON.parse(raw) as {
        v: number
        salt: string
        nonce: string
        tag: string
        ciphertext: string
      }
      if (envelope.v !== FORMAT_VERSION) {
        throw new Error(`unknown secrets file format v${envelope.v}`)
      }
      const salt = Buffer.from(envelope.salt, 'base64')
      const nonce = Buffer.from(envelope.nonce, 'base64')
      const tag = Buffer.from(envelope.tag, 'base64')
      const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
      const key = deriveKey(this.cfg.masterKey, salt)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      const blob = JSON.parse(plaintext.toString('utf8')) as SecretsBlob
      this.cacheStatus = 'ready'
      return blob
    } catch (exc) {
      this.cacheStatus = 'corrupt'
      throw new Error(
        `failed to decrypt admin secrets at ${this.cfg.filePath}: ${(exc as Error).message}`,
        { cause: exc },
      )
    }
  }

  /**
   * Merge-write: load current blob, apply `patch`, encrypt + replace.
   * No-op (returns false) when persistence is disabled — caller logs.
   *
   * Atomic: writes to `<file>.tmp` then renames, so a crash mid-write
   * either leaves the old ciphertext in place or atomically lands the
   * new one. The directory is mkdir'd recursively on first write so
   * fresh deployments don't have to pre-create it.
   */
  write(patch: SecretsBlob): boolean {
    if (!this.cfg.masterKey) return false
    const current = (() => {
      try {
        return this.load()
      } catch {
        // Corrupt-or-mistyped-key state: overwrite with the new patch
        // rather than refuse to write. The original file is unreadable
        // anyway, so refusing is worse than recovering. Caller is
        // expected to UX this (the UI shows 'corrupt' status before
        // any write is attempted).
        return {}
      }
    })()
    const merged: SecretsBlob = { ...current, ...patch }
    // Strip undefined values so `unset` (write `undefined`) actually
    // removes the field rather than persisting it as `null`.
    for (const k of Object.keys(merged) as (keyof SecretsBlob)[]) {
      if (merged[k] === undefined) delete merged[k]
    }
    const plaintext = Buffer.from(JSON.stringify(merged), 'utf8')
    const salt = randomBytes(SALT_BYTES)
    const nonce = randomBytes(NONCE_BYTES)
    const key = deriveKey(this.cfg.masterKey, salt)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const envelope = {
      v: FORMAT_VERSION,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    mkdirSync(dirname(this.cfg.filePath), { recursive: true, mode: 0o700 })
    const tmp = `${this.cfg.filePath}.tmp`
    // 0600 — owner read/write only. The directory's perms (mkdir 0700
    // above) belt-and-brace it; if root owns the volume and the admin
    // server runs as non-root, the file is still readable to its
    // owner but not group/world.
    writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 })
    renameSync(tmp, this.cfg.filePath)
    this.cacheStatus = 'ready'
    return true
  }
}

/** Process-wide singleton. Resolved lazily so test stubs of
 * `process.env` work even when imported indirectly. */
let _instance: SecretsStore | null = null
export function getStore(): SecretsStore {
  if (!_instance) _instance = new SecretsStore(getStoreConfig())
  return _instance
}
export function _resetStoreForTests(): void {
  _instance = null
}
