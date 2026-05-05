/**
 * Report assembly + formatting.
 *
 * Three outputs, all deterministic — no extra LLM call:
 *   - the full JSON report (already accumulated by the runner)
 *   - a human-readable Markdown rendering for review/sharing
 *   - a Copilot-ready improvement prompt assembled from the report's
 *     failure signals
 *
 * Determinism matters: the operator can run the eval, copy the prompt,
 * paste it into Copilot, and reproduce or compare results.
 */
import { findMustIncludeMatches } from './mustIncludeMatcher.js'
import { LEVEL_NAMES } from './questionBank.js'
import { redactString, redactValue } from './redact.js'
import type {
  CategorySummary,
  ConversationTurn,
  EvalLevel,
  EvalReport,
  LevelSummary,
  ReportRecommendation,
  RootCause,
  RootCauseSummary,
} from './types.js'

// ─── Aggregate summaries ──────────────────────────────────────────────

export function summarize(turns: ConversationTurn[]): {
  summary: EvalReport['summary']
  byLevel: Record<string, LevelSummary>
  byCategory: Record<string, CategorySummary>
  byRootCause: Record<string, RootCauseSummary>
} {
  let total = 0
  let passes = 0
  let partials = 0
  let fails = 0
  let weighted = 0
  let weightSum = 0
  const byLevel: Record<string, LevelSummary> = {}
  const byCategory: Record<string, CategorySummary> = {}
  const byRootCause: Record<string, RootCauseSummary> = {}

  for (const t of turns) {
    total += 1
    if (t.evaluation.verdict === 'pass') passes += 1
    else if (t.evaluation.verdict === 'partial') partials += 1
    else fails += 1
    weighted += t.evaluation.overall_score
    weightSum += 1

    const lvlKey = String(t.level)
    if (!byLevel[lvlKey]) {
      byLevel[lvlKey] = {
        name: LEVEL_NAMES[t.level as EvalLevel] ?? `level ${lvlKey}`,
        turns_total: 0,
        passes: 0,
        partials: 0,
        fails: 0,
        average_score: 0,
      }
    }
    const lvl = byLevel[lvlKey]
    lvl.turns_total += 1
    if (t.evaluation.verdict === 'pass') lvl.passes += 1
    else if (t.evaluation.verdict === 'partial') lvl.partials += 1
    else lvl.fails += 1
    lvl.average_score =
      (lvl.average_score * (lvl.turns_total - 1) + t.evaluation.overall_score) /
      lvl.turns_total

    if (!byCategory[t.category]) {
      byCategory[t.category] = {
        turns_total: 0,
        passes: 0,
        partials: 0,
        fails: 0,
        average_score: 0,
      }
    }
    const cat = byCategory[t.category]
    cat.turns_total += 1
    if (t.evaluation.verdict === 'pass') cat.passes += 1
    else if (t.evaluation.verdict === 'partial') cat.partials += 1
    else cat.fails += 1
    cat.average_score =
      (cat.average_score * (cat.turns_total - 1) + t.evaluation.overall_score) /
      cat.turns_total

    for (const cause of t.evaluation.likely_root_cause) {
      if (!byRootCause[cause]) {
        byRootCause[cause] = { count: 0, example_turn_ids: [] }
      }
      const rc = byRootCause[cause]
      rc.count += 1
      if (rc.example_turn_ids.length < 5) {
        rc.example_turn_ids.push(t.turn_id)
      }
    }
  }

  return {
    summary: {
      turns_total: total,
      passes,
      partials,
      fails,
      overall_score: weightSum > 0 ? weighted / weightSum : 0,
    },
    byLevel,
    byCategory,
    byRootCause,
  }
}

// ─── Recommendations ──────────────────────────────────────────────────

