import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusChip, StatusDot } from '../src/components/StatusChip'

/**
 * StatusDot / StatusChip — pin the status -> colour tiering every health
 * indicator in the dashboard relies on:
 *   * ok | ready | healthy         -> emerald
 *   * degraded | watch | at_risk   -> amber
 *   * unknown | pending            -> gray
 *   * anything else                -> red (the fallback / error tier)
 *
 * The fallback is the part most worth guarding: a status string the
 * component does not know about renders as an error, and the match is a
 * plain case-sensitive `===`, so the tests below assert both explicitly.
 */

type Tier = 'ok' | 'warn' | 'neutral' | 'error'

// Classes each tier must carry, per element. Every other tier's classes must
// be absent, so a status mapped to two colours (or the wrong one) fails.
const DOT: Record<Tier, string[]> = {
  ok: ['bg-emerald-500'],
  warn: ['bg-amber-500'],
  neutral: ['bg-gray-400'],
  error: ['bg-red-500'],
}
const CHIP: Record<Tier, string[]> = {
  ok: ['bg-emerald-500/10', 'text-emerald-400'],
  warn: ['bg-amber-500/10', 'text-amber-400'],
  neutral: ['bg-gray-500/10', 'text-gray-400'],
  error: ['bg-red-500/10', 'text-red-400'],
}
const TIERS = Object.keys(DOT) as Tier[]

const KNOWN: Array<[status: string, tier: Tier]> = [
  ['ok', 'ok'],
  ['ready', 'ok'],
  ['healthy', 'ok'],
  ['degraded', 'warn'],
  ['watch', 'warn'],
  ['at_risk', 'warn'],
  ['unknown', 'neutral'],
  ['pending', 'neutral'],
]

// Fallback tier. 'error' and 'failed' are statuses callers really pass;
// the rest cover values the component has never heard of, including known
// words in the wrong case or with stray whitespace.
const FALLBACK = [
  'error',
  'failed',
  'banana',
  '',
  'OK',
  'Ready',
  'HEALTHY',
  'Degraded',
  'Pending',
  ' ok',
  'ok ',
]

function expectTier(el: Element, tier: Tier, classes: Record<Tier, string[]>) {
  for (const cls of classes[tier]) expect(el).toHaveClass(cls)
  for (const other of TIERS.filter((t) => t !== tier)) {
    for (const cls of classes[other]) expect(el).not.toHaveClass(cls)
  }
}

function renderDot(status: string): Element {
  const { container } = render(<StatusDot status={status} />)
  return container.firstElementChild as Element
}

function renderChip(status: string): Element {
  const { container } = render(<StatusChip status={status} />)
  return container.firstElementChild as Element
}

afterEach(() => cleanup())

describe('StatusDot', () => {
  it.each(KNOWN)('renders %s with the %s tier colour', (status, tier) => {
    expectTier(renderDot(status), tier, DOT)
  })

  it.each(FALLBACK)('falls back to the red tier for %j', (status) => {
    expectTier(renderDot(status), 'error', DOT)
  })

  it('renders a single round dot with no text', () => {
    const dot = renderDot('ok')
    expect(dot).toHaveClass('rounded-full')
    expect(dot.tagName).toBe('SPAN')
    expect(dot).toBeEmptyDOMElement()
  })
})

describe('StatusChip', () => {
  it.each(KNOWN)('renders %s with the %s tier colour', (status, tier) => {
    expectTier(renderChip(status), tier, CHIP)
  })

  it.each(FALLBACK)('falls back to the red tier for %j', (status) => {
    expectTier(renderChip(status), 'error', CHIP)
  })

  it.each([...KNOWN.map(([status]) => status), 'banana'])(
    'shows the raw status string %s inside the chip',
    (status) => {
      const chip = renderChip(status)
      // Rendered verbatim: no relabelling, no capitalisation, underscores kept.
      expect(screen.getByText(status)).toBe(chip)
    },
  )

  it.each([...KNOWN, ...FALLBACK.map((s): [string, Tier] => [s, 'error'])])(
    'embeds a dot of the same tier for %j',
    (status, tier) => {
      const chip = renderChip(status)
      const dots = chip.querySelectorAll('span')
      expect(dots).toHaveLength(1)
      expectTier(dots[0], tier, DOT)
    },
  )

  it('is case-sensitive: known words in another case are not recognised', () => {
    // Pins current behaviour. If matching is ever made case-insensitive this
    // test should be updated on purpose, not silently pass.
    const chip = renderChip('OK')
    expectTier(chip, 'error', CHIP)
    expect(screen.getByText('OK')).toBe(chip)
  })
})
