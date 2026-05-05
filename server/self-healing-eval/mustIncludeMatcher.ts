/**
 * Paraphrase-tolerant must_include matcher for the eval's deterministic
 * correction step.
 *
 * The earlier exact-substring matcher had two real failure modes from
 * production runs:
 *
 *   1. Plurality drift. must_include="full database backups" doesn't
 *      substring-match "full database backup" in retrieved text, even
 *      though the fact is plainly present.
 *   2. Lexical paraphrase. must_include="no GPU requirements" doesn't
 *      substring-match "without GPU requirements" — same fact.
 *
 * Both were causing the corrector to flip retrieved-context-ignored →
 * retrieval-miss when the agent actually HAD the relevant fact in
 * context and just ignored it. That mis-routes the Copilot prompt at
 * retrieval tuning when the real fix is the agent prompt.
 *
 * Two-stage matcher:
 *
 *   Stage 1: case-insensitive exact substring (cheap, catches most
 *   identifier-style terms like STATEWAVE_API_KEY).
 *
 *   Stage 2: token match. Lowercase + split on whitespace, hyphens,
 *   underscores, slashes, and common punctuation. Strip a tiny English
 *   stopword list. Lightly normalize trailing 's' for crude plural
 *   handling. A multi-token term needs ≥50% of its meaningful tokens
 *   to appear in the haystack; a single-token term needs that one
 *   token to match (after normalisation).
 *
 * Conservative on purpose: this is a guard against the LLM judge's
 * softness, not a fuzzy-match library. We never invent matches that
 * a careful operator wouldn't agree with.
 */

/**
 * Common English filler words. Kept tiny to stay deterministic.
 * Capturing semantically-light words ensures a phrase like
 * "no GPU requirements" reduces to ["gpu", "requirements"] before
 * counting matches.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'of',
  'in',
  'on',
  'to',
  'for',
  'from',
  'by',
  'with',
  'without',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'as',
  'no',
  'not',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'has',
  'have',
  'had',
])

export type MatchKind = 'exact' | 'token' | 'none'

export interface TermMatch {
  term: string
  found: boolean
  kind: MatchKind
}

/**
 * Strip a trailing 's' on words longer than 3 chars that aren't already
 * ending in 'ss' (like "process", "address"). Catches the common
 * backups/backup, requirements/requirement, methods/method drift
 * without trying to be a full stemmer.
 */
function lightNormalize(token: string): string {
  if (token.length <= 3) return token
  if (token.endsWith('ss')) return token
  if (token.endsWith('s')) return token.slice(0, -1)
  return token
}

/**
 * Lowercase, split on common phrase delimiters, normalize plural-ish
 * endings. Returns a unique-ish list (we keep duplicates so weighting
 * is honest if a token genuinely repeats).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s_/.,!?;:()[\]{}'"`-]+/)
    .filter((t) => t.length > 0)
    .map(lightNormalize)
}

function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t))
}

/**
 * Decide whether a single must_include `term` is found in `haystack`.
 * Stage 1 (exact substring) before Stage 2 (token match) so identifier
 * terms still match even when their tokens overlap with stopwords.
 */
export function termIsRetrieved(
  term: string,
  haystack: string,
  haystackTokens?: Set<string>,
): TermMatch {
  const trimmed = term.trim()
  if (!trimmed) return { term, found: false, kind: 'none' }
  // Stage 1: case-insensitive exact substring.
  if (haystack.toLowerCase().includes(trimmed.toLowerCase())) {
    return { term, found: true, kind: 'exact' }
  }
  // Stage 2: token match. Build the haystack token set lazily once
  // per call when not pre-computed by the caller.
  const haystackSet =
    haystackTokens ?? new Set(tokenize(haystack))
  const termTokens = meaningfulTokens(trimmed)
  // If stripping stopwords leaves nothing (e.g. term="of the"), fall
  // back to the raw tokens — better than silently zero-tokening.
  const tokens = termTokens.length > 0 ? termTokens : tokenize(trimmed)
  if (tokens.length === 0) return { term, found: false, kind: 'none' }

  const found = tokens.filter((t) => haystackSet.has(t)).length

  if (tokens.length === 1) {
    // Single-token: must match (after normalisation). Cheap and
    // unambiguous — same as exact, just normalised.
    return found >= 1
      ? { term, found: true, kind: 'token' }
      : { term, found: false, kind: 'none' }
  }
  // Multi-token: ≥50% threshold. Two-token terms need 1; three-token
  // terms need 2; four-token terms need 2; etc.
  const threshold = Math.ceil(tokens.length / 2)
  return found >= threshold
    ? { term, found: true, kind: 'token' }
    : { term, found: false, kind: 'none' }
}

/**
 * Bulk-match: returns one TermMatch per must_include term, in the
 * same order. Builds the haystack token set once for efficiency.
 */
export function findMustIncludeMatches(
  mustInclude: string[],
  haystack: string,
): TermMatch[] {
  const haystackSet = new Set(tokenize(haystack))
  return mustInclude.map((term) => termIsRetrieved(term, haystack, haystackSet))
}

/** Convenience: is at least one must_include term found in the haystack? */
export function anyMustIncludeFound(
  mustInclude: string[],
  haystack: string,
): boolean {
  if (mustInclude.length === 0) return false
  return findMustIncludeMatches(mustInclude, haystack).some((m) => m.found)
}
