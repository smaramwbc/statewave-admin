#!/usr/bin/env node
/**
 * Set (or rotate) the admin password from the command line.
 *
 * The companion to `recover-admin-password.mjs`. Use this when the
 * operator forgot their password and wants to set a new one without
 * the UI dance (which requires being logged in first). Writes
 * directly to the encrypted secrets file using the same AES-256-GCM
 * envelope the server's SecretsStore produces, so the next admin
 * restart picks up the new value via `loadPersistedSecretsAtStartup`.
 *
 * Run from inside the admin container so it inherits
 * STATEWAVE_ADMIN_MASTER_KEY + STATEWAVE_ADMIN_STATE_DIR from the env:
 *
 *     docker exec -it quickstart-admin-1 node /app/scripts/set-admin-password.mjs
 *     # → prompts for the new password (no echo)
 *
 *     # Or pass it inline (less safe — lands in shell history):
 *     docker exec quickstart-admin-1 node /app/scripts/set-admin-password.mjs \
 *       --password 'my-new-password'
 *
 * After the script lands the new blob:
 *   1. Restart the admin server (`docker compose restart admin`) so
 *      it re-reads the file at boot.
 *   2. Log in with the new password.
 *
 * Stdlib-only (no npm install required). Mirrors the format that
 * `server/admin-secrets-store.ts` produces — keep these two in sync.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline'

const { values } = parseArgs({
  options: {
    file: {
      type: 'string',
      default:
        process.env.STATEWAVE_ADMIN_STATE_DIR
          ? `${process.env.STATEWAVE_ADMIN_STATE_DIR}/secrets.enc`
          : '/data/statewave-admin/secrets.enc',
    },
    'master-key': {
      type: 'string',
      default: process.env.STATEWAVE_ADMIN_MASTER_KEY ?? '',
    },
    password: { type: 'string' },
  },
})

const filePath = values.file
const masterKey = values['master-key']

if (!masterKey) {
  console.error(
    'error: master key required. Pass --master-key or set STATEWAVE_ADMIN_MASTER_KEY.',
  )
  process.exit(2)
}

// Format constants — KEEP IN SYNC with server/admin-secrets-store.ts.
const FORMAT_VERSION = 1
const KDF_ITERATIONS = 200_000
const KDF_KEYLEN = 32
const SALT_BYTES = 16
const NONCE_BYTES = 12

function deriveKey(passphrase, salt) {
  return pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, KDF_KEYLEN, 'sha256')
}

function loadExisting() {
  // Read + decrypt any existing blob so we preserve unrelated fields
  // (statewave_api_key, admin_session_secret). Tolerant of "file
  // doesn't exist yet" — fresh deploys land here.
  if (!existsSync(filePath)) return {}
  const envelope = JSON.parse(readFileSync(filePath, 'utf8'))
  if (envelope.v !== FORMAT_VERSION) {
    throw new Error(`unknown secrets format v${envelope.v}`)
  }
  const salt = Buffer.from(envelope.salt, 'base64')
  const nonce = Buffer.from(envelope.nonce, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const key = deriveKey(masterKey, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}

function writeBlob(blob) {
  const plaintext = Buffer.from(JSON.stringify(blob), 'utf8')
  const salt = randomBytes(SALT_BYTES)
  const nonce = randomBytes(NONCE_BYTES)
  const key = deriveKey(masterKey, salt)
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
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 })
  renameSync(tmp, filePath)
}

async function readPasswordFromStdin() {
  // Disable input echo so the password isn't shown in the terminal.
  // Falls back to echoed input on environments without a TTY (e.g.
  // a piped CI run); that's acceptable since CI will pass --password
  // anyway.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  process.stdout.write('New admin password: ')
  const stdin = process.stdin
  const isTty = typeof stdin.isTTY === 'boolean' && stdin.isTTY
  if (isTty && typeof stdin.setRawMode === 'function') {
    // Simple no-echo prompt — accumulate chars until Enter.
    return new Promise((resolve) => {
      let buf = ''
      stdin.setRawMode(true)
      stdin.resume()
      stdin.setEncoding('utf8')
      const onData = (chunk) => {
        const s = chunk.toString()
        for (const ch of s) {
          if (ch === '\r' || ch === '\n') {
            stdin.setRawMode(false)
            stdin.pause()
            stdin.removeListener('data', onData)
            process.stdout.write('\n')
            rl.close()
            resolve(buf)
            return
          }
          if (ch === '') {
            // ^C — bail
            process.exit(130)
          }
          if (ch === '' || ch === '\b') {
            buf = buf.slice(0, -1)
            continue
          }
          buf += ch
        }
      }
      stdin.on('data', onData)
    })
  }
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

let password = values.password
if (!password) {
  password = await readPasswordFromStdin()
}
if (!password || password.length < 8) {
  console.error('error: password must be at least 8 characters.')
  process.exit(2)
}

let existing
try {
  existing = loadExisting()
} catch (exc) {
  console.error(
    `warning: could not decrypt existing file (${exc.message}). ` +
    'Writing a fresh blob — any statewave_api_key / admin_session_secret ' +
    'previously persisted will be lost. Set them again via the UI after login.',
  )
  existing = {}
}

const merged = {
  ...existing,
  admin_password: password,
  // Persist the auth-disabled override so the next boot enforces auth
  // regardless of what the deploy env says. Same semantics as the
  // wizard's enableAdminAuthentication helper.
  admin_auth_disabled: false,
}

writeBlob(merged)

console.log(`OK. Wrote new password to ${filePath}.`)
console.log('Next: restart the admin server (`docker compose restart admin`) and log in.')
