/**
 * Eval report storage.
 *
 * In-process by default. When ADMIN_EVAL_STORAGE_PATH is set we ALSO
 * persist:
 *   <path>/latest.json       — most recent finished report
 *   <path>/runs/<run_id>.json — every finished report by run id
 *
 * Failures during persistence are best-effort: the in-memory copy is
 * always authoritative, and the runner does not abort if the disk is
 * read-only or the dir is missing. We simply log to stderr.
 *
 * Every value is run through `redactValue` before serialisation so a
 * persisted report never contains an API key.
 */
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { redactValue } from './redact.js'
import type { EvalReport } from './types.js'

interface StorageState {
  latest: EvalReport | null
  byId: Map<string, EvalReport>
  /** The currently in-flight report, surfaced to /status while running. */
  current: EvalReport | null
  loadedFromDisk: boolean
}

const state: StorageState = {
  latest: null,
  byId: new Map(),
  current: null,
  loadedFromDisk: false,
}

export function _resetEvalStorageForTests(): void {
  state.latest = null
  state.byId = new Map()
  state.current = null
  state.loadedFromDisk = false
}

function resolvedPath(path: string | null): string | null {
  if (!path) return null
  return resolve(path)
}

async function loadFromDisk(path: string | null): Promise<void> {
  if (state.loadedFromDisk) return
  state.loadedFromDisk = true
  const root = resolvedPath(path)
  if (!root) return
  try {
    const text = await readFile(join(root, 'latest.json'), 'utf8')
    state.latest = JSON.parse(text) as EvalReport
  } catch {
    // first boot or unreadable
  }
  try {
    const runs = await readdir(join(root, 'runs'))
    for (const file of runs) {
      if (!file.endsWith('.json')) continue
      try {
        const text = await readFile(join(root, 'runs', file), 'utf8')
        const report = JSON.parse(text) as EvalReport
        if (report?.run_id) {
          state.byId.set(report.run_id, report)
        }
      } catch {
        // skip corrupt files; surfacing them in the UI is overkill for MVP
      }
    }
  } catch {
    // no runs dir yet
  }
}

async function persistToDisk(path: string | null, report: EvalReport): Promise<void> {
  const root = resolvedPath(path)
  if (!root) return
  try {
    await mkdir(join(root, 'runs'), { recursive: true })
    const redacted = redactValue(report)
    const json = JSON.stringify(redacted, null, 2)
    await writeFile(join(root, 'latest.json'), json, 'utf8')
    await writeFile(join(root, 'runs', `${report.run_id}.json`), json, 'utf8')
  } catch (e) {
    // Best-effort. The in-memory copy is the source of truth for the
    // current admin process; persistence is only for cross-restart audit.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[self-healing-eval] persist failed:', e)
    }
  }
}

export async function setCurrentRunningReport(
  path: string | null,
  report: EvalReport,
): Promise<void> {
  await loadFromDisk(path)
  state.current = report
}

export async function updateCurrentRunningReport(report: EvalReport): Promise<void> {
  state.current = report
}

export async function finalizeReport(
  path: string | null,
  report: EvalReport,
): Promise<void> {
  await loadFromDisk(path)
  state.current = null
  state.latest = report
  state.byId.set(report.run_id, report)
  await persistToDisk(path, report)
}

export async function getLatest(path: string | null): Promise<EvalReport | null> {
  await loadFromDisk(path)
  return state.latest
}

export async function getById(
  path: string | null,
  runId: string,
): Promise<EvalReport | null> {
  await loadFromDisk(path)
  const inMemory = state.byId.get(runId)
  if (inMemory) return inMemory
  const root = resolvedPath(path)
  if (!root) return null
  try {
    const text = await readFile(join(root, 'runs', `${runId}.json`), 'utf8')
    const report = JSON.parse(text) as EvalReport
    state.byId.set(runId, report)
    return report
  } catch {
    return null
  }
}

export async function getCurrent(path: string | null): Promise<EvalReport | null> {
  await loadFromDisk(path)
  return state.current
}

export function isRunning(): boolean {
  return state.current !== null
}