const ROOT_CAUSE_RECOMMENDATIONS: Record<RootCause, Omit<ReportRecommendation, 'priority'>> = {
  'missing-docs': {
    area: 'docs-memory-pack',
    problem:
      'Retrieval ran but the docs corpus genuinely lacks the topic this question expects.',
    recommended_change:
      'Add a canonical section for the missing topic to statewave-docs and re-seed the docs memory pack. Only do this when the retrieval probe confirms the relevant doc is missing — for retrieval misses, fix retrieval first.',
    acceptance_criteria: [
      'Failed questions return a docs-grounded answer with provenance after the docs update + re-seed',
      'Retrieval probe for the same question now surfaces the new memory',
    ],
  },
  'weak-docs-memory-pack': {
    area: 'docs-memory-pack',
    problem:
      'Docs exist but the compiled memory pack is too thin / poorly chunked, so retrieval cannot match the question to the right chunk.',
    recommended_change:
      'Inspect the compiled memories on the docs subject for the failing topic. Expand chunk summaries, add metadata.source_path, and consider regenerating memories with a better compile prompt.',
    acceptance_criteria: [
      'Retrieval probe surfaces the expected chunk for the failing question',
      'Average score for this category rises above 0.8',
    ],
  },
  'retrieval-miss': {
    area: 'retrieval',
    problem:
      'The retrieval probe pulled memories from the docs subject but none contained the expected fact for this question.',
    recommended_change:
      'Test /v1/context against the docs subject with the failing question; rephrase the retrieval query (or add query expansion in the demo agent), and consider adding alias / synonym memories so broad L0 questions ("what is an episode?") match the canonical chunk.',
    acceptance_criteria: [
      'POST /v1/context with the failing question returns the expected memory in the top results',
      'No retrieval-miss root causes for this question on a re-run',
    ],
  },
  'retrieved-context-ignored': {
    area: 'demo-agent-prompt',
    problem:
      'The retrieval probe surfaced the expected fact but the agent answered without using it.',
    recommended_change:
      'Tighten the demo agent system prompt: require the agent to lead with retrieved facts, cite source paths when present, and refuse to answer L0 questions without using a retrieved fact. Consider a stronger answer template or a stricter model.',
    acceptance_criteria: [
      'No retrieved-context-ignored root causes on a re-run for the same questions',
      'Failed L0 questions now lead the answer with the retrieved fact',
    ],
  },
  'eval-judge-context-blindness': {
    area: 'admin',
    problem:
      'The retrieval probe failed to run for one or more turns, so the judge could not distinguish missing-docs from retrieval-miss.',
    recommended_change:
      'Verify STATEWAVE_API_URL is reachable from admin and that ADMIN_EVAL_DOCS_SUBJECT_ID points at a populated subject. /v1/context must respond before the judge can ground its classification.',
    acceptance_criteria: [
      'No eval-judge-context-blindness root causes on a re-run',
      'Each docs-grounded turn shows retrieved_context.status="pass" in the report',
    ],
  },
  'demo-agent-prompt': {
    area: 'demo-agent-prompt',
    problem: 'The demo agent prompt is not steering the model toward grounded, scoped answers.',
    recommended_change:
      'Tighten the demo agent system prompt: require docs grounding, refuse off-topic, name out-of-scope sections explicitly.',
    acceptance_criteria: [
      'Topic-drift level scores rise above 0.7',
      'False-premise level scores rise above 0.7',
    ],
  },
  'hallucinated-code-or-api': {
    area: 'docs-memory-pack',
    problem: 'The agent invented endpoints, parameters, or code shapes not in the docs.',
    recommended_change:
      'Add explicit "do not invent" guardrails in the demo agent prompt; expand the docs to cover the missing surface honestly.',
    acceptance_criteria: [
      'No invented endpoint names appear in evaluated answers',
      'Level 4/5 averages rise above 0.8',
    ],
  },
  'unsupported-npm-sdk-claim': {
    area: 'docs-memory-pack',
    problem: 'The agent claimed an npm package or SDK that is not documented.',
    recommended_change:
      'Either document the official package name and install command, or update the demo agent prompt to admit honest uncertainty when not in the docs.',
    acceptance_criteria: [
      'No invented npm package names in answers',
      'Level 5 (developer usage) average score rises above 0.8',
    ],
  },
  'weak-topic-drift-handling': {
    area: 'demo-agent-prompt',
    problem: 'The agent followed off-topic asks instead of staying scoped.',
    recommended_change:
      'Add an explicit scope-boundary clause to the demo agent prompt for Level 9 prompts.',
    acceptance_criteria: ['Level 9 average score rises above 0.6'],
  },
  'false-premise-not-corrected': {
    area: 'demo-agent-prompt',
    problem: 'The agent accepted a false premise instead of correcting it.',
    recommended_change:
      'Add a "challenge incorrect assumptions" clause to the demo agent prompt and provide examples in the memory pack.',
    acceptance_criteria: ['Level 8 average score rises above 0.7'],
  },
  'webhook-config': {
    area: 'webhook',
    problem: 'Webhook delivery is not configured or not reaching its destination.',
    recommended_change:
      'Set STATEWAVE_WEBHOOK_URL on the Statewave server and re-run the eval to verify delivery.',
    acceptance_criteria: ['/admin/webhooks shows new events as delivered after the eval'],
  },
  'statewave-api-health': {
    area: 'core-api',
    problem: 'Statewave API health degraded during the run.',
    recommended_change:
      'Inspect /readyz and /admin/dashboard checks; verify Postgres connectivity and migrations.',
    acceptance_criteria: ['/readyz reports ok', 'Dashboard readiness is green'],
  },
  'admin-diagnostics': {
    area: 'admin',
    problem: 'Admin-side diagnostics infrastructure (LLM judge, demo agent client) failed during the run.',
    recommended_change:
      'Re-check ADMIN_EVAL_LLM_* and ADMIN_DEMO_AGENT_* env vars; confirm reachability of both endpoints.',
    acceptance_criteria: ['No admin-diagnostics root causes appear in the next run'],
  },
  'unclear-user-question': {
    area: 'tests',
    problem: 'A test question is ambiguous and may be unfairly graded.',
    recommended_change:
      'Refine the question wording and the must_include / must_not_claim metadata in the question bank.',
    acceptance_criteria: ['Re-graded turn now has a deterministic verdict'],
  },
  unknown: {
    area: 'tests',
    problem: 'Failure root cause unclassified.',
    recommended_change:
      'Inspect the per-turn evaluation and update the eval question metadata or judge prompt to disambiguate.',
    acceptance_criteria: ['Failed turn classifies into a concrete root cause on a follow-up run'],
  },
}

