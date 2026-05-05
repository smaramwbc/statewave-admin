/**
 * Comparison module tests.
 *
 * Pins the v1 fix-test loop math: given two finalized reports, produce
 * a delta block that surfaces score / pass / per-root-cause / per-level
 * deltas plus turn-level improvement / regression buckets.
 */
import { describe, expect, it } from 'vitest'
import { classifyTurnChange, compareReports } from '../server/self-healing-eval/comparison'
import type {
  ConversationTurn,
  EvalReport,
  JudgeEvaluation,
} from '../server/self-healing-eval/types'

function evaluation(over: Partial<JudgeEvaluation> = {}): JudgeEvaluation {
  return {
    correctness_score: 1,
    grounding_score: 1,
    completeness_score: 1,
    clarity_score: 1,
    safety_score: 1,
    overall_score: 1,
    verdict: 'pass',
    reason: 'ok',
    missing_points: [],
    hallucination_risks: [],
    recommended_fix: '',
    likely_root_cause: [],
    ...over,
  }
}

function turn(over: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turn_id: 't',
    question_id: 'q',
    level: 0,
    category: 'identity',
    question: 'q',
    answer: 'a',
    metadata: {
      requires_code: false,
      requires_docs_grounding: true,
      topic_drift: false,
      false_premise: false,
    },
    evaluation: evaluation(),
    ...over,
  }
}

function buildReport(
  over: Partial<EvalReport> & { turns: ConversationTurn[] },
): EvalReport {
  const passes = over.turns.filter((t) => t.evaluation.verdict === 'pass').length
  const partials = over.turns.filter((t) => t.evaluation.verdict === 'partial').length
  const fails = over.turns.filter((t) => t.evaluation.verdict === 'fail').length
  const overall =
    over.turns.reduce((acc, t) => acc + t.evaluation.overall_score, 0) /
    Math.max(1, over.turns.length)
  const byCause: Record<string, { count: number; example_turn_ids: string[] }> = {}
  for (const t of over.turns) {
    for (const c of t.evaluation.likely_root_cause) {
      byCause[c] = byCause[c] ?? { count: 0, example_turn_ids: [] }
      byCause[c].count += 1
      if (byCause[c].example_turn_ids.length < 3) {
        byCause[c].example_turn_ids.push(t.turn_id)
      }
    }
  }
  // Trivial level summary: bucket each turn under its level number.
  const byLevel: Record<
    string,
    {
      name: string
      turns_total: number
      passes: number
      partials: number
      fails: number
      average_score: number
    }
  > = {}
  for (const t of over.turns) {
    const k = String(t.level)
    if (!byLevel[k]) {
      byLevel[k] = { name: 'level ' + k, turns_total: 0, passes: 0, partials: 0, fails: 0, average_score: 0 }
    }
    const l = byLevel[k]
    l.turns_total += 1
    if (t.evaluation.verdict === 'pass') l.passes += 1
    else if (t.evaluation.verdict === 'partial') l.partials += 1
    else l.fails += 1
    l.average_score =
      (l.average_score * (l.turns_total - 1) + t.evaluation.overall_score) /
      l.turns_total
  }
  return {
    run_id: 'r',
    started_at: '2026-04-01T00:00:00Z',
    finished_at: '2026-04-01T00:00:30Z',
    status: 'partial',
    mode: 'smoke',
    max_level: 1,
    config: {
      statewave_api_url: 'x',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_configured: true,
      webhook_configured: false,
      agent_prompt_override: { used: false, delivery: 'not_used', length: 0, hash: '', preview: '' },
    },
    health: { status: 'pass', details: {} },
    webhook: { status: 'not_configured', trigger_attempted: false, delivery_observed: false, details: {}, recommended_fix: '' },
    demo_job: { status: 'pass', details: {} },
    conversation: over.turns,
    summary: { turns_total: over.turns.length, passes, partials, fails, overall_score: overall },
    summary_by_level: byLevel,
    summary_by_category: {},
    summary_by_root_cause: byCause,
    recommendations: [],
    copilot_prompt: '',
    progress: { completed: over.turns.length, total: over.turns.length, current_question_id: null },
    error: null,
    ...over,
  }
}

