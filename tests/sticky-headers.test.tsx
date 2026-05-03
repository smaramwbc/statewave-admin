import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TableSkeleton } from '../src/components/ui/TableSkeleton'

/**
 * Sticky-header structure — pinned by inspecting the actual table HTML
 * each list page renders. We don't import the full pages here (they
 * pull in routing + fetch + auth), but we DO assert the shared
 * convention: every list-page <thead> carries the `sticky top-0`
 * classes and a theme-surface background.
 *
 * The check below reads the source of the three list-page templates so
 * a future regression that drops `sticky` shows up as a failed test
 * rather than a silent visual regression.
 */

afterEach(() => cleanup())

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readPage(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8')
}

describe('Sticky <thead> on list pages', () => {
  it.each([
    'src/pages/SubjectsPage.tsx',
    'src/pages/JobsPage.tsx',
    'src/pages/WebhooksPage.tsx',
  ])('%s renders <thead> with sticky top-0 and a theme background', (path) => {
    const src = readPage(path)
    // Must contain a <thead> opening tag carrying both the sticky class
    // AND a theme-surface background. The exact regex tolerates extra
    // whitespace / additional classes.
    expect(src).toMatch(/<thead\s+className="[^"]*sticky\s+top-0[^"]*"/)
    expect(src).toMatch(/<thead\s+className="[^"]*bg-\[var\(--theme-surface-1\)\][^"]*"/)
  })
})

describe('TableSkeleton smoke', () => {
  it('renders a busy region (sanity check that the skeleton table is mountable)', () => {
    const { getByRole } = render(<TableSkeleton rows={2} columns={2} />)
    const region = getByRole('status')
    expect(region.getAttribute('aria-busy')).toBe('true')
  })
})
