/**
 * Side-by-side comparison of two eval reports.
 *
 * Powers the v1 admin loop: operator runs once, applies a candidate
 * agent prompt override (or any other change), runs again with
 * baseline_run_id pointing at the previous run. The result block tells
 * them whether the change actually moved the needle — score delta,
 * pass/fail delta, root-cause delta, level delta, and which specific
 * turns improved or regressed.
 *
 * Turn matching: by question_id. Baseline turns whose question_id is
 * absent in the candidate are dropped from improved/regressed lists
 * (we can't compare a turn that wasn't asked). Same the other way
 * around: candidate-only turns are surfaced as "new turns" in the
 * unchanged_failed_turns slot only if they're failing — otherwise they
 * just contribute to the candidate's headline numbers.
 */
import type {
  ComparisonResult,
  ConversationTurn,
  EvalReport,
  LevelDelta,
  RootCauseDelta,
} from './types.js'

/**
 * Score change threshold for "meaningful" improvement/regression.
 * Anything within ±0.05 counts as unchanged so we don't celebrate
 * floating-point jitter from non-deterministic LLM judges.
 */
const SCORE_DRIFT_THRESHOLD = 0.05

function turnVerdictRank(t: ConversationTurn): number {
  // pass = 2, partial = 1, fail = 0. Lets us detect verdict
  // direction without depending on string compare.
  switch (t.evaluation.verdict) {
    case 'pass':
      return 2
    case 'partial':
      return 1
    default:
      return 0
  }
}

/**
 * Decide direction for a single turn that exists in both runs.
 *   "improved"   — verdict moved up OR overall_score rose by > threshold
 *   "regressed"  — verdict moved down OR overall_score fell by > threshold
 *   "unchanged"  — within threshold and same verdict
 */
export function classifyTurnChange(
  baseline: ConversationTurn,
  candidate: ConversationTurn,
): 'improved' | 'regressed' | 'unchanged' {
  const deltaScore =
    candidate.evaluation.overall_score - baseline.evaluation.overall_score
  const deltaVerdict = turnVerdictRank(candidate) - turnVerdictRank(baseline)
  if (deltaVerdict > 0) return 'improved'
  if (deltaVerdict < 0) return 'regressed'
  // Same verdict bucket: defer to score drift.
  if (deltaScore > SCORE_DRIFT_THRESHOLD) return 'improved'
  if (deltaScore < -SCORE_DRIFT_THRESHOLD) return 'regressed'
  return 'unchanged'
}

/**
 * Build per-root-cause counts for a single report, summed over
 * `summary_by_root_cause`. Used to compute deltas.
 */
function rootCauseCounts(report: EvalReport): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [cause, info] of Object.entries(report.summary_by_root_cause)) {
    out[cause] = info.count
  }
  return out
}

function levelAvgs(report: EvalReport): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [lvl, info] of Object.entries(report.summary_by_level)) {
    out[lvl] = info.average_score
  }
  return out
}

/**
 * Compute the comparison block. Pure — takes two finalized reports and
 * returns the structured delta. The runner attaches the result to the
 * candidate report's `comparison` field.
 */
export function compareReports(
  baseline: EvalReport,
  candidate: EvalReport,
): ComparisonResult {
  const baselineCounts = rootCauseCounts(baseline)
  const candidateCounts = rootCauseCounts(candidate)
  const allCauses = new Set([
    ...Object.keys(baselineCounts),
    ...Object.keys(candidateCounts),
  ])
  const root_cause_delta: Record<string, RootCauseDelta> = {}
  for (const c of allCauses) {
    const before = baselineCounts[c] ?? 0
    const after = candidateCounts[c] ?? 0
    root_cause_delta[c] = { before, after, delta: after - before }
  }

  const baselineLevels = levelAvgs(baseline)
  const candidateLevels = levelAvgs(candidate)
  const allLevels = new Set([
    ...Object.keys(baselineLevels),
    ...Object.keys(candidateLevels),
  ])
  const level_delta: Record<string, LevelDelta> = {}
  for (const lvl of allLevels) {
    const before_avg = baselineLevels[lvl] ?? 0
    const after_avg = candidateLevels[lvl] ?? 0
    level_delta[lvl] = { before_avg, after_avg, delta: after_avg - before_avg }
  }

  // Match turns by question_id so reordered question banks still
  // compare correctly. A turn that exists only in one side is
  // ignored from the improved/regressed lists.
  const baselineByQ = new Map<string, ConversationTurn>()
  for (const t of baseline.conversation) baselineByQ.set(t.question_id, t)
  const improved_turns: string[] = []
  const regressed_turns: string[] = []
  const unchanged_failed_turns: string[] = []
  for (const cand of candidate.conversation) {
    const base = baselineByQ.get(cand.question_id)
    if (!base) continue // candidate-only turn (e.g. new generated bank)
    const direction = classifyTurnChange(base, cand)
    if (direction === 'improved') improved_turns.push(cand.turn_id)
    else if (direction === 'regressed') regressed_turns.push(cand.turn_id)
    else if (
      cand.evaluation.verdict !== 'pass' &&
      base.evaluation.verdict !== 'pass'
    ) {
      // "still broken" — useful to surface so the operator knows
      // the change didn't help these turns either way.
      unchanged_failed_turns.push(cand.turn_id)
    }
  }

  return {
    baseline_run_id: baseline.run_id,
    candidate_run_id: candidate.run_id,
    baseline_score: baseline.summary.overall_score,
    candidate_score: candidate.summary.overall_score,
    score_delta:
      candidate.summary.overall_score - baseline.summary.overall_score,
    pass_delta: candidate.summary.passes - baseline.summary.passes,
    partial_delta: candidate.summary.partials - baseline.summary.partials,
    fail_delta: candidate.summary.fails - baseline.summary.fails,
    root_cause_delta,
    level_delta,
    improved_turns,
    regressed_turns,
    unchanged_failed_turns,
  }
}
