#!/usr/bin/env node
/**
 * Recover the admin password from the encrypted secrets file.
 *
 * Use this when the operator forgot the admin password they set via
 * the Settings UI's "Enable admin authentication" wizard. Requires:
 *
 *   - Read access to the secrets file (default
 *     `/data/statewave-admin/secrets.enc`, or wherever
 *     `STATEWAVE_ADMIN_STATE_DIR` was pointed).
 *   - The original `STATEWAVE_ADMIN_MASTER_KEY` value.
 *
 * Run from inside the admin container so it picks up the env that the
 * server itself uses:
 *
 *     docker exec quickstart-admin-1 node /app/scripts/recover-admin-password.mjs
 *
 * Or from outside, pointing the script at the volume mount:
 *
 *     STATEWAVE_ADMIN_MASTER_KEY=... \
 *     node statewave-admin/scripts/recover-admin-password.mjs \
 *       --file ~/docker/quickstart_admin_state/_data/secrets.enc
 *
 * Outputs JSON with admin_password (and any other persisted fields).
 *
 * Stdlib-only (node:fs + node:crypto) — runs against any Node ≥ 18
 * without an npm install. Mirrors the format that
 * `server/admin-secrets-store.ts` writes: a JSON envelope with PBKDF2
 * key derivation + AES-256-GCM authenticated encryption.
 */
import { readFileSync } from 'node:fs'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { parseArgs } from 'node:util'

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

let envelope
try {
  envelope = JSON.parse(readFileSync(filePath, 'utf8'))
} catch (exc) {
  console.error(`error: could not read ${filePath}: ${exc.message}`)
  process.exit(2)
}

// Format version pin — same constant as in admin-secrets-store.ts. If
// you're recovering an older file after a format bump, you'll need the
// older version of this script.
if (envelope.v !== 1) {
  console.error(`error: unknown secrets file format v${envelope.v}`)
  process.exit(2)
}

try {
  const salt = Buffer.from(envelope.salt, 'base64')
  const nonce = Buffer.from(envelope.nonce, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  // PBKDF2 params MUST match the writer: 200_000 iterations, SHA-256,
  // 32-byte key. Drift here makes decryption fail with a "bad tag"
  // error.
  const key = pbkdf2Sync(masterKey, salt, 200_000, 32, 'sha256')
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const blob = JSON.parse(plaintext.toString('utf8'))
  console.log(JSON.stringify(blob, null, 2))
} catch (exc) {
  console.error(
    `error: decryption failed: ${exc.message}\n` +
      'common causes: wrong master key, tampered file, mismatched format.',
  )
  process.exit(1)
}
