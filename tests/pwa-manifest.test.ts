/**
 * Validates the static PWA manifest and the HTML head wiring.
 *
 * The manifest is the install contract — if any of the required fields
 * are missing, Chrome / Edge silently refuse to surface the install
 * prompt. Lock down the shape so a future refactor doesn't break
 * installability.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const repoRoot = resolve(__dirname, '..')
const manifestPath = join(repoRoot, 'public', 'manifest.webmanifest')
const indexHtmlPath = join(repoRoot, 'index.html')

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: string
}

interface Manifest {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: ManifestIcon[]
}

const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

describe('manifest.webmanifest', () => {
  it('declares the expected name and short_name', () => {
    expect(manifest.name).toBe('Statewave Admin')
    expect(manifest.short_name).toBe('Statewave')
  })

  it('declares a non-empty, accurate description', () => {
    expect(manifest.description).toMatch(/Statewave/i)
    expect(manifest.description.length).toBeGreaterThan(10)
  })

  it('uses standalone display with a root scope', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url.startsWith('/')).toBe(true)
  })

  it('declares brand-aligned theme and background colors', () => {
    // The admin's default theme is dark; surface-0 is #0a0f1a, which is
    // what we want both browsers' chrome and the install splash to use.
    expect(manifest.theme_color).toBe('#0a0f1a')
    expect(manifest.background_color).toBe('#0a0f1a')
  })

  it('ships the full icon set required by Chrome/Edge install', () => {
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('declares at least one maskable icon for adaptive Android display', () => {
    const maskable = manifest.icons.filter((i) => i.purpose?.includes('maskable'))
    expect(maskable.length).toBeGreaterThanOrEqual(1)
    // Maskable icons should ship in both 192 and 512 so older Androids
    // get one and Pixel-class get the higher-resolution path.
    const sizes = maskable.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('every declared icon file exists on disk', () => {
    for (const icon of manifest.icons) {
      const path = join(repoRoot, 'public', icon.src.replace(/^\//, ''))
      expect(() => statSync(path), `expected ${icon.src} to exist`).not.toThrow()
    }
  })
})

describe('index.html PWA wiring', () => {
  const html = readFileSync(indexHtmlPath, 'utf-8')

  it('links to the manifest', () => {
    expect(html).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/)
  })

  it('declares both light and dark theme-color metas', () => {
    expect(html).toMatch(/<meta\s+name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/)
    expect(html).toMatch(/<meta\s+name="theme-color"[^>]*media="\(prefers-color-scheme: light\)"/)
  })

  it('opts into iOS standalone install', () => {
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/)
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-title"\s+content="Statewave"/)
    expect(html).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\/apple-touch-icon\.png"/)
  })

  it('uses viewport-fit=cover so notch / safe-area-inset works in standalone', () => {
    expect(html).toMatch(/viewport-fit=cover/)
  })

  it('declares a description meta', () => {
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]*Statewave[^"]*"/)
  })
})
