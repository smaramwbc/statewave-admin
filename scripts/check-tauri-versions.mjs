#!/usr/bin/env node
/**
 * Tauri refuses to build when the npm packages and the Rust crate disagree:
 *
 *   Error Found version mismatched Tauri packages. Make sure the NPM package
 *   and Rust crate versions match.
 *
 * Only the release workflow builds the GUI, so a bump to one side alone
 * passes pull-request CI and lands a main branch whose desktop release
 * cannot build. That happened: the Rust crate went to 2.12.0 while
 * @tauri-apps/api stayed pinned ^2.11.1.
 *
 * This compares the two and fails fast, in seconds, on every pull request.
 */
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = readFileSync('desktop/Cargo.lock', 'utf8')

function crateVersion(name) {
  // Cargo.lock entries are [[package]] blocks with name then version.
  const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`, 'm')
  return lock.match(re)?.[1] ?? null
}

const failures = []
// @tauri-apps/<x> must track the Rust crate of the same family.
const pairs = [
  ['@tauri-apps/api', 'tauri'],
  ['@tauri-apps/plugin-dialog', 'tauri-plugin-dialog'],
  ['@tauri-apps/plugin-shell', 'tauri-plugin-shell'],
]

for (const [npmName, crateName] of pairs) {
  const spec = pkg.dependencies?.[npmName] ?? pkg.devDependencies?.[npmName]
  if (!spec) continue
  const crate = crateVersion(crateName)
  if (!crate) {
    failures.push(`${npmName} is declared but ${crateName} is not in desktop/Cargo.lock`)
    continue
  }
  // Compare minor lines: a caret range cannot reach a higher minor, which is
  // exactly how the two drift apart.
  const npmMinor = spec.replace(/^[^0-9]*/, '').split('.').slice(0, 2).join('.')
  const crateMinor = crate.split('.').slice(0, 2).join('.')
  if (npmMinor !== crateMinor) {
    failures.push(
      `${npmName} ${spec} cannot resolve into the ${crateName} ${crate} line ` +
        `(npm ${npmMinor}.x vs crate ${crateMinor}.x)`,
    )
  }
}

if (failures.length) {
  console.error('Tauri npm and Rust versions disagree, the desktop build will fail:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('Tauri npm and Rust crate versions agree')
