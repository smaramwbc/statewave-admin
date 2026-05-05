import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchEvalStatus,
  fetchLatestEvalReport,
  fetchSubjects,
  generateEvalQuestions,
  startEvalRun,
  suggestGroundingFromSubject,
  type EvalMode,
  type EvalQuestionForUI,
  type EvalReport,
  type EvalRunStatus,
  type EvalStatus,
  type SubjectListItem,
} from '../lib/api'
import { Button, SectionLabel } from './ui'
import { StatusChip } from './StatusChip'

/**
 * "Self-Healing Eval" card on the Diagnostics page.
 *
 * Operator-triggered LLM-graded eval. Disabled unless the LLM judge,
 * Statewave API, and demo agent are all configured server-side. The
 * card shows pre-flight cost (estimated LLM calls) before the operator
 * commits to a run, surfaces live progress while running, and renders
 * the finished report with copy buttons for JSON, markdown, and the
 * Copilot improvement prompt.
 *
 * No automatic firing — this is a privileged, billable operation.
 *
 * The advanced overrides (custom question bank, candidate prompt) live
 * inside `<details>` blocks so the default surface stays focused on the
 * primary action: pick a mode, see the cost, run the eval.
 */

/**
 * Deterministic starter prompt the operator can drop into the override
 * textarea. Crafted from the production-failure patterns the eval has
 * surfaced repeatedly: the agent ignores retrieved facts and falls
 * back to its training prior on direct factual questions.
 */
const SUGGESTED_STRICTER_PROMPT = [
  'You are the Statewave support agent.',
  '',
  'When Statewave docs facts are provided in the prompt, answer FROM those facts first.',
  'Do not replace retrieved facts with generic knowledge.',
  'Do not invent environment variables, backup methods, migration tools, SDK names,',
  'package names, endpoints, or deployment claims.',
  '',
  'If the retrieved docs do not support a claim, say so plainly — refuse to fabricate.',
  'Keep answers concise. For direct factual questions, lead with the exact retrieved fact.',
].join('\n')

const MODES: Array<{
  value: EvalMode
  label: string
  description: string
  questions: number
}> = [
  {
    value: 'smoke',
    label: 'Quick check',
    description: 'Levels 0–1 — basic identity and comparison (~8 questions).',
    questions: 8,
  },
  {
    value: 'developer',
    label: 'Developer eval',
    description: 'Levels 0–6 — install, API, code, debugging (~20 questions).',
    questions: 20,
  },
  {
    value: 'full',
    label: 'Full eval',
    description: 'Levels 0–9 — adds architecture, false-premise, drift (~40 questions).',
    questions: 40,
  },
]

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function fmtScore(n: number): string {
  return n.toFixed(2)
}

function statusToChip(s: EvalRunStatus): string {
  switch (s) {
    case 'pass':
      return 'ok'
    case 'partial':
      return 'degraded'
    case 'fail':
      return 'error'
    case 'running':
      return 'pending'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'unknown'
  }
}

