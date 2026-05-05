/**
 * Question bank tests.
 *
 * Pins:
 *   - mode-based level ceilings (smoke=0–1, developer=0–6, full=0–9)
 *   - default question count caps (smoke=8, developer=20, full=40)
 *   - max_level + max_questions overrides
 *   - include_code / include_topic_drift filters
 *   - L5 npm/code question metadata is correctly tagged
 *   - L9 topic drift question metadata is correctly tagged
 *   - deterministic ordering is stable across calls
 */
import { describe, it, expect } from 'vitest'
import {
  allQuestions,
  getDefaultQuestionCount,
  getMaxLevelForMode,
  selectQuestions,
} from '../server/self-healing-eval/questionBank'
import type { EvalLevel } from '../server/self-healing-eval/types'

describe('questionBank — level ceilings + defaults', () => {
  it('smoke caps at level 1', () => {
    expect(getMaxLevelForMode('smoke')).toBe(1)
  })
  it('developer caps at level 6', () => {
    expect(getMaxLevelForMode('developer')).toBe(6)
  })
  it('full caps at level 9', () => {
    expect(getMaxLevelForMode('full')).toBe(9)
  })
  it('default question count caps are MVP-sized', () => {
    expect(getDefaultQuestionCount('smoke')).toBe(8)
    expect(getDefaultQuestionCount('developer')).toBe(20)
    expect(getDefaultQuestionCount('full')).toBe(40)
  })
})

describe('questionBank — selectQuestions filtering', () => {
  it('smoke mode returns only level 0–1 questions', () => {
    const qs = selectQuestions({ mode: 'smoke', max_questions: 100 })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.level).toBeLessThanOrEqual(1)
    }
  })

  it('developer mode returns only level 0–6 questions', () => {
    const qs = selectQuestions({ mode: 'developer', max_questions: 100 })
    expect(qs.length).toBeGreaterThan(0)
    const seenLevels = new Set(qs.map((q) => q.level))
    for (const lvl of seenLevels) {
      expect(lvl).toBeLessThanOrEqual(6)
    }
    expect(seenLevels.has(5)).toBe(true)
  })

  it('full mode includes level 7-9 questions', () => {
    const qs = selectQuestions({ mode: 'full', max_questions: 100 })
    const levels = new Set(qs.map((q) => q.level))
    expect(levels.has(7)).toBe(true)
    expect(levels.has(8)).toBe(true)
    expect(levels.has(9)).toBe(true)
  })

  it('honors max_level cap below the mode ceiling', () => {
    const qs = selectQuestions({ mode: 'full', max_level: 3 as EvalLevel, max_questions: 100 })
    for (const q of qs) {
      expect(q.level).toBeLessThanOrEqual(3)
    }
  })

  it('truncates to max_questions', () => {
    const qs = selectQuestions({ mode: 'full', max_questions: 5 })
    expect(qs).toHaveLength(5)
  })

  it('applies the per-mode default cap when max_questions is not given', () => {
    const smoke = selectQuestions({ mode: 'smoke' })
    expect(smoke.length).toBeLessThanOrEqual(8)
    const dev = selectQuestions({ mode: 'developer' })
    expect(dev.length).toBeLessThanOrEqual(20)
    const full = selectQuestions({ mode: 'full' })
    expect(full.length).toBeLessThanOrEqual(40)
  })

  it('drops requires_code questions when include_code=false', () => {
    const qs = selectQuestions({
      mode: 'developer',
      max_questions: 100,
      include_code: false,
    })
    for (const q of qs) {
      expect(q.requires_code).toBe(false)
    }
  })

  it('drops topic_drift questions when include_topic_drift=false', () => {
    const qs = selectQuestions({
      mode: 'full',
      max_questions: 100,
      include_topic_drift: false,
    })
    for (const q of qs) {
      expect(q.topic_drift).toBe(false)
    }
  })

  it('returns the same questions in the same order on repeated calls', () => {
    const a = selectQuestions({ mode: 'developer', max_questions: 100 })
    const b = selectQuestions({ mode: 'developer', max_questions: 100 })
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id))
  })
})

describe('questionBank — Level 5 npm/code metadata', () => {
  it('every L5 question is tagged requires_code=true', () => {
    const l5 = allQuestions().filter((q) => q.level === 5)
    expect(l5.length).toBeGreaterThan(0)
    for (const q of l5) {
      expect(q.requires_code).toBe(true)
    }
  })
  it('the L5 npm install question forbids inventing "statewave-sdk"', () => {
    const q = allQuestions().find((x) => x.id === 'l5-npm-install')
    expect(q).toBeDefined()
    expect(q!.must_not_claim.some((s) => /statewave-sdk/.test(s))).toBe(true)
  })
})

describe('questionBank — Level 9 topic-drift metadata', () => {
  it('every L9 question is tagged topic_drift=true', () => {
    const l9 = allQuestions().filter((q) => q.level === 9)
    expect(l9.length).toBeGreaterThan(0)
    for (const q of l9) {
      expect(q.topic_drift).toBe(true)
    }
  })
})

describe('questionBank — multi-turn follow-ups exist for each tier', () => {
  /**
   * Pins that the bank actually exercises the runner's multi-turn
   * conversation path — a follow_up_of pointer is the only way the
   * runner re-feeds prior assistant context to the demo agent.
   */
  it('has at least one follow-up at L1, L5, L6, L9', () => {
    const followUps = allQuestions().filter((q) => q.follow_up_of)
    const levels = new Set(followUps.map((q) => q.level))
    expect(levels.has(1)).toBe(true)
    expect(levels.has(5)).toBe(true)
    expect(levels.has(6)).toBe(true)
    expect(levels.has(9)).toBe(true)
  })

  it('every follow-up has a parent that exists in the bank', () => {
    const all = allQuestions()
    const ids = new Set(all.map((q) => q.id))
    for (const q of all.filter((x) => x.follow_up_of)) {
      expect(ids.has(q.follow_up_of!)).toBe(true)
    }
  })

  it('selectQuestions preserves follow-ups when their parent fits in the cap', () => {
    // Developer mode is capped at 20 by default and includes L1 + L5 +
    // L6, so the parent + follow-up pairs we pinned above must come
    // through together (or both be cut). Half-pairs are a regression.
    const qs = selectQuestions({ mode: 'developer' })
    const ids = new Set(qs.map((q) => q.id))
    for (const q of qs.filter((x) => x.follow_up_of)) {
      expect(ids.has(q.follow_up_of!)).toBe(true)
    }
  })

  it('every follow-up is positioned AFTER its parent in the selected order', () => {
    // The runner relies on the parent's assistant reply being in the
    // conversation context map before the follow-up turn fires.
    // A naïve alphabetical sort by id breaks this; this test pins the
    // declaration-order-within-level guarantee.
    const qs = selectQuestions({ mode: 'full' })
    const positions = new Map<string, number>()
    qs.forEach((q, i) => positions.set(q.id, i))
    for (const q of qs.filter((x) => x.follow_up_of)) {
      const parentPos = positions.get(q.follow_up_of!)
      expect(parentPos).toBeDefined()
      expect(parentPos!).toBeLessThan(positions.get(q.id)!)
    }
  })
})