describe('classifyTurnChange', () => {
  it('improved: verdict moves up', () => {
    const a = turn({ evaluation: evaluation({ verdict: 'fail', overall_score: 0.2 }) })
    const b = turn({ evaluation: evaluation({ verdict: 'pass', overall_score: 0.9 }) })
    expect(classifyTurnChange(a, b)).toBe('improved')
  })
  it('regressed: verdict moves down', () => {
    const a = turn({ evaluation: evaluation({ verdict: 'pass', overall_score: 0.95 }) })
    const b = turn({ evaluation: evaluation({ verdict: 'fail', overall_score: 0.1 }) })
    expect(classifyTurnChange(a, b)).toBe('regressed')
  })
  it('unchanged within drift threshold (±0.05)', () => {
    const a = turn({ evaluation: evaluation({ verdict: 'partial', overall_score: 0.5 }) })
    const b = turn({ evaluation: evaluation({ verdict: 'partial', overall_score: 0.52 }) })
    expect(classifyTurnChange(a, b)).toBe('unchanged')
  })
  it('improved: same verdict but score rose past threshold', () => {
    const a = turn({ evaluation: evaluation({ verdict: 'partial', overall_score: 0.5 }) })
    const b = turn({ evaluation: evaluation({ verdict: 'partial', overall_score: 0.7 }) })
    expect(classifyTurnChange(a, b)).toBe('improved')
  })
})

describe('compareReports', () => {
  const baseline = buildReport({
    run_id: 'base-1',
    turns: [
      turn({
        turn_id: 'base:q1',
        question_id: 'q1',
        evaluation: evaluation({ verdict: 'fail', overall_score: 0.0, likely_root_cause: ['retrieved-context-ignored'] }),
      }),
      turn({
        turn_id: 'base:q2',
        question_id: 'q2',
        level: 1,
        evaluation: evaluation({ verdict: 'fail', overall_score: 0.2, likely_root_cause: ['retrieval-miss'] }),
      }),
      turn({
        turn_id: 'base:q3',
        question_id: 'q3',
        level: 1,
        evaluation: evaluation({ verdict: 'pass', overall_score: 0.95 }),
      }),
    ],
  })
  const candidate = buildReport({
    run_id: 'cand-1',
    turns: [
      // q1 went from fail → pass (improved)
      turn({
        turn_id: 'cand:q1',
        question_id: 'q1',
        evaluation: evaluation({ verdict: 'pass', overall_score: 0.9 }),
      }),
      // q2 stayed broken (still failing)
      turn({
        turn_id: 'cand:q2',
        question_id: 'q2',
        level: 1,
        evaluation: evaluation({ verdict: 'fail', overall_score: 0.2, likely_root_cause: ['retrieval-miss'] }),
      }),
      // q3 went from pass → fail (regressed)
      turn({
        turn_id: 'cand:q3',
        question_id: 'q3',
        level: 1,
        evaluation: evaluation({ verdict: 'fail', overall_score: 0.1, likely_root_cause: ['demo-agent-prompt'] }),
      }),
    ],
  })

  const cmp = compareReports(baseline, candidate)

  it('computes score_delta as candidate − baseline', () => {
    expect(cmp.score_delta).toBeCloseTo(
      candidate.summary.overall_score - baseline.summary.overall_score,
    )
  })

  it('computes pass / partial / fail deltas', () => {
    expect(cmp.pass_delta).toBe(0) // 1 was pass, now 1 is pass
    expect(cmp.fail_delta).toBe(0) // 2 fails, then 2 fails
  })

  it('produces per-root-cause deltas including newly-introduced causes', () => {
    expect(cmp.root_cause_delta['retrieved-context-ignored'].before).toBe(1)
    expect(cmp.root_cause_delta['retrieved-context-ignored'].after).toBe(0)
    expect(cmp.root_cause_delta['retrieved-context-ignored'].delta).toBe(-1)
    expect(cmp.root_cause_delta['demo-agent-prompt'].before).toBe(0)
    expect(cmp.root_cause_delta['demo-agent-prompt'].after).toBe(1)
  })

  it('produces per-level deltas', () => {
    expect(cmp.level_delta['0']).toBeDefined()
    expect(cmp.level_delta['1']).toBeDefined()
    // L1 baseline avg = (0.2 + 0.95)/2; candidate avg = (0.2 + 0.1)/2 → regress
    expect(cmp.level_delta['1'].delta).toBeLessThan(0)
  })

  it('classifies turns correctly: improved / regressed / unchanged_failed', () => {
    expect(cmp.improved_turns).toEqual(['cand:q1'])
    expect(cmp.regressed_turns).toEqual(['cand:q3'])
    expect(cmp.unchanged_failed_turns).toEqual(['cand:q2'])
  })

  it('matches turns by question_id, not turn_id, so candidate-only turns are skipped', () => {
    const cand2 = buildReport({
      run_id: 'cand-2',
      turns: [
        ...candidate.conversation,
        turn({
          turn_id: 'cand:q4-new',
          question_id: 'q4-new',
          evaluation: evaluation({ verdict: 'fail', overall_score: 0.0 }),
        }),
      ],
    })
    const cmp2 = compareReports(baseline, cand2)
    // q4-new has no baseline counterpart and shouldn't appear in any
    // of the per-turn buckets.
    const allBuckets = [
      ...cmp2.improved_turns,
      ...cmp2.regressed_turns,
      ...cmp2.unchanged_failed_turns,
    ]
    expect(allBuckets).not.toContain('cand:q4-new')
  })
})
