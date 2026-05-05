/**
 * Report assembly tests.
 *
 * Pins:
 *   - summarize() yields per-level, per-category, per-root-cause counts
 *   - markdown report renders the verdict + level breakdown
 *   - Copilot prompt is deterministic (same report → same prompt) and
 *     includes failure-derived hints + redacted secrets
 */
import { describe, it, expect } from 'vitest'
import {
  buildCopilotPrompt,
  buildRecommendations,
  renderMarkdownReport,
  summarize,
} from '../server/self-healing-eval/reportFormat'
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
    recommended_fix: 'none',
    likely_root_cause: [],
    ...over,
  }
}

function turn(over: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turn_id: 't1',
    question_id: 'l0-what-is-statewave',
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

describe('summarize', () => {
  it('aggregates pass/partial/fail counts by level, category, root cause', () => {
    const turns: ConversationTurn[] = [
      turn(),
      turn({ turn_id: 't2', level: 5, category: 'developer-usage' }),
      turn({
        turn_id: 't3',
        level: 5,
        category: 'developer-usage',
        evaluation: evaluation({
          verdict: 'fail',
          overall_score: 0.2,
          likely_root_cause: ['unsupported-npm-sdk-claim'],
        }),
      }),
      turn({
        turn_id: 't4',
        level: 9,
        category: 'topic-drift',
        evaluation: evaluation({
          verdict: 'partial',
          overall_score: 0.5,
          likely_root_cause: ['weak-topic-drift-handling'],
        }),
      }),
    ]
    const out = summarize(turns)
    expect(out.summary.turns_total).toBe(4)
    expect(out.summary.passes).toBe(2)
    expect(out.summary.partials).toBe(1)
    expect(out.summary.fails).toBe(1)
    expect(out.byLevel['5'].turns_total).toBe(2)
    expect(out.byLevel['5'].fails).toBe(1)
    expect(out.byLevel['9'].partials).toBe(1)
    expect(out.byCategory['developer-usage'].fails).toBe(1)
    expect(out.byRootCause['unsupported-npm-sdk-claim'].count).toBe(1)
    expect(out.byRootCause['weak-topic-drift-handling'].count).toBe(1)
  })
})

describe('buildRecommendations', () => {
  it('emits a recommendation per observed root cause, sorted by priority', () => {
    const recs = buildRecommendations(
      {
        'unsupported-npm-sdk-claim': { count: 3, example_turn_ids: ['t3', 't4', 't5'] },
        'weak-topic-drift-handling': { count: 1, example_turn_ids: ['t9'] },
      },
      {
        '5': { name: 'developer usage', turns_total: 5, passes: 1, partials: 1, fails: 3, average_score: 0.3 },
      },
    )
    expect(recs.length).toBe(2)
    expect(recs[0].priority).toBe('high')
    expect(recs[0].area).toBeDefined()
  })
})

function fullReport(): EvalReport {
  const turns: ConversationTurn[] = [
    turn({ turn_id: 't1', level: 0, category: 'identity' }),
    turn({
      turn_id: 't2',
      level: 5,
      category: 'developer-usage',
      question: 'How do I install statewave npm package?',
      answer: 'npm install statewave-sdk',
      evaluation: evaluation({
        verdict: 'fail',
        overall_score: 0.1,
        reason: 'invented sdk name',
        recommended_fix: 'admit uncertainty when not in docs',
        likely_root_cause: ['unsupported-npm-sdk-claim'],
      }),
    }),
  ]
  const sums = summarize(turns)
  return {
    run_id: 'run-test',
    started_at: '2026-04-01T00:00:00Z',
    finished_at: '2026-04-01T00:00:30Z',
    status: 'partial',
    mode: 'developer',
    max_level: 5,
    config: {
      statewave_api_url: 'https://upstream.example',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_configured: true,
      webhook_configured: false,
      agent_prompt_override: { used: false, delivery: 'not_used', length: 0, hash: '', preview: '' },
    },
    health: { status: 'pass', details: { detail: 'ok', readiness: 'ready' } },
    webhook: {
      status: 'not_configured',
      trigger_attempted: true,
      delivery_observed: false,
      details: {},
      recommended_fix: 'set STATEWAVE_WEBHOOK_URL',
    },
    demo_job: { status: 'pass', details: {} },
    conversation: turns,
    summary: sums.summary,
    summary_by_level: sums.byLevel,
    summary_by_category: sums.byCategory,
    summary_by_root_cause: sums.byRootCause,
    recommendations: buildRecommendations(sums.byRootCause, sums.byLevel),
    copilot_prompt: '',
    progress: { completed: 2, total: 2, current_question_id: null },
    error: null,
  }
}

describe('renderMarkdownReport', () => {
  it('produces a markdown document with the verdict header, level table, and failures section', () => {
    const md = renderMarkdownReport(fullReport())
    expect(md).toContain('# Self-Healing Eval')
    expect(md).toContain('## Score by level')
    expect(md).toContain('## Failed and partial answers')
    expect(md).toContain('developer usage')
  })
})

describe('buildCopilotPrompt', () => {
  it('is deterministic and includes failure root causes + acceptance criteria', () => {
    const r = fullReport()
    const a = buildCopilotPrompt(r)
    const b = buildCopilotPrompt(r)
    expect(a).toBe(b)
    expect(a).toContain('unsupported-npm-sdk-claim')
    expect(a).toContain('Acceptance criteria')
  })

  it('redacts API keys leaked into the answer text', () => {
    const r = fullReport()
    r.conversation[1].answer = 'use sk-1234567890abcdef1234 in your call'
    const prompt = buildCopilotPrompt(r)
    expect(prompt).not.toContain('sk-1234567890abcdef1234')
  })
})

// ─── Retrieval-aware dispatch ────────────────────────────────────────────

function reportWithRootCause(
  cause: import('../server/self-healing-eval/types').RootCause,
  probeStatus: 'pass' | 'fail' | 'not_configured' | 'skipped' = 'pass',
  probeResults: Array<{ source_path?: string; text: string }> = [],
): import('../server/self-healing-eval/types').EvalReport {
  const t = turn({
    turn_id: 'rt1',
    level: 0,
    category: 'identity',
    question: 'What are episodes in Statewave?',
    answer: 'generic filler.',
    metadata: {
      requires_code: false,
      requires_docs_grounding: true,
      topic_drift: false,
      false_premise: false,
      // The deterministic must_include check needs terms to scan for;
      // pin "Episodes" so probeResults like "Episodes are immutable."
      // produce a positive substring match in the report.
      must_include: ['Episodes'],
    },
    retrieved_context: {
      status: probeStatus,
      subject_id: 'statewave-support-docs',
      query: 'What are episodes in Statewave?',
      results: probeResults.map((r) => ({ kind: 'fact', ...r })),
    },
    evaluation: evaluation({
      verdict: 'fail',
      overall_score: 0.3,
      likely_root_cause: [cause],
    }),
  })
  const sums = summarize([t])
  return {
    run_id: 'run-rt',
    started_at: '2026-04-01T00:00:00Z',
    finished_at: '2026-04-01T00:00:30Z',
    status: 'fail',
    mode: 'smoke',
    max_level: 1,
    config: {
      statewave_api_url: 'https://x',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_configured: true,
      webhook_configured: false,
      agent_prompt_override: { used: false, delivery: 'not_used', length: 0, hash: '', preview: '' },
    },
    health: { status: 'pass', details: {} },
    webhook: { status: 'not_configured', trigger_attempted: false, delivery_observed: false, details: {}, recommended_fix: '' },
    demo_job: { status: 'pass', details: {} },
    conversation: [t],
    summary: sums.summary,
    summary_by_level: sums.byLevel,
    summary_by_category: sums.byCategory,
    summary_by_root_cause: sums.byRootCause,
    recommendations: buildRecommendations(sums.byRootCause, sums.byLevel),
    copilot_prompt: '',
    progress: { completed: 1, total: 1, current_question_id: null },
    error: null,
  }
}

describe('Retrieval-aware recommendations + Copilot framing', () => {
  it('retrieved-context-ignored → recommendation targets demo-agent-prompt, not docs', () => {
    const r = reportWithRootCause('retrieved-context-ignored', 'pass', [
      { source_path: 'concepts/episodes.md', text: 'Episodes are immutable.' },
    ])
    expect(r.recommendations[0].area).toBe('demo-agent-prompt')
    const prompt = buildCopilotPrompt(r)
    expect(prompt).toMatch(/did not use the retrieved context/i)
    expect(prompt).not.toMatch(/Add a canonical section.*statewave-docs/)
  })

  it('retrieval-miss → recommendation targets retrieval, not docs', () => {
    const r = reportWithRootCause('retrieval-miss', 'pass', [])
    expect(r.recommendations[0].area).toBe('retrieval')
    const prompt = buildCopilotPrompt(r)
    expect(prompt).toMatch(/retrieval probe did not surface/i)
    expect(prompt).not.toMatch(/Add a canonical section.*statewave-docs/)
  })

  it('missing-docs only fires when retrieval evidence supports it', () => {
    const r = reportWithRootCause('missing-docs', 'pass', [])
    const prompt = buildCopilotPrompt(r)
    expect(prompt).toMatch(/genuinely lacks the topic/i)
  })

  it('eval-judge-context-blindness → recommendation targets admin', () => {
    const r = reportWithRootCause('eval-judge-context-blindness', 'fail')
    expect(r.recommendations[0].area).toBe('admin')
  })
})

describe('Markdown report — Agent Prompt Override section', () => {
  it('renders "Used: no" when no override was supplied', () => {
    const md = renderMarkdownReport(fullReport())
    expect(md).toContain('## Agent Prompt Override')
    expect(md).toContain('Used: no')
  })

  it('renders preview + delivery + hash when an override was used', () => {
    const r = fullReport()
    r.config.agent_prompt_override = {
      used: true,
      delivery: 'sent_unconfirmed',
      length: 42,
      hash: 'a'.repeat(64),
      preview: 'Lead with retrieved facts. Do not invent endpoints.',
    }
    const md = renderMarkdownReport(r)
    expect(md).toContain('## Agent Prompt Override')
    expect(md).toContain('Used: yes')
    expect(md).toContain('Delivery: `sent_unconfirmed`')
    expect(md).toContain('Lead with retrieved facts.')
    expect(md).toContain('eval-only')
  })
})

describe('Markdown report — Comparison to Baseline section', () => {
  it('renders score delta + per-root-cause + per-level tables', () => {
    const r = fullReport()
    r.comparison = {
      baseline_run_id: 'base-1',
      candidate_run_id: r.run_id,
      baseline_score: 0.31,
      candidate_score: 0.49,
      score_delta: 0.18,
      pass_delta: 1,
      partial_delta: -1,
      fail_delta: 0,
      root_cause_delta: {
        'retrieved-context-ignored': { before: 7, after: 2, delta: -5 },
        'retrieval-miss': { before: 1, after: 1, delta: 0 },
      },
      level_delta: {
        '0': { before_avg: 0.1, after_avg: 0.4, delta: 0.3 },
      },
      improved_turns: ['t-improved-1'],
      regressed_turns: [],
      unchanged_failed_turns: ['t-still-failing'],
    }
    const md = renderMarkdownReport(r)
    expect(md).toContain('## Comparison to Baseline')
    expect(md).toContain('Baseline run:** `base-1`')
    expect(md).toContain('+0.18') // score delta
    expect(md).toContain('Improved turns (1)')
    expect(md).toContain('Still failing (1)')
    // Root-cause table
    expect(md).toContain('| `retrieved-context-ignored` | 7 | 2 | -5 |')
  })
})

describe('Copilot prompt — comparison verdict', () => {
  it('promotes the candidate when override improved score with no regressions', () => {
    const r = fullReport()
    r.config.agent_prompt_override = {
      used: true,
      delivery: 'sent_unconfirmed',
      length: 100,
      hash: 'h',
      preview: '',
    }
    r.comparison = {
      baseline_run_id: 'base-1',
      candidate_run_id: r.run_id,
      baseline_score: 0.3,
      candidate_score: 0.55,
      score_delta: 0.25,
      pass_delta: 2,
      partial_delta: 0,
      fail_delta: -2,
      root_cause_delta: {},
      level_delta: {},
      improved_turns: ['t-1', 't-2'],
      regressed_turns: [],
      unchanged_failed_turns: [],
    }
    const prompt = buildCopilotPrompt(r)
    expect(prompt).toMatch(/promote the candidate agent prompt/i)
  })

  it('says "keep iterating" when override regressed', () => {
    const r = fullReport()
    r.config.agent_prompt_override = {
      used: true,
      delivery: 'sent_unconfirmed',
      length: 100,
      hash: 'h',
      preview: '',
    }
    r.comparison = {
      baseline_run_id: 'base-1',
      candidate_run_id: r.run_id,
      baseline_score: 0.6,
      candidate_score: 0.4,
      score_delta: -0.2,
      pass_delta: -1,
      partial_delta: 0,
      fail_delta: 1,
      root_cause_delta: {},
      level_delta: {},
      improved_turns: [],
      regressed_turns: ['t-r1'],
      unchanged_failed_turns: [],
    }
    const prompt = buildCopilotPrompt(r)
    expect(prompt).toMatch(/keep iterating/i)
  })
})

describe('Markdown report — Retrieval Diagnostics section', () => {
  it('renders a Retrieval Diagnostics block for failed docs-grounded turns', () => {
    const r = reportWithRootCause('retrieved-context-ignored', 'pass', [
      { source_path: 'concepts/episodes.md', text: 'Episodes are immutable.' },
    ])
    const md = renderMarkdownReport(r)
    expect(md).toContain('## Retrieval Diagnostics')
    expect(md).toContain('**Top sources:** concepts/episodes.md')
    expect(md).toContain('Expected fact present in retrieved context:** yes')
    expect(md).toContain('Likely root cause:** retrieved-context-ignored')
  })

  it('renders "(token match)" marker for paraphrase-tolerant matches', () => {
    // Production scenario from eval-3d420bdfead9: must_include phrases
    // that match retrieved text only via plurality / hyphenation /
    // stopword-tolerant token match. The markdown should label those
    // matches explicitly so the operator can tell them apart from
    // exact substring hits.
    const t = turn({
      turn_id: 'rt-tok',
      level: 0,
      category: 'identity',
      question: 'What are the primary backup methods provided by Statewave?',
      answer: 'incremental and differential backups',
      metadata: {
        requires_code: false,
        requires_docs_grounding: true,
        topic_drift: false,
        false_premise: false,
        must_include: ['subject-level backups', 'full database backups'],
      },
      retrieved_context: {
        status: 'pass',
        subject_id: 'statewave-support-docs',
        query: 'q',
        results: [
          {
            kind: 'fact',
            text: 'Statewave offers two backup methods: subject-level and full database backup.',
          },
        ],
      },
      evaluation: evaluation({
        verdict: 'fail',
        overall_score: 0.2,
        likely_root_cause: ['retrieved-context-ignored'],
      }),
    })
    const sums = summarize([t])
    const r: import('../server/self-healing-eval/types').EvalReport = {
      run_id: 'run-tok',
      started_at: '2026-04-01T00:00:00Z',
      finished_at: '2026-04-01T00:00:30Z',
      status: 'fail',
      mode: 'smoke',
      max_level: 1,
      config: {
        statewave_api_url: 'https://x',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        demo_agent_configured: true,
        webhook_configured: false,
        agent_prompt_override: { used: false, delivery: 'not_used', length: 0, hash: '', preview: '' },
      },
      health: { status: 'pass', details: {} },
      webhook: { status: 'not_configured', trigger_attempted: false, delivery_observed: false, details: {}, recommended_fix: '' },
      demo_job: { status: 'pass', details: {} },
      conversation: [t],
      summary: sums.summary,
      summary_by_level: sums.byLevel,
      summary_by_category: sums.byCategory,
      summary_by_root_cause: sums.byRootCause,
      recommendations: buildRecommendations(sums.byRootCause, sums.byLevel),
      copilot_prompt: '',
      progress: { completed: 1, total: 1, current_question_id: null },
      error: null,
    }
    const md = renderMarkdownReport(r)
    expect(md).toContain('subject-level backups (token match)')
    expect(md).toContain('full database backups (token match)')
    expect(md).toContain('Likely root cause:** retrieved-context-ignored')
  })

  it('shows the explicit must_include check + correction marker when present', () => {
    // Build a report whose turn carries must_include AND was flipped
    // by the deterministic corrector — the markdown should make both
    // facts visible to the operator.
    const t = turn({
      turn_id: 'rt2',
      level: 0,
      category: 'identity',
      question: 'What is Statewave?',
      answer: 'generic filler.',
      metadata: {
        requires_code: false,
        requires_docs_grounding: true,
        topic_drift: false,
        false_premise: false,
        must_include: ['memory', 'agent'],
      },
      retrieved_context: {
        status: 'pass',
        subject_id: 'statewave-support-docs',
        query: 'q',
        results: [
          { kind: 'fact', text: 'Alembic manages database migrations.' },
          { kind: 'fact', text: 'Statewave uses app-layer tenant isolation.' },
        ],
      },
      evaluation: evaluation({
        verdict: 'fail',
        overall_score: 0.2,
        reason:
          '[deterministic correction: must_include terms (memory, agent) not found in retrieved text — judge said retrieved-context-ignored, evidence says retrieval-miss] agent gave generic filler.',
        likely_root_cause: ['retrieval-miss'],
      }),
    })
    const sums = summarize([t])
    const r: import('../server/self-healing-eval/types').EvalReport = {
      run_id: 'run-rt2',
      started_at: '2026-04-01T00:00:00Z',
      finished_at: '2026-04-01T00:00:30Z',
      status: 'fail',
      mode: 'smoke',
      max_level: 1,
      config: {
        statewave_api_url: 'https://x',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        demo_agent_configured: true,
        webhook_configured: false,
        agent_prompt_override: { used: false, delivery: 'not_used', length: 0, hash: '', preview: '' },
      },
      health: { status: 'pass', details: {} },
      webhook: { status: 'not_configured', trigger_attempted: false, delivery_observed: false, details: {}, recommended_fix: '' },
      demo_job: { status: 'pass', details: {} },
      conversation: [t],
      summary: sums.summary,
      summary_by_level: sums.byLevel,
      summary_by_category: sums.byCategory,
      summary_by_root_cause: sums.byRootCause,
      recommendations: buildRecommendations(sums.byRootCause, sums.byLevel),
      copilot_prompt: '',
      progress: { completed: 1, total: 1, current_question_id: null },
      error: null,
    }
    const md = renderMarkdownReport(r)
    expect(md).toContain('**must_include checked:** memory, agent')
    expect(md).toContain('**Found in retrieved text:** _none_')
    expect(md).toContain('Expected fact present in retrieved context:** no')
    expect(md).toContain('Likely root cause:** retrieval-miss _(deterministic correction applied)_')
  })
})