export function buildRecommendations(
  byRootCause: Record<string, RootCauseSummary>,
  byLevel: Record<string, LevelSummary>,
): ReportRecommendation[] {
  const recs: ReportRecommendation[] = []
  for (const [cause, info] of Object.entries(byRootCause)) {
    if (info.count <= 0) continue
    const tpl = ROOT_CAUSE_RECOMMENDATIONS[cause as RootCause]
    if (!tpl) continue
    const priority: ReportRecommendation['priority'] =
      info.count >= 3 ? 'high' : info.count === 2 ? 'medium' : 'low'
    recs.push({ priority, ...tpl })
  }
  // Bump priority when a level fails outright.
  for (const [, lvl] of Object.entries(byLevel)) {
    if (lvl.fails > 0 && lvl.average_score < 0.5) {
      const top = recs.find((r) => r.area === 'demo-agent-prompt' || r.area === 'docs-memory-pack')
      if (top) top.priority = 'high'
    }
  }
  recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority]
  })
  return recs
}

// ─── Markdown ─────────────────────────────────────────────────────────

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function fmtScore(n: number): string {
  return n.toFixed(2)
}

export function renderMarkdownReport(report: EvalReport): string {
  const r = redactValue(report)
  const lines: string[] = []
  const verdictBadge =
    r.status === 'pass'
      ? '✅ PASS'
      : r.status === 'partial'
        ? '⚠️ PARTIAL'
        : r.status === 'fail'
          ? '❌ FAIL'
          : `⏳ ${r.status.toUpperCase()}`

  lines.push(`# Self-Healing Eval — ${verdictBadge}`)
  lines.push('')
  lines.push(`- **Run ID:** \`${r.run_id}\``)
  lines.push(`- **Mode:** ${r.mode} (max level ${r.max_level})`)
  lines.push(`- **Started:** ${r.started_at}`)
  lines.push(`- **Finished:** ${r.finished_at ?? '(in progress)'}`)
  lines.push(`- **Overall score:** ${fmtScore(r.summary.overall_score)} (${fmtPct(r.summary.overall_score)})`)
  lines.push(
    `- **Turns:** ${r.summary.turns_total} (${r.summary.passes} pass · ${r.summary.partials} partial · ${r.summary.fails} fail)`,
  )
  lines.push('')

  lines.push('## Configuration')
  lines.push(`- LLM judge: \`${r.config.llm_provider}\` / \`${r.config.llm_model}\``)
  lines.push(`- Statewave API: \`${r.config.statewave_api_url}\``)
  lines.push(`- Demo agent configured: ${r.config.demo_agent_configured ? 'yes' : 'no'}`)
  lines.push(`- Webhook configured: ${r.config.webhook_configured ? 'yes' : 'no'}`)
  lines.push('')

  // Eval-only override block. Shown whether or not it was used so the
  // operator can audit "was this run vanilla or candidate?".
  const ov = r.config.agent_prompt_override
  lines.push('## Agent Prompt Override')
  if (!ov.used) {
    lines.push('- Used: no (vanilla run, production agent prompt)')
  } else {
    lines.push('- Used: yes _(eval-only — does not change production agent behavior)_')
    lines.push(`- Delivery: \`${ov.delivery}\``)
    lines.push(`- Length: ${ov.length} chars`)
    lines.push(`- Hash: \`${ov.hash.slice(0, 16)}…\``)
    if (ov.preview) {
      lines.push('- Preview (redacted):')
      lines.push('  ```')
      // Quote lines so multi-line previews stay inside the fenced block.
      for (const previewLine of ov.preview.split('\n')) {
        lines.push(`  ${previewLine}`)
      }
      lines.push('  ```')
    }
  }
  lines.push('')

  // Side-by-side comparison vs an earlier baseline run, when one was
  // requested. Renders BEFORE the per-level/per-cause tables so the
  // operator sees "did this change move the needle?" at a glance.
  if (r.comparison) {
    const c = r.comparison
    const sign = (n: number) => (n > 0 ? `+${fmtScore(n)}` : fmtScore(n))
    const signInt = (n: number) => (n > 0 ? `+${n}` : `${n}`)
    lines.push('## Comparison to Baseline')
    lines.push(`- **Baseline run:** \`${c.baseline_run_id}\``)
    lines.push(`- **Candidate run:** \`${c.candidate_run_id}\``)
    lines.push(
      `- **Score:** ${fmtScore(c.candidate_score)} (was ${fmtScore(c.baseline_score)}, **${sign(c.score_delta)}**)`,
    )
    lines.push(
      `- **Pass / Partial / Fail:** ${signInt(c.pass_delta)} / ${signInt(c.partial_delta)} / ${signInt(c.fail_delta)}`,
    )
    if (c.improved_turns.length > 0) {
      lines.push(`- **Improved turns (${c.improved_turns.length}):** ${c.improved_turns.slice(0, 8).join(', ')}`)
    }
    if (c.regressed_turns.length > 0) {
      lines.push(`- **Regressed turns (${c.regressed_turns.length}):** ${c.regressed_turns.slice(0, 8).join(', ')}`)
    }
    if (c.unchanged_failed_turns.length > 0) {
      lines.push(
        `- **Still failing (${c.unchanged_failed_turns.length}):** ${c.unchanged_failed_turns.slice(0, 8).join(', ')}`,
      )
    }
    const causeRows = Object.entries(c.root_cause_delta).filter(
      ([, info]) => info.before > 0 || info.after > 0,
    )
    if (causeRows.length > 0) {
      lines.push('')
      lines.push('| Root cause | Baseline | Candidate | Delta |')
      lines.push('|---|---|---|---|')
      for (const [cause, info] of causeRows.sort(
        (a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta),
      )) {
        lines.push(`| \`${cause}\` | ${info.before} | ${info.after} | ${signInt(info.delta)} |`)
      }
    }
    const levelRows = Object.entries(c.level_delta)
    if (levelRows.length > 0) {
      lines.push('')
      lines.push('| Level | Baseline avg | Candidate avg | Delta |')
      lines.push('|---|---|---|---|')
      for (const [lvl, info] of levelRows.sort((a, b) => Number(a[0]) - Number(b[0]))) {
        lines.push(
          `| L${lvl} | ${fmtScore(info.before_avg)} | ${fmtScore(info.after_avg)} | ${sign(info.delta)} |`,
        )
      }
    }
    lines.push('')
  }

  lines.push('## System probes')
  lines.push(
    `- **Statewave health:** ${r.health.status === 'pass' ? '✅' : '❌'} ${JSON.stringify(r.health.details)}`,
  )
  lines.push(
    `- **Demo job:** ${r.demo_job.status === 'pass' ? '✅' : r.demo_job.status === 'partial' ? '⚠️' : '❌'} ${JSON.stringify(r.demo_job.details)}`,
  )
  lines.push(
    `- **Webhook:** ${r.webhook.status === 'pass' ? '✅' : r.webhook.status === 'not_configured' ? 'ℹ️ not configured' : r.webhook.status === 'partial' ? '⚠️' : '❌'} ${r.webhook.recommended_fix || ''}`,
  )
  lines.push('')

  lines.push('## Score by level')
  lines.push('| Level | Name | Total | Pass | Partial | Fail | Avg |')
  lines.push('|---|---|---|---|---|---|---|')
  const levelKeys = Object.keys(r.summary_by_level).sort((a, b) => Number(a) - Number(b))
  for (const k of levelKeys) {
    const l = r.summary_by_level[k]
    lines.push(
      `| ${k} | ${l.name} | ${l.turns_total} | ${l.passes} | ${l.partials} | ${l.fails} | ${fmtScore(l.average_score)} |`,
    )
  }
  lines.push('')

  if (Object.keys(r.summary_by_category).length > 0) {
    lines.push('## Score by category')
    lines.push('| Category | Total | Pass | Partial | Fail | Avg |')
    lines.push('|---|---|---|---|---|---|')
    for (const [cat, c] of Object.entries(r.summary_by_category).sort()) {
      lines.push(
        `| ${cat} | ${c.turns_total} | ${c.passes} | ${c.partials} | ${c.fails} | ${fmtScore(c.average_score)} |`,
      )
    }
    lines.push('')
  }

  if (Object.keys(r.summary_by_root_cause).length > 0) {
    lines.push('## Score by root cause')
    lines.push('| Root cause | Count | Example turn ids |')
    lines.push('|---|---|---|')
    for (const [cause, info] of Object.entries(r.summary_by_root_cause).sort(
      (a, b) => b[1].count - a[1].count,
    )) {
      lines.push(`| ${cause} | ${info.count} | ${info.example_turn_ids.join(', ')} |`)
    }
    lines.push('')
  }

  // Strongest / weakest levels by avg score.
  const levelEntries = Object.entries(r.summary_by_level)
    .filter(([, l]) => l.turns_total > 0)
    .sort((a, b) => b[1].average_score - a[1].average_score)
  if (levelEntries.length > 0) {
    lines.push('## Strongest / weakest levels')
    const strongest = levelEntries.slice(0, 2)
    const weakest = levelEntries.slice(-2).reverse()
    lines.push('**Strongest:**')
    for (const [k, l] of strongest) lines.push(`- L${k} ${l.name} — ${fmtScore(l.average_score)}`)
    lines.push('')
    lines.push('**Weakest:**')
    for (const [k, l] of weakest) lines.push(`- L${k} ${l.name} — ${fmtScore(l.average_score)}`)
    lines.push('')
  }

  // Retrieval Diagnostics — for failed/partial docs-grounded turns,
  // show whether the probe ran, what it surfaced, and why the judge
  // tagged the cause it did. This lets an operator look at one block
  // and immediately tell apart a docs gap from a retrieval miss from
  // an agent prompt failure.
  const docsTurnsToDiagnose = r.conversation.filter(
    (t) =>
      t.metadata.requires_docs_grounding &&
      t.evaluation.verdict !== 'pass',
  )
  if (docsTurnsToDiagnose.length > 0) {
    lines.push('## Retrieval Diagnostics')
    for (const t of docsTurnsToDiagnose) {
      const probe = t.retrieved_context
      lines.push(`### \`${t.question_id}\` — ${t.evaluation.verdict.toUpperCase()}`)
      lines.push(`- **Question:** ${t.question}`)
      if (!probe) {
        lines.push('- **Probe:** _not run_')
      } else {
        lines.push(`- **Probe status:** ${probe.status}`)
        if (probe.error) lines.push(`- **Probe error:** ${probe.error}`)
        const sources = Array.from(
          new Set(
            probe.results
              .map((rr) => rr.source_path)
              .filter((s): s is string => !!s),
          ),
        )
        if (sources.length > 0) {
          lines.push(`- **Top sources:** ${sources.slice(0, 5).join(', ')}`)
        } else if (probe.results.length > 0) {
          lines.push(`- **Top sources:** _retrieved memories had no source_path metadata_`)
        }
        // Deterministic must_include check — same matcher the runner
        // uses to post-correct the judge. Showing it here lets the
        // operator see WHY a turn flipped (or didn't), and which terms
        // matched by exact substring vs by paraphrase-tolerant token
        // match.
        const mustInclude = t.metadata.must_include ?? []
        if (
          mustInclude.length > 0 &&
          probe.status === 'pass' &&
          probe.results.length > 0
        ) {
          const haystack = probe.results.map((rr) => rr.text ?? '').join(' ')
          const matches = findMustIncludeMatches(mustInclude, haystack)
          const found = matches.filter((m) => m.found)
          lines.push(`- **must_include checked:** ${mustInclude.join(', ')}`)
          if (found.length > 0) {
            const rendered = found.map((m) =>
              m.kind === 'exact' ? m.term : `${m.term} (token match)`,
            )
            lines.push(`- **Found in retrieved text:** ${rendered.join(', ')}`)
            // Distinguish "all terms found" from "some terms found,
            // others missing" — the latter is partial evidence the
            // operator should know about.
            if (found.length === mustInclude.length) {
              lines.push('- **Expected fact present in retrieved context:** yes')
            } else {
              const missing = matches
                .filter((m) => !m.found)
                .map((m) => m.term)
                .join(', ')
              lines.push(
                `- **Expected fact present in retrieved context:** partial (missing: ${missing})`,
              )
            }
            if (t.evaluation.likely_root_cause.includes('retrieved-context-ignored')) {
              lines.push('- **Agent used expected fact:** no')
            }
          } else {
            lines.push('- **Found in retrieved text:** _none_')
            lines.push('- **Expected fact present in retrieved context:** no')
          }
        } else if (probe.no_relevant_results) {
          lines.push('- **Expected fact present in retrieved context:** no (probe returned 0 items)')
        }
      }
      // Surface the deterministic correction marker in the reason so the
      // operator can tell judge-original verdicts from corrected ones.
      const corrected = /^\[deterministic correction:/.test(t.evaluation.reason)
      const causeLine = `- **Likely root cause:** ${t.evaluation.likely_root_cause.join(', ') || 'unknown'}`
      lines.push(corrected ? `${causeLine} _(deterministic correction applied)_` : causeLine)
      lines.push('')
    }
  }

  lines.push('## Failed and partial answers')
  const failed = r.conversation.filter((t) => t.evaluation.verdict !== 'pass')
  if (failed.length === 0) {
    lines.push('_None._')
  } else {
    for (const t of failed) {
      const verdictMark = t.evaluation.verdict === 'fail' ? '❌' : '⚠️'
      lines.push(
        `### ${verdictMark} L${t.level} · ${t.category} · \`${t.question_id}\` (${fmtScore(t.evaluation.overall_score)})`,
      )
      if (t.follow_up_of) lines.push(`*Follow-up of \`${t.follow_up_of}\`*`)
      lines.push('')
      lines.push(`**Q:** ${t.question}`)
      lines.push('')
      lines.push(`**A:**`)
      lines.push('```')
      lines.push(t.answer || '(no answer)')
      lines.push('```')
      lines.push(`**Reason:** ${t.evaluation.reason}`)
      if (t.evaluation.missing_points.length > 0) {
        lines.push(`**Missing points:** ${t.evaluation.missing_points.join('; ')}`)
      }
      if (t.evaluation.hallucination_risks.length > 0) {
        lines.push(`**Hallucination risks:** ${t.evaluation.hallucination_risks.join('; ')}`)
      }
      lines.push(`**Recommended fix:** ${t.evaluation.recommended_fix}`)
      lines.push(`**Likely root cause:** ${t.evaluation.likely_root_cause.join(', ') || 'unknown'}`)
      lines.push('')
    }
  }

  if (r.recommendations.length > 0) {
    lines.push('## Recommendations')
    for (const rec of r.recommendations) {
      lines.push(`### [${rec.priority.toUpperCase()}] ${rec.area} — ${rec.problem}`)
      lines.push(`- **Change:** ${rec.recommended_change}`)
      if (rec.acceptance_criteria.length > 0) {
        lines.push(`- **Acceptance criteria:**`)
        for (const ac of rec.acceptance_criteria) lines.push(`  - ${ac}`)
      }
      lines.push('')
    }
  }

  lines.push('## Copilot improvement prompt')
  lines.push('```')
  lines.push(r.copilot_prompt)
  lines.push('```')

  return lines.join('\n')
}

// ─── Copilot prompt (deterministic) ───────────────────────────────────

const AREA_TO_FILES: Record<ReportRecommendation['area'], string[]> = {
  'docs-memory-pack': [
    'statewave-docs/**/*.md',
    'statewave/server/services/starter_packs.py',
    'statewave/server/starter_packs/',
  ],
  'demo-agent-prompt': [
    'statewave-web/api/widget-chat.ts',
    'statewave-web/src/lib/personas/*',
    'statewave-web/server/agent/*',
  ],
  retrieval: [
    'statewave/server/api/context.py',
    'statewave/server/services/context.py',
    'statewave-web/api/widget-chat.ts',
  ],
  webhook: ['statewave/server/services/webhooks.py', 'statewave/.env'],
  admin: [
    'statewave-admin/server/self-healing-eval/*',
    'statewave-admin/server/smoke.ts',
  ],
  'core-api': ['statewave/server/api/*', 'statewave/server/main.py'],
  tests: ['statewave-admin/tests/self-healing-eval-*.test.ts*', 'statewave/tests/'],
}

/**
 * One-line headline-framing for the Copilot prompt, dispatched on the
 * dominant root cause. Stops the prompt from blindly saying "add docs"
 * when retrieval shows the docs are present.
 */
function dominantRootCause(report: EvalReport): string | null {
  const ranked = Object.entries(report.summary_by_root_cause)
    .filter(([, info]) => info.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
  return ranked[0]?.[0] ?? null
}

function copilotHeadlineFor(cause: string | null, score: number): string {
  const pct = `${(score * 100).toFixed(0)}%`
  switch (cause) {
    case 'retrieved-context-ignored':
      return `The docs appear to contain the expected facts (the retrieval probe surfaced them) but the demo agent did not use the retrieved context. Inspect statewave-web/api/widget-chat.ts: the prompt template, fetchContext call, and answer instruction priority. Tighten the system prompt to lead with retrieved facts and require citation.`
    case 'retrieval-miss':
      return `The retrieval probe did not surface the expected facts for these broad questions, even though similar content likely exists in the docs corpus. Inspect retrieval query formulation, memory titles, chunk metadata, and consider adding alias/synonym memories or query expansion. Goal: lift score from ${pct} by tuning retrieval, not by adding new docs.`
    case 'missing-docs':
      return `Retrieval probe confirms the docs corpus genuinely lacks the topic for these questions. Add a canonical section to statewave-docs and re-seed the memory pack. Goal: lift score from ${pct} by closing concrete docs gaps.`
    case 'eval-judge-context-blindness':
      return `The retrieval probe failed for one or more turns so the judge couldn't ground its classifications. Verify STATEWAVE_API_URL is reachable from admin and ADMIN_EVAL_DOCS_SUBJECT_ID points at a populated subject. Re-run after fixing.`
    case 'demo-agent-prompt':
      return `The demo agent is producing ungrounded or off-scope answers despite available context. Tighten the agent system prompt — require explicit citation of retrieved facts, refuse to answer L0 questions without a retrieved fact, and challenge incorrect assumptions on L8 turns.`
    case 'unsupported-npm-sdk-claim':
    case 'hallucinated-code-or-api':
      return `The agent invented npm packages, SDKs, or endpoints not in the docs. Update the agent prompt to admit honest uncertainty when the docs don't confirm a package, and verify what's actually documented.`
    default:
      return `Goal: improve overall eval score from its current ${pct}.`
  }
}

export function buildCopilotPrompt(report: EvalReport): string {
  const r = redactValue(report)
  const failed = r.conversation.filter((t) => t.evaluation.verdict !== 'pass')
  const sortedRootCauses = Object.entries(r.summary_by_root_cause).sort(
    (a, b) => b[1].count - a[1].count,
  )
  const filesToInspect = new Set<string>()
  for (const rec of r.recommendations) {
    for (const f of AREA_TO_FILES[rec.area] ?? []) filesToInspect.add(f)
  }

  const lines: string[] = []
  lines.push(
    `# Self-Healing Eval — improvement prompt (run ${r.run_id})`,
  )
  lines.push('')
  // Headline framing dispatched on the dominant root cause — stops the
  // prompt from defaulting to "add docs" when retrieval evidence shows
  // the docs are present.
  lines.push(copilotHeadlineFor(dominantRootCause(r), r.summary.overall_score))
  lines.push('')
  lines.push(
    `Eval mode: ${r.mode} (max level ${r.max_level}). Current score: ${fmtScore(r.summary.overall_score)} (${fmtPct(r.summary.overall_score)}). Re-running the same mode after the changes should raise it.`,
  )
  lines.push('')

  // Comparison narrative — when a baseline run was supplied, frame the
  // Copilot prompt around whether the operator's change moved the
  // needle. This turns the eval into a closed loop: "the candidate
  // prompt improved score by +X — promote it" vs "regressed — keep
  // iterating".
  if (r.comparison) {
    const c = r.comparison
    const sign = (n: number) => (n > 0 ? `+${fmtScore(n)}` : fmtScore(n))
    lines.push('## Comparison to baseline')
    lines.push(
      `- Score: ${fmtScore(c.candidate_score)} (was ${fmtScore(c.baseline_score)}, **${sign(c.score_delta)}**)`,
    )
    const movedCauses = Object.entries(c.root_cause_delta)
      .filter(([, info]) => info.delta !== 0)
      .sort((a, b) => Math.abs(b[1].delta) - Math.abs(a[1].delta))
      .slice(0, 4)
    if (movedCauses.length > 0) {
      lines.push(
        `- Root causes that moved: ${movedCauses
          .map(([cause, info]) => `\`${cause}\` ${info.before}→${info.after}`)
          .join(', ')}`,
      )
    }
    if (r.config.agent_prompt_override.used) {
      const promote = c.score_delta > 0.05 && c.regressed_turns.length === 0
      const regressed = c.score_delta < -0.05 || c.regressed_turns.length > 0
      if (promote) {
        lines.push(
          `- Verdict: **promote the candidate agent prompt** to statewave-web/api/widget-chat.ts. The override improved score by ${sign(c.score_delta)} with no regressions.`,
        )
      } else if (regressed) {
        lines.push(
          `- Verdict: **keep iterating**. The override regressed (${sign(c.score_delta)} score, ${c.regressed_turns.length} regressed turn(s)). Refine the prompt before promoting.`,
        )
      } else {
        lines.push(
          `- Verdict: candidate is roughly neutral (${sign(c.score_delta)} score). Try a stricter formulation before promoting.`,
        )
      }
    }
    lines.push('')
  }

  lines.push('## Failures by level')
  const lvlKeys = Object.keys(r.summary_by_level).sort((a, b) => Number(a) - Number(b))
  for (const k of lvlKeys) {
    const l = r.summary_by_level[k]
    if (l.fails === 0 && l.partials === 0) continue
    lines.push(
      `- L${k} (${l.name}): ${l.passes}/${l.turns_total} pass · avg ${fmtScore(l.average_score)} — ${l.fails} fail, ${l.partials} partial.`,
    )
  }
  lines.push('')

  if (sortedRootCauses.length > 0) {
    lines.push('## Failures by root cause')
    for (const [cause, info] of sortedRootCauses) {
      lines.push(`- \`${cause}\` × ${info.count} (${info.example_turn_ids.join(', ')})`)
    }
    lines.push('')
  }

  if (failed.length > 0) {
    lines.push('## Concrete failing questions')
    for (const t of failed.slice(0, 12)) {
      lines.push(`- **L${t.level}** \`${t.question_id}\`: ${t.question}`)
      lines.push(`  - Recommended: ${t.evaluation.recommended_fix}`)
      lines.push(`  - Root cause: ${t.evaluation.likely_root_cause.join(', ') || 'unknown'}`)
      const probe = t.retrieved_context
      if (probe && probe.status === 'pass' && probe.results.length > 0) {
        const sources = Array.from(
          new Set(
            probe.results
              .map((rr) => rr.source_path)
              .filter((s): s is string => !!s),
          ),
        ).slice(0, 3)
        if (sources.length > 0) {
          lines.push(`  - Retrieval probe surfaced: ${sources.join(', ')}`)
        } else {
          lines.push(
            `  - Retrieval probe surfaced ${probe.results.length} memories (no source_path metadata)`,
          )
        }
      } else if (probe && probe.status === 'pass' && probe.results.length === 0) {
        lines.push(`  - Retrieval probe: 0 relevant memories returned (likely retrieval-miss or missing-docs)`)
      } else if (probe && probe.status === 'fail') {
        lines.push(`  - Retrieval probe FAILED — judge classification not trustworthy`)
      }
    }
    lines.push('')
  }

  if (filesToInspect.size > 0) {
    lines.push('## Likely files to inspect / edit')
    for (const f of Array.from(filesToInspect).sort()) {
      lines.push(`- \`${f}\``)
    }
    lines.push('')
  }

  lines.push('## Acceptance criteria')
  lines.push('- Re-running the Self-Healing Eval on the same mode raises the overall score by at least 10 points.')
  lines.push('- No `unsupported-npm-sdk-claim` or `hallucinated-code-or-api` root causes in the next report.')
  lines.push('- Level 8 false-premise average ≥ 0.7; Level 9 topic-drift average ≥ 0.6.')
  lines.push('- Add regression test cases for any newly-fixed failures so they re-appear if regressed.')
  lines.push('')

  lines.push('## Constraints')
  lines.push('- Do not invent npm packages, SDK names, install commands, or endpoints.')
  lines.push('- Do not silently modify production data, customer subjects, or memory packs.')
  lines.push('- Keep changes scoped to the docs memory pack, the demo agent prompt, the admin diagnostics, or this question bank.')
  lines.push('- Do not commit secrets — every `[REDACTED]` placeholder in this prompt was an API key in the original run.')

  return redactString(lines.join('\n'))
}
