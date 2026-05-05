/**
 * Paraphrase-tolerant must_include matcher tests.
 *
 * Pins the matcher behaviour that the deterministic correction relies
 * on, with cases drawn directly from production failures in run
 * eval-3d420bdfead9:
 *
 *   - "full database backups" should match "...full database backup."
 *     (plurality drift)
 *   - "subject-level backups" should match "...subject-level and full
 *     database backup..." (hyphenation + plurality)
 *   - "no GPU requirements" should match "...without GPU requirements."
 *     (lexical paraphrase via stopword filtering)
 *   - "FastAPI" must NOT match a haystack that doesn't contain it
 *     (single-token term still requires a real hit, paraphrase doesn't
 *     hand out free passes)
 */
import { describe, expect, it } from 'vitest'
import {
  anyMustIncludeFound,
  findMustIncludeMatches,
  termIsRetrieved,
} from '../server/self-healing-eval/mustIncludeMatcher'

describe('mustIncludeMatcher — exact substring (Stage 1)', () => {
  it('matches case-insensitive exact substring', () => {
    const r = termIsRetrieved('STATEWAVE_API_KEY', 'env: STATEWAVE_API_KEY=...')
    expect(r.found).toBe(true)
    expect(r.kind).toBe('exact')
  })

  it('returns kind="exact" for substring containment, even with extra wrapping text', () => {
    const r = termIsRetrieved('full database backup', 'two methods: subject-level and full database backup.')
    expect(r.kind).toBe('exact')
  })
})

describe('mustIncludeMatcher — plural / hyphen tolerance (Stage 2)', () => {
  it('plural drift: "full database backups" matches "full database backup"', () => {
    const r = termIsRetrieved(
      'full database backups',
      'Statewave offers two backup methods: subject-level and full database backup.',
    )
    expect(r.found).toBe(true)
    expect(r.kind).toBe('token')
  })

  it('hyphenation + plural: "subject-level backups" matches "subject-level and full database backup"', () => {
    const r = termIsRetrieved(
      'subject-level backups',
      'Statewave offers two backup methods: subject-level and full database backup.',
    )
    expect(r.found).toBe(true)
    expect(r.kind).toBe('token')
  })

  it('singular request: "requirements" matches "requirement" (and vice versa)', () => {
    expect(termIsRetrieved('requirements', 'a requirement here').found).toBe(true)
    expect(termIsRetrieved('requirement', 'two requirements here').found).toBe(true)
  })

  it('words ending in "ss" are NOT mangled (process != proces)', () => {
    // "process" is 7 chars, ends in 'ss' → must NOT be stripped.
    expect(termIsRetrieved('process', 'a different procedure').found).toBe(false)
  })
})

describe('mustIncludeMatcher — stopword filtering', () => {
  it('"no GPU requirements" matches "without GPU requirements" (stopwords ignored)', () => {
    const r = termIsRetrieved(
      'no GPU requirements',
      "Statewave's API is designed to run on CPU without GPU requirements.",
    )
    expect(r.found).toBe(true)
    expect(r.kind).toBe('token')
  })

  it('all-stopword phrase is treated as un-grounded (would never match)', () => {
    // "the and of" reduces to no meaningful tokens. Falls back to
    // raw tokens, then needs ≥ ceil(3/2)=2 of [the, and, of] in
    // haystack tokens — generally won't reach the threshold.
    const r = termIsRetrieved('the and of', 'unrelated technical content')
    expect(r.found).toBe(false)
  })
})

describe('mustIncludeMatcher — single-token guard', () => {
  it('single meaningful token: must match exactly OR via plural normalization', () => {
    expect(termIsRetrieved('FastAPI', 'we use Django and Flask.').found).toBe(false)
    expect(termIsRetrieved('FastAPI', 'we use FastAPI here.').kind).toBe('exact')
    // "backups" → normalizes to "backup", matches haystack token "backup"
    expect(termIsRetrieved('backups', 'one backup per night').found).toBe(true)
  })
})

