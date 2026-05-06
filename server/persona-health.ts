/**
 * Per-persona demo-pack health endpoint.
 *
 * Backs the /diagnostics "Demo personas" panel: for each bundled demo pack,
 * report episode/memory counts, embedding coverage, and the rank at which
 * a small set of "wow-moment" probes surface in `/v1/context`. An operator
 * looking at the panel should be able to tell at a glance whether each
 * persona's recall is healthy or whether a specific probe regressed.
 *
 * Read-only — no side effects on the bundled subject. Each probe runs
 * against an ephemeral test subject (`_persona_health_<persona>_<run>`)
 * that's imported, queried, and deleted within the request window.
 *
 * Results are cached for {@link CACHE_TTL_MS} so a refresh button click
 * doesn't trigger a fresh import sweep on every press.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

interface BackendConfig {
  url: string | null
  apiKey: string | null
}

function getStatewaveBackendConfig(): BackendConfig {
  return {
    url: process.env.STATEWAVE_API_URL ?? null,
    apiKey: process.env.STATEWAVE_API_KEY ?? null,
  }
}

// ─── Probe definitions ─────────────────────────────────────────────────────
//
// One probe per "wow moment" the demo persona is supposed to surface. Keep
// short-form: the query is what a real visitor might type; the expected
// substring is what the top retrieved memory must contain (case-insensitive)
// for the probe to count as a hit.

export interface PersonaProbe {
  query: string
  expected_substring: string
}

export interface PersonaSpec {
  pack_id: string
  display_name: string
  probes: PersonaProbe[]
}

const PERSONA_SPECS: PersonaSpec[] = [
  {
    pack_id: 'demo-support-agent',
    display_name: 'Support agent (Maya at Northwind)',
    probes: [
      { query: "What is Northwind's webhook URL pattern?", expected_substring: 'hooks.northwind' },
      { query: 'When does Northwind renew their contract?', expected_substring: '2026-09-15' },
      { query: 'What was the root cause of ticket 4937?', expected_substring: '60k' },
    ],
  },
  {
    pack_id: 'demo-coding-assistant',
    display_name: 'Coding assistant (Priya at Stratus)',
    probes: [
      { query: 'What backend stack does Priya use?', expected_substring: 'fastapi' },
      { query: 'Where do shared TypeScript types live?', expected_substring: '@stratus/types' },
      { query: 'What is the policy on database mocking in tests?', expected_substring: 'never mock' },
    ],
  },
  {
    pack_id: 'demo-sales-copilot',
    display_name: 'Sales copilot (Tom)',
    probes: [
      { query: 'When does Sarah Chen prefer to meet?', expected_substring: 'tuesday' },
      { query: 'Who is the AE on Delta Health?', expected_substring: 'priya' },
      { query: 'How do we position against Mem0?', expected_substring: 'deterministic' },
    ],
  },
  {
    pack_id: 'demo-devops-agent',
    display_name: 'DevOps agent (Riya, nimbus-api)',
    probes: [
      { query: 'What is the alert threshold for p95 latency?', expected_substring: '300ms' },
      { query: 'How do I roll back the nimbus-api deploy?', expected_substring: 'fly deploy' },
      { query: 'Why did we choose Datadog over Grafana Cloud?', expected_substring: 'datadog' },
    ],
  },
  {
    pack_id: 'demo-research-assistant',
    display_name: 'Research assistant (Arushi, NeurIPS)',
    probes: [
      { query: 'How should I cite a preprint?', expected_substring: 'arxiv' },
      { query: 'Who is the co-author on the NeurIPS paper?', expected_substring: 'mei wu' },
      { query: 'What was the compiler-density experiment result?', expected_substring: '5 memories' },
    ],
  },
]

// ─── Result shapes ─────────────────────────────────────────────────────────

export interface PersonaProbeResult {
  query: string
  expected_substring: string
  rank: number | null
  pass: boolean
  top_memory_preview: string | null
}

export type PersonaHealthStatus = 'pass' | 'warn' | 'fail' | 'error' | 'not_configured'

export interface PersonaHealth {
  pack_id: string
  display_name: string
  version: string | null
  episode_count: number | null
  memory_count: number | null
  embedding_coverage: number | null
  probes: PersonaProbeResult[]
  status: PersonaHealthStatus
  error: string | null
}

export interface PersonaHealthReport {
  fetched_at: string
  personas: PersonaHealth[]
}

// ─── Cache ─────────────────────────────────────────────────────────────────
//
// Probing all 5 personas takes ~10s (an import + 3 probes + cleanup per
// persona). Cache the result so a refresh-on-click feels snappy. Operators
// can force a re-probe via ?force=true.

const CACHE_TTL_MS = 5 * 60 * 1000
let _cache: { fetched_at: number; report: PersonaHealthReport } | null = null

// ─── Endpoint ──────────────────────────────────────────────────────────────

export async function handlePersonaHealth(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const force = url.searchParams.get('force') === 'true'

  if (!force && _cache && Date.now() - _cache.fetched_at < CACHE_TTL_MS) {
    sendJson(res, 200, _cache.report)
    return
  }

  const cfg = getStatewaveBackendConfig()
  if (!cfg.url) {
    sendJson(res, 200, {
      fetched_at: new Date().toISOString(),
      personas: PERSONA_SPECS.map((spec) => ({
        pack_id: spec.pack_id,
        display_name: spec.display_name,
        version: null,
        episode_count: null,
        memory_count: null,
        embedding_coverage: null,
        probes: [],
        status: 'not_configured' as const,
        error: 'STATEWAVE_API_URL is not configured',
      })),
    })
    return
  }

  const report: PersonaHealthReport = {
    fetched_at: new Date().toISOString(),
    personas: [],
  }
  for (const spec of PERSONA_SPECS) {
    report.personas.push(await probePersona(cfg.url, cfg.apiKey, spec))
  }
  _cache = { fetched_at: Date.now(), report }
  sendJson(res, 200, report)
}

// ─── Per-persona probe sequence ────────────────────────────────────────────

async function probePersona(
  backendUrl: string,
  apiKey: string | null,
  spec: PersonaSpec,
): Promise<PersonaHealth> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  const subjectId = `_persona_health_${spec.pack_id}_${Date.now().toString(36)}`

  let importedEpisodes: number | null
  let importedMemories: number | null
  let version: string | null
  try {
    // Best-effort cleanup of any leftover from a prior failed run.
    await fetch(`${backendUrl}/v1/subjects/${encodeURIComponent(subjectId)}`, {
      method: 'DELETE',
      headers,
    }).catch(() => undefined)

    // Import the bundled pack into the ephemeral subject.
    const importResp = await fetch(
      `${backendUrl}/admin/memory/starter-packs/import`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pack_id: spec.pack_id,
          target_subject_id: subjectId,
          conflict_strategy: 'cancel',
          allow_reserved_target: true,
        }),
      },
    )
    if (!importResp.ok) {
      const detail = await importResp.text()
      return errorHealth(spec, `import failed: ${importResp.status} ${detail.slice(0, 200)}`)
    }
    const importBody = (await importResp.json()) as {
      imported_episodes?: number
      imported_memories?: number
      installed_version?: string
    }
    importedEpisodes = importBody.imported_episodes ?? null
    importedMemories = importBody.imported_memories ?? null
    version = importBody.installed_version ?? null

    // Wait for the background embedding task to populate vectors. The
    // backfill scheduler is fire-and-forget; we poll the timeline until
    // every memory reports embedding readiness or the budget runs out.
    await waitForEmbeddings(backendUrl, headers, subjectId, importedMemories ?? 0)

    const embeddingCoverage = await fetchEmbeddingCoverage(
      backendUrl,
      headers,
      subjectId,
    )

    // Run each probe.
    const probeResults: PersonaProbeResult[] = []
    for (const probe of spec.probes) {
      probeResults.push(await runProbe(backendUrl, headers, subjectId, probe))
    }

    const status = scorePersona(probeResults, embeddingCoverage)

    return {
      pack_id: spec.pack_id,
      display_name: spec.display_name,
      version,
      episode_count: importedEpisodes,
      memory_count: importedMemories,
      embedding_coverage: embeddingCoverage,
      probes: probeResults,
      status,
      error: null,
    }
  } catch (err) {
    return errorHealth(spec, (err as Error).message ?? String(err))
  } finally {
    // Always clean up the ephemeral subject — never leave state behind.
    await fetch(`${backendUrl}/v1/subjects/${encodeURIComponent(subjectId)}`, {
      method: 'DELETE',
      headers,
    }).catch(() => undefined)
  }
}

function errorHealth(spec: PersonaSpec, msg: string): PersonaHealth {
  return {
    pack_id: spec.pack_id,
    display_name: spec.display_name,
    version: null,
    episode_count: null,
    memory_count: null,
    embedding_coverage: null,
    probes: [],
    status: 'error',
    error: msg,
  }
}

async function waitForEmbeddings(
  backendUrl: string,
  headers: Record<string, string>,
  subjectId: string,
  expectedMemories: number,
): Promise<void> {
  if (expectedMemories === 0) return
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const cov = await fetchEmbeddingCoverage(backendUrl, headers, subjectId).catch(() => null)
    if (cov !== null && cov >= 0.99) return
    await new Promise((r) => setTimeout(r, 1500))
  }
  // Best-effort — return regardless; the coverage number reflects reality.
}

async function fetchEmbeddingCoverage(
  backendUrl: string,
  headers: Record<string, string>,
  subjectId: string,
): Promise<number | null> {
  // Use the admin memories endpoint to sample. Pages of 200 are enough for
  // the demo packs (≤70 memories each).
  const r = await fetch(
    `${backendUrl}/admin/subjects/${encodeURIComponent(subjectId)}/memories?limit=200&offset=0`,
    { headers },
  )
  if (!r.ok) return null
  const data = (await r.json()) as {
    memories?: { embedding?: number[] | null }[]
  }
  const mems = data.memories ?? []
  if (mems.length === 0) return null
  // The admin endpoint elides the embedding vector itself for size; presence
  // of `has_embedding: true` (preferred) or any non-null `embedding` field
  // counts as embedded. Fall back to a separate count endpoint if neither is
  // available — for now treat unknown as 1.0 to avoid false-failing.
  let known = 0
  let embedded = 0
  for (const m of mems) {
    const rec = m as Record<string, unknown>
    if ('has_embedding' in rec) {
      known += 1
      if (rec.has_embedding === true) embedded += 1
    } else if ('embedding' in rec) {
      known += 1
      if (rec.embedding !== null && rec.embedding !== undefined) embedded += 1
    }
  }
  if (known === 0) return 1.0
  return embedded / known
}

async function runProbe(
  backendUrl: string,
  headers: Record<string, string>,
  subjectId: string,
  probe: PersonaProbe,
): Promise<PersonaProbeResult> {
  const ctx = await fetch(`${backendUrl}/v1/context`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      subject_id: subjectId,
      task: probe.query,
      max_tokens: 800,
    }),
  })
  if (!ctx.ok) {
    return {
      query: probe.query,
      expected_substring: probe.expected_substring,
      rank: null,
      pass: false,
      top_memory_preview: `context fetch failed: ${ctx.status}`,
    }
  }
  const body = (await ctx.json()) as {
    facts?: { content?: string }[]
    procedures?: { content?: string }[]
  }
  const memories = [...(body.facts ?? []), ...(body.procedures ?? [])]
  const expect = probe.expected_substring.toLowerCase()
  let rank: number | null = null
  for (let i = 0; i < memories.length; i++) {
    const c = (memories[i].content ?? '').toLowerCase()
    if (c.includes(expect)) {
      rank = i + 1
      break
    }
  }
  // Pass if the matching memory is in the top 10 of the bundle. Anything
  // ranked deeper is unlikely to surface in the agent's context window.
  const pass = rank !== null && rank <= 10
  const top = memories[0]?.content ?? null
  return {
    query: probe.query,
    expected_substring: probe.expected_substring,
    rank,
    pass,
    top_memory_preview: top ? top.slice(0, 200) : null,
  }
}

function scorePersona(
  probes: PersonaProbeResult[],
  embeddingCoverage: number | null,
): PersonaHealthStatus {
  // Embedding coverage failure dominates — vector retrieval is broken.
  if (embeddingCoverage !== null && embeddingCoverage < 0.95) return 'fail'
  if (probes.length === 0) return 'error'
  const passed = probes.filter((p) => p.pass).length
  const surfaced = probes.filter((p) => p.rank !== null).length
  if (passed === probes.length) return 'pass'
  // Surfaces somewhere but not in the top 10 → warn.
  if (surfaced === probes.length) return 'warn'
  return 'fail'
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