function statusToLabel(s: EvalRunStatus): string {
  switch (s) {
    case 'pass':
      return 'Passed'
    case 'partial':
      return 'Partial'
    case 'fail':
      return 'Failed'
    case 'running':
      return 'Running'
    case 'error':
      return 'Error'
    case 'idle':
    default:
      return 'Idle'
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function SelfHealingEval() {
  const [status, setStatus] = useState<EvalStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [report, setReport] = useState<EvalReport | null>(null)
  const [mode, setMode] = useState<EvalMode>('smoke')
  const [maxQuestions, setMaxQuestions] = useState<number | ''>('')
  const [includeCode, setIncludeCode] = useState(true)
  const [includeDrift, setIncludeDrift] = useState(true)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [copyToast, setCopyToast] = useState<string | null>(null)
  // Subject picker drives BOTH (a) auto-suggesting topic+grounding from
  // that subject's compiled memories, and (b) the runtime subject the
  // demo agent answers from during the conversation phase. When unset,
  // the eval falls back to a hardcoded demo subject. Smoke probes are
  // independent and always use their own demo subject.
  const [subjects, setSubjects] = useState<SubjectListItem[] | null>(null)
  const [subjectId, setSubjectId] = useState<string>('')
  const [subjectsError, setSubjectsError] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestSource, setSuggestSource] = useState<{
    subject_id: string
    memory_count: number
  } | null>(null)
  // Eval-only agent prompt override. Used for the v1 fix-test loop:
  // operator pastes a candidate system prompt, runs eval against it,
  // sees comparison vs baseline. Never persisted as production config.
  const [promptOverride, setPromptOverride] = useState('')
  const [overrideEnabled, setOverrideEnabled] = useState(false)
  // When true, the next run carries baseline_run_id pointing at the
  // most recent finished run — gets a comparison block back.
  const [compareToPrevious, setCompareToPrevious] = useState(true)
  // Topic + grounding inputs feed the LLM-driven question generator. The
  // generated bank is shown in a collapsible preview; if present at Run
  // time the runner uses it instead of the static built-in bank.
  const [topic, setTopic] = useState('')
  const [grounding, setGrounding] = useState('')
  const [generatedQuestions, setGeneratedQuestions] = useState<EvalQuestionForUI[] | null>(null)
  const [generatedFor, setGeneratedFor] = useState<{
    topic: string
    grounding: string
    mode: EvalMode
  } | null>(null)
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When the operator kicks off a new run, the server's /status.latest
  // still points at the PREVIOUS finished run until the new one lands —
  // so a naïve "fetch latest report when run id changes" would re-show
  // the stale report milliseconds after we cleared it. Storing the
  // run id we want to skip lets us suppress that bounce.
  const ignoreReportForRunIdRef = useRef<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchEvalStatus()
      setStatus(next)
      setStatusError(null)
      // Pull the full report whenever the latest run id changes or a
      // run finished. Cheap because /report/latest is just a JSON read.
      // Skip the suppressed run id (set when the operator just clicked
      // Run — we don't want to flash the prior report back in).
      if (
        next.latest &&
        next.latest.run_id !== ignoreReportForRunIdRef.current &&
        (!report || report.run_id !== next.latest.run_id || report.status === 'running')
      ) {
        const r = await fetchLatestEvalReport()
        if (r) setReport(r)
      }
      // Once /status.latest changes to something other than the
      // suppressed id, the new run has finished — drop the suppression.
      if (
        ignoreReportForRunIdRef.current &&
        next.latest &&
        next.latest.run_id !== ignoreReportForRunIdRef.current
      ) {
        ignoreReportForRunIdRef.current = null
      }
    } catch (e) {
      setStatusError(
        e instanceof Error ? e.message : 'Failed to load eval status.',
      )
    }
  }, [report])

  useEffect(() => {
    // Initial status fetch on mount. The status response drives every
    // downstream control on this card, so this is a legitimate
    // mount-time data fetch — same pattern as DashboardPage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus()
  }, [refreshStatus])

  // Poll while a run is in flight so the operator sees progress without
  // having to refresh manually.
  useEffect(() => {
    const stop = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
    if (!status?.is_running) {
      stop()
      return stop
    }
    pollTimerRef.current = setTimeout(() => {
      void refreshStatus()
    }, 2000)
    return stop
  }, [status, refreshStatus])

  // Lazy-load the subject list once the card mounts. Quietly swallows
  // backend errors — the picker just stays empty if /admin/subjects is
  // unreachable; the rest of the card still works for static-bank runs.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetchSubjects({
          limit: 100,
          sort_by: 'last_activity',
          sort_order: 'desc',
        })
        if (cancelled) return
        setSubjects(r.subjects)
      } catch (e) {
        if (cancelled) return
        setSubjectsError(e instanceof Error ? e.message : 'Failed to load subjects.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onSuggestGrounding = useCallback(async () => {
    if (!subjectId || suggesting) return
    setSuggesting(true)
    setSuggestError(null)
    setSuggestSource(null)
    try {
      const r = await suggestGroundingFromSubject({ subject_id: subjectId })
      setTopic(r.topic)
      setGrounding(r.grounding)
      setSuggestSource({
        subject_id: r.source.subject_id,
        memory_count: r.source.memory_count,
      })
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Failed to suggest grounding.')
    } finally {
      setSuggesting(false)
    }
  }, [subjectId, suggesting])

  const onGenerate = useCallback(async () => {
    if (generating) return
    setGenerating(true)
    setGenerateError(null)
    setGenerateWarnings([])
    try {
      const result = await generateEvalQuestions({
        topic: topic.trim(),
        grounding,
        mode,
      })
      setGeneratedQuestions(result.questions)
      setGeneratedFor({ topic: topic.trim(), grounding, mode })
      setGenerateWarnings(result.warnings ?? [])
      setPreviewOpen(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate questions.'
      setGenerateError(msg)
      const warnings = (e as { warnings?: string[] }).warnings
      if (Array.isArray(warnings)) setGenerateWarnings(warnings)
    } finally {
      setGenerating(false)
    }
  }, [generating, topic, grounding, mode])

  // Generated bank is only valid for the (topic, grounding, mode) it was
  // generated against — change any of those and the bank is stale and
  // we fall back to the static one.
  const generatedBankIsLive =
    !!generatedQuestions &&
    !!generatedFor &&
    generatedFor.topic === topic.trim() &&
    generatedFor.grounding === grounding &&
    generatedFor.mode === mode

  const onRun = useCallback(async () => {
    if (starting || status?.is_running) return
    setStarting(true)
    setStartError(null)
    // Clear the prior report's strip / level table / recommendations the
    // moment a new run is kicked off — the operator should see a clean
    // "Running…" surface instead of stale numbers from the last run.
    // The polling loop will repopulate `report` when the new run lands.
    // Suppress the prior run id from /status.latest so the next refresh
    // doesn't immediately re-fetch and re-display the old report.
    if (status?.latest?.run_id) {
      ignoreReportForRunIdRef.current = status.latest.run_id
    }
    setReport(null)
    try {
      const body: Record<string, unknown> = {
        mode,
        ...(maxQuestions !== '' ? { max_questions: maxQuestions } : {}),
        include_code: includeCode,
        include_topic_drift: includeDrift,
      }
      if (subjectId.trim()) body.subject_id = subjectId.trim()
      if (generatedBankIsLive && generatedQuestions) {
        body.override_questions = generatedQuestions
      }
      // Eval-only agent prompt override (when toggled). Server-side
      // redacts secrets and caps the byte length before forwarding.
      if (overrideEnabled && promptOverride.trim().length > 0) {
        body.system_prompt_override = promptOverride
      }
      // Compare-to-previous: pin the most recent finished run as the
      // baseline so the runner attaches a comparison block.
      if (compareToPrevious && status?.latest?.run_id) {
        body.baseline_run_id = status.latest.run_id
      }
      const r = await startEvalRun(body)
      if (!r.ok) {
        setStartError(r.error ?? 'Could not start the eval run.')
      } else {
        // Force an immediate refresh so the running state lands on
        // screen instead of waiting for the next poll tick.
        await refreshStatus()
      }
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start run.')
    } finally {
      setStarting(false)
    }
  }, [
    mode,
    maxQuestions,
    includeCode,
    includeDrift,
    starting,
    status,
    refreshStatus,
    generatedBankIsLive,
    generatedQuestions,
    subjectId,
    overrideEnabled,
    promptOverride,
    compareToPrevious,
  ])

  const onCopy = useCallback(async (label: string, text: string) => {
    const ok = await copyToClipboard(text)
    setCopyToast(ok ? `${label} copied` : `Failed to copy ${label.toLowerCase()}`)
    setTimeout(() => setCopyToast(null), 2000)
  }, [])

  const availability = status?.availability
  const available = !!availability?.available
  const isRunning = !!status?.is_running

  // Build pre-flight cost estimate from the selected mode.
  const selectedMode = MODES.find((m) => m.value === mode) ?? MODES[0]
  const plannedQuestions =
    typeof maxQuestions === 'number' && maxQuestions > 0
      ? Math.min(maxQuestions, selectedMode.questions)
      : selectedMode.questions
  const estimatedCalls = plannedQuestions * 2

  // ─── Render ──────────────────────────────────────────────────────────────

  const overallChip = report ? statusToChip(report.status) : 'unknown'
  const overallLabel = report
    ? statusToLabel(report.status)
    : isRunning
      ? 'Running'
      : 'Not yet run'

  return (
    <section>
      <SectionLabel>Self-Healing Eval</SectionLabel>
      <div className="rounded-xl border border-theme-border bg-[var(--theme-card-bg)] p-5 space-y-5">
        {/* ── Availability banner ── */}
        {!available && availability && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
            <p className="font-medium">Self-Healing Eval is not available yet.</p>
            <p>
              Self-Healing Eval requires an LLM evaluator. Configure
              <code className="mx-1">ADMIN_EVAL_LLM_PROVIDER</code>,
              <code className="mx-1">ADMIN_EVAL_LLM_MODEL</code>, and
              <code className="mx-1">ADMIN_EVAL_LLM_API_KEY</code>.
            </p>
            {availability.reasons.length > 0 && (
              <ul className="list-disc pl-5 text-[11px] text-theme-muted">
                {availability.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {statusError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            <p className="font-medium">Could not load eval status.</p>
            <p className="mt-0.5 text-theme-muted">{statusError}</p>
          </div>
        )}

        {/* ── Header / status row ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-primary">
              {overallLabel}
              {report?.summary && (
                <span className="ml-2 text-xs text-theme-muted">
                  · {fmtScore(report.summary.overall_score)} ({fmtPct(report.summary.overall_score)})
                </span>
              )}
            </p>
            <p className="text-[11px] text-theme-muted mt-0.5">
              LLM-graded eval against the demo agent. Operator-triggered.
            </p>
          </div>
          <StatusChip status={overallChip} />
        </div>

        {/* ── Run controls ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-theme-muted">Mode</span>
            <select
              className="rounded-md border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 text-theme-primary"
              value={mode}
              disabled={!available || isRunning}
              onChange={(e) => setMode(e.target.value as EvalMode)}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} (≤{m.questions} questions)
                </option>
              ))}
            </select>
            <span className="text-[11px] text-theme-muted">{selectedMode.description}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-theme-muted">Max questions (override)</span>
            <input
              type="number"
              min={1}
              max={selectedMode.questions}
              placeholder={`default ${selectedMode.questions}`}
              className="rounded-md border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 text-theme-primary"
              value={maxQuestions}
              disabled={!available || isRunning}
              onChange={(e) => {
                const v = e.target.value
                setMaxQuestions(v === '' ? '' : Math.max(1, Number(v)))
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeCode}
              disabled={!available || isRunning}
              onChange={(e) => setIncludeCode(e.target.checked)}
            />
            <span>Include code / npm questions</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeDrift}
              disabled={!available || isRunning}
              onChange={(e) => setIncludeDrift(e.target.checked)}
            />
            <span>Include topic-drift questions</span>
          </label>
        </div>

        {/* ── Advanced: question bank override ── */}
        <details className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)]">
          <summary className="cursor-pointer px-3 py-2 text-xs text-theme-secondary select-none">
            Question bank — optional override
            {generatedBankIsLive && (
              <span className="ml-2 text-[10px] text-emerald-400">
                bank ready
              </span>
            )}
          </summary>
          <div className="px-3 pb-3 space-y-3">
            <p className="text-[11px] text-theme-muted">
              Skip this and the eval uses the built-in question bank. Use this to
              evaluate the agent against your own docs or a specific subject's
              compiled memories.
            </p>

            {/* Subject picker. Drives both the LLM auto-suggestion of
                topic+grounding AND the runtime subject the demo agent
                answers from during the conversation phase. Smoke probes
                upstream are independent and always use their own demo
                subject. When no subject is picked, the eval falls back
                to a hardcoded demo subject so it can't accidentally
                pollute a real customer subject. */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-theme-muted">
                  Subject (drives suggestion + runtime conversation)
                </span>
                <select
                  className="rounded-md border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 text-theme-primary"
                  value={subjectId}
                  disabled={!available || isRunning || suggesting}
                  onChange={(e) => {
                    setSubjectId(e.target.value)
                    setSuggestSource(null)
                    setSuggestError(null)
                  }}
                >
                  <option value="">
                    — Built-in demo subject (no eval against a real subject) —
                  </option>
                  {(subjects ?? []).map((s) => (
                    <option key={s.subject_id} value={s.subject_id}>
                      {s.subject_id} · {s.memory_count} memories · {s.episode_count}{' '}
                      episodes
                    </option>
                  ))}
                </select>
                {subjectsError && (
                  <span className="text-[11px] text-amber-400">
                    Subjects could not be loaded: {subjectsError}
                  </span>
                )}
              </label>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onSuggestGrounding}
                  loading={suggesting}
                  disabled={!available || isRunning || suggesting || !subjectId}
                  aria-label="Auto-suggest topic and grounding from selected subject"
                >
                  {suggesting ? 'Suggesting…' : 'Auto-suggest topic + grounding'}
                </Button>
              </div>
              {suggestError && (
                <div className="sm:col-span-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-400">
                  {suggestError}
                </div>
              )}
              {suggestSource && (
                <p className="sm:col-span-2 text-[11px] text-theme-muted">
                  Suggested from {suggestSource.memory_count} compiled memories of{' '}
                  <code>{suggestSource.subject_id}</code>. Edit topic/grounding below
                  if you want before generating.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-theme-muted">Topic</span>
                <input
                  type="text"
                  placeholder="e.g. Statewave memory runtime"
                  className="rounded-md border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 text-theme-primary"
                  value={topic}
                  disabled={!available || isRunning || generating}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-theme-muted">
                  Grounding (paste source-of-truth text — capped + redacted)
                </span>
                <textarea
                  rows={5}
                  placeholder="Paste the canonical docs / pack content for this topic. Required for `must_include` / `must_not_claim` to be concrete."
                  className="rounded-md border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 text-theme-primary font-mono text-[11px]"
                  value={grounding}
                  disabled={!available || isRunning || generating}
                  onChange={(e) => setGrounding(e.target.value)}
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-theme-muted">
                  {generatedBankIsLive
                    ? `Generated bank ready (${generatedQuestions?.length ?? 0} questions). Run will use it.`
                    : generatedQuestions
                      ? 'Inputs changed — generated bank is stale. Run will use the built-in bank unless you regenerate.'
                      : 'No generated bank yet. Run will use the built-in static bank.'}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onGenerate}
                  loading={generating}
                  disabled={
                    !available ||
                    isRunning ||
                    generating ||
                    topic.trim().length === 0 ||
                    grounding.trim().length < 20
                  }
                  aria-label="Generate questions from topic and grounding"
                >
                  {generating ? 'Generating…' : 'Generate questions'}
                </Button>
              </div>
              {generateError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[11px] text-red-400">
                  {generateError}
                </div>
              )}
              {generateWarnings.length > 0 && (
                <ul className="text-[11px] text-amber-400 list-disc pl-5 space-y-0.5">
                  {generateWarnings.slice(0, 6).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {generatedQuestions && (
                <details
                  open={previewOpen}
                  onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)}
                  className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)]"
                >
                  <summary className="cursor-pointer px-3 py-2 text-xs text-theme-secondary select-none">
                    Generated questions preview ({generatedQuestions.length})
                    {!generatedBankIsLive && (
                      <span className="ml-2 text-amber-400">[stale]</span>
                    )}
                  </summary>
                  <ol className="text-[11px] text-theme-muted divide-y divide-theme-border/50">
                    {generatedQuestions.slice(0, 30).map((q) => (
                      <li key={q.id} className="px-3 py-2">
                        <p className="text-theme-secondary">
                          <span className="font-mono mr-2">L{q.level}</span>
                          <span className="text-theme-muted mr-2">{q.category}</span>
                          <span className="font-mono text-[10px]">{q.id}</span>
                        </p>
                        <p className="mt-0.5 text-theme-muted">{q.question}</p>
                        {q.must_include.length > 0 && (
                          <p className="mt-0.5 text-[10px]">
                            <span className="text-theme-muted">must_include:</span>{' '}
                            {q.must_include.join(' · ')}
                          </p>
                        )}
                      </li>
                    ))}
                    {generatedQuestions.length > 30 && (
                      <li className="px-3 py-2 text-theme-muted">
                        … and {generatedQuestions.length - 30} more
                      </li>
                    )}
                  </ol>
                </details>
              )}
            </div>
          </div>
        </details>

        {/* ── Advanced: agent prompt override (eval-only, fix-test loop) ──
            Operator can paste a candidate system prompt; the runner
            forwards it to the demo agent for THIS run only. Never
            persisted as production config — the warning text says so.
            Server-side redacts + caps before storage. */}
        <details className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)]">
          <summary className="cursor-pointer px-3 py-2 text-xs text-theme-secondary select-none">
            Agent prompt override — eval-only
          </summary>
          <div className="px-3 pb-3 space-y-3">
            <div className="grid grid-cols-1 gap-2 text-xs">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={overrideEnabled}
                  disabled={!available || isRunning}
                  onChange={(e) => setOverrideEnabled(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Use override for next run
                  <span className="block text-theme-muted text-[11px] mt-0.5">
                    Temporary candidate prompt for this run only.{' '}
                    <strong>Does not change production agent behavior.</strong>{' '}
                    Server-side redacts secrets + caps length.
                  </span>
                </span>
              </label>
              <textarea
                rows={6}
                placeholder="Paste a candidate demo-agent system prompt here. The eval will run against this prompt instead of the production one for this run only."
                className="rounded-md border border-theme-border bg-[var(--theme-surface-1)] px-2 py-1.5 text-theme-primary font-mono text-[11px]"
                value={promptOverride}
                disabled={!available || isRunning || !overrideEnabled}
                onChange={(e) => setPromptOverride(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPromptOverride(SUGGESTED_STRICTER_PROMPT)
                    setOverrideEnabled(true)
                  }}
                  disabled={!available || isRunning}
                  aria-label="Insert suggested stricter docs-grounded prompt"
                >
                  Insert suggested stricter prompt
                </Button>
                <label className="flex items-center gap-1.5 text-[11px] text-theme-muted ml-auto">
                  <input
                    type="checkbox"
                    checked={compareToPrevious}
                    disabled={!available || isRunning || !status?.latest}
                    onChange={(e) => setCompareToPrevious(e.target.checked)}
                  />
                  Compare next run against latest previous run
                  {!status?.latest && (
                    <span className="text-amber-400">(no previous run yet)</span>
                  )}
                </label>
              </div>
            </div>
          </div>
        </details>

        {/* ── Pre-flight cost + run button ── */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-theme-border/50">
          <p className="text-[11px] text-theme-muted">
            Estimated eval interactions:{' '}
            <span className="text-theme-secondary">{plannedQuestions} demo-agent calls</span>
            {' + '}
            <span className="text-theme-secondary">{plannedQuestions} LLM judge calls</span>
            {' '}
            (~{plannedQuestions} questions, {estimatedCalls} total)
          </p>
          <Button
            variant="primary"
            size="sm"
            onClick={onRun}
            loading={starting}
            disabled={!available || isRunning || starting}
            aria-label="Run Self-Healing Eval"
          >
            {isRunning ? 'Running…' : starting ? 'Starting…' : 'Run Self-Healing Eval'}
          </Button>
        </div>

        {startError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {startError}
          </div>
        )}

        {/* ── Live progress ── */}
        {isRunning && status?.progress && (
          <div className="text-xs text-theme-muted">
            Progress: {status.progress.completed} / {status.progress.total}
            {status.progress.current_question_id && (
              <> · current: <code>{status.progress.current_question_id}</code></>
            )}
          </div>
        )}

        {/* ── Comparison delta strip (v1 fix-test loop). Only renders
            when the latest run carries a `comparison` block from a
            requested baseline_run_id. The numbers reflect candidate
            minus baseline, sign-prefixed so a glance tells the
            operator "did this change help?". */}
        {report?.comparison && (
          <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-3 text-xs space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-theme-muted">
              Comparison to baseline run{' '}
              <code className="text-theme-secondary">
                {report.comparison.baseline_run_id}
              </code>
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>
                Score:{' '}
                <span className="text-theme-secondary font-mono">
                  {fmtScore(report.comparison.candidate_score)}
                </span>{' '}
                <span
                  className={
                    report.comparison.score_delta > 0
                      ? 'text-emerald-400'
                      : report.comparison.score_delta < 0
                        ? 'text-red-400'
                        : 'text-theme-muted'
                  }
                >
                  ({report.comparison.score_delta >= 0 ? '+' : ''}
                  {fmtScore(report.comparison.score_delta)})
                </span>
              </span>
              <span>
                Pass Δ:{' '}
                <span
                  className={
                    report.comparison.pass_delta > 0
                      ? 'text-emerald-400'
                      : report.comparison.pass_delta < 0
                        ? 'text-red-400'
                        : 'text-theme-muted'
                  }
                >
                  {report.comparison.pass_delta >= 0 ? '+' : ''}
                  {report.comparison.pass_delta}
                </span>
              </span>
              <span>
                Fail Δ:{' '}
                <span
                  className={
                    report.comparison.fail_delta < 0
                      ? 'text-emerald-400'
                      : report.comparison.fail_delta > 0
                        ? 'text-red-400'
                        : 'text-theme-muted'
                  }
                >
                  {report.comparison.fail_delta >= 0 ? '+' : ''}
                  {report.comparison.fail_delta}
                </span>
              </span>
            </div>
            {(() => {
              const moved = Object.entries(report.comparison.root_cause_delta)
                .filter(([, info]) => info.delta !== 0)
                .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
              if (moved.length === 0) return null
              return (
                <p className="text-[11px] text-theme-muted">
                  Root cause shifts:{' '}
                  {moved.slice(0, 4).map(([cause, info], i) => (
                    <span key={cause}>
                      {i > 0 ? ' · ' : ''}
                      <code className="text-theme-secondary">{cause}</code>{' '}
                      {info.before}→{info.after}
                    </span>
                  ))}
                </p>
              )
            })()}
            {report.config.agent_prompt_override.used && (
              <p className="text-[11px] text-theme-muted">
                Agent prompt override:{' '}
                <code>{report.config.agent_prompt_override.delivery}</code>{' '}
                ({report.config.agent_prompt_override.length} chars)
              </p>
            )}
          </div>
        )}

        {/* ── Health / job / webhook strip from the last run ── */}
        {report && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-2.5">
              <p className="text-theme-muted text-[10px] uppercase tracking-wide">Health</p>
              <p className="text-theme-secondary mt-0.5">{report.health.status}</p>
            </div>
            <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-2.5">
              <p className="text-theme-muted text-[10px] uppercase tracking-wide">Demo job</p>
              <p className="text-theme-secondary mt-0.5">{report.demo_job.status}</p>
            </div>
            <div className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-2.5">
              <p className="text-theme-muted text-[10px] uppercase tracking-wide">Webhook</p>
              <p className="text-theme-secondary mt-0.5">{report.webhook.status}</p>
            </div>
          </div>
        )}

        {/* ── Level breakdown ── */}
        {report && Object.keys(report.summary_by_level).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-theme-muted">
                  <th className="text-left font-medium pb-2">Level</th>
                  <th className="text-left font-medium pb-2">Name</th>
                  <th className="text-right font-medium pb-2">Pass</th>
                  <th className="text-right font-medium pb-2">Partial</th>
                  <th className="text-right font-medium pb-2">Fail</th>
                  <th className="text-right font-medium pb-2">Avg</th>
                </tr>
              </thead>
              <tbody className="text-theme-secondary">
                {Object.entries(report.summary_by_level)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([k, l]) => (
                    <tr key={k} className="border-t border-theme-border/50">
                      <td className="py-1.5 font-mono">L{k}</td>
                      <td className="py-1.5 text-theme-muted">{l.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.passes}</td>
                      <td className="py-1.5 text-right tabular-nums">{l.partials}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.fails > 0 ? <span className="text-red-400">{l.fails}</span> : 0}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmtScore(l.average_score)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Recommendations ── */}
        {report && report.recommendations.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-theme-muted uppercase tracking-wide">Recommendations</p>
            <ul className="space-y-1.5 text-xs">
              {report.recommendations.slice(0, 5).map((rec, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)] p-2.5"
                >
                  <p className="font-medium text-theme-primary">
                    [{rec.priority.toUpperCase()}] {rec.area}
                  </p>
                  <p className="text-theme-muted mt-0.5">{rec.problem}</p>
                  <p className="text-theme-secondary mt-1">{rec.recommended_change}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Run details (collapsed by default — keeps the surface tidy) ── */}
        {report && status?.latest && (
          <details className="rounded-lg border border-theme-border bg-[var(--theme-surface-1)]">
            <summary className="cursor-pointer px-3 py-2 text-xs text-theme-secondary select-none">
              Run details
            </summary>
            <div className="px-3 pb-3 text-[11px] text-theme-muted space-y-0.5">
              <p>
                Run id: <code>{status.latest.run_id}</code>
              </p>
              {status.latest.finished_at && (
                <p>
                  Finished: {new Date(status.latest.finished_at).toLocaleString()}
                </p>
              )}
              <p>Mode: {status.latest.mode}</p>
            </div>
          </details>
        )}

        {/* ── Copy buttons ── */}
        {report && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-theme-border/50">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onCopy('JSON report', JSON.stringify(report, null, 2))}
            >
              Copy JSON report
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  const md = await (await fetch('/api/self-healing-eval/report/latest?format=markdown', {
                    credentials: 'same-origin',
                  })).text()
                  void onCopy('Markdown report', md)
                } catch {
                  setCopyToast('Failed to copy markdown report')
                  setTimeout(() => setCopyToast(null), 2000)
                }
              }}
            >
              Copy markdown report
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onCopy('Copilot prompt', report.copilot_prompt)}
            >
              Copy Copilot improvement prompt
            </Button>
            {copyToast && <span className="text-xs text-theme-muted self-center">{copyToast}</span>}
          </div>
        )}
      </div>
    </section>
  )
}