describe('mustIncludeMatcher — unrelated text', () => {
  it('unrelated retrieved text does NOT trigger a false positive', () => {
    const r = termIsRetrieved(
      'subject-level backups',
      'Alembic is used for managing database migrations. Statewave runs on CPU.',
    )
    // "backup" doesn't appear, neither does "subject-level" — should miss.
    expect(r.found).toBe(false)
    expect(r.kind).toBe('none')
  })

  it('high-stopword phrase against unrelated text doesn\'t accidentally match', () => {
    const r = termIsRetrieved(
      'no GPU requirements',
      'Alembic manages migrations. Tenant isolation is at the app layer.',
    )
    // GPU absent, requirements absent — even with "no" stripped, no
    // meaningful tokens hit.
    expect(r.found).toBe(false)
  })
})

describe('mustIncludeMatcher — bulk APIs', () => {
  it('findMustIncludeMatches returns one TermMatch per input, in order', () => {
    const results = findMustIncludeMatches(
      ['FastAPI', 'PostgreSQL 16', 'pgvector'],
      'No matching terms here.',
    )
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.found)).toEqual([false, false, false])
    expect(results.map((r) => r.term)).toEqual([
      'FastAPI',
      'PostgreSQL 16',
      'pgvector',
    ])
  })

  it('anyMustIncludeFound returns true when at least one term matches paraphrase', () => {
    const found = anyMustIncludeFound(
      ['FastAPI', 'no GPU requirements'],
      "Statewave's API is designed to run on CPU without GPU requirements.",
    )
    expect(found).toBe(true)
  })

  it('anyMustIncludeFound returns false when none match', () => {
    const found = anyMustIncludeFound(
      ['FastAPI', 'PostgreSQL 16', 'pgvector'],
      'Alembic manages database migrations.',
    )
    expect(found).toBe(false)
  })

  it('empty must_include list never reports a match', () => {
    expect(anyMustIncludeFound([], 'any text')).toBe(false)
  })
})

// ─── Integration with the deterministic corrector ────────────────────────

describe('mustIncludeMatcher — corrector behaviour through the matcher', () => {
  /**
   * The corrector itself is unit-tested elsewhere (see
   * self-healing-eval-judge.test.ts). This block locks in the contract
   * the corrector relies on: when the matcher reports any token match,
   * the corrector must NOT flip retrieved-context-ignored → retrieval-miss.
   *
   * Production case: l0-backup-methods. The retrieved memory contained
   * the singular-form fact, must_include used the plural form. Pre-fix
   * this got flipped to retrieval-miss (wrong); post-fix it stays
   * retrieved-context-ignored (right — the agent had it and ignored it).
   */
  it('matches the l0-backup-methods scenario as a token match', () => {
    const haystack =
      'Statewave offers two backup methods: subject-level and full database backup. Subject snapshots are restricted to the same instance.'
    expect(
      anyMustIncludeFound(['subject-level backups', 'full database backups'], haystack),
    ).toBe(true)
  })

  it('matches the l1-architecture-comparison "no GPU requirements" case via paraphrase', () => {
    const haystack =
      "Statewave's API is designed to run on CPU without GPU requirements. The export/import functionality works alongside pg_dump."
    // "app-layer tenant isolation" is genuinely absent, but
    // "no GPU requirements" should be detected from "without GPU
    // requirements" — partial evidence, NOT total miss.
    expect(
      anyMustIncludeFound(['app-layer tenant isolation', 'no GPU requirements'], haystack),
    ).toBe(true)
  })

  it('keeps l0-database-architecture as retrieval-miss when FastAPI/PostgreSQL/pgvector are all absent', () => {
    const haystack =
      'Alembic manages migrations. Backups are subject-level or full. The rate limiter uses database connections.'
    expect(
      anyMustIncludeFound(['FastAPI', 'PostgreSQL 16', 'pgvector'], haystack),
    ).toBe(false)
  })
})
