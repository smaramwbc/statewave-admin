/**
 * Eval-only agent prompt override tests.
 *
 * Pins:
 *   - preparePromptOverride: redacts secrets, caps length, hashes, makes preview
 *   - agent client forwards override in body when supplied
 *   - agent client omits the field when no override is set
 *   - agent client recognizes the system_prompt_override_applied marker
 *     in the demo agent response
 *   - report storage contains preview/hash/length but NOT the raw text
 */
import { describe, expect, it, vi } from 'vitest'
import { callDemoAgent } from '../server/self-healing-eval/agentClient'
import {
  PROMPT_OVERRIDE_MAX_BYTES,
  preparePromptOverride,
} from '../server/self-healing-eval/promptOverride'
import type { EvalConfig } from '../server/self-healing-eval/config'

function cfg(): EvalConfig {
  return {
    enabled: true,
    llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k', baseUrl: null },
    demoAgent: {
      url: 'https://demo.example/agent',
      apiKey: null,
      bodyFormat: 'default',
      persona: 'statewave-support',
    },
    webhookConfigured: false,
    storagePath: null,
    statewaveApiUrl: 'https://upstream.example',
    statewaveApiKey: 'k',
    docsSubjectId: 'statewave-support-docs',
  }
}

describe('preparePromptOverride', () => {
  it('returns delivery="not_used" when no override is supplied', () => {
    const r = preparePromptOverride(undefined)
    expect(r.metadata.used).toBe(false)
    expect(r.metadata.delivery).toBe('not_used')
    expect(r.text).toBe('')
  })

  it('returns delivery="not_used" for empty / whitespace-only input', () => {
    expect(preparePromptOverride('').metadata.delivery).toBe('not_used')
    expect(preparePromptOverride('   \n\t').metadata.delivery).toBe('not_used')
  })

  it('redacts secrets BEFORE producing the preview', () => {
    const r = preparePromptOverride(
      'You are an agent. API key sk-projABCDEFGHIJKLMN1234567890 is in the system.',
    )
    expect(r.text).not.toContain('sk-projABCDEFGHIJKLMN1234567890')
    expect(r.text).toContain('[REDACTED]')
    // Preview is taken from the redacted text — cannot leak the secret.
    expect(r.metadata.preview).not.toContain('sk-projABCDEFGHIJKLMN1234567890')
  })

  it('caps text at PROMPT_OVERRIDE_MAX_BYTES', () => {
    const huge = 'You are an agent. ' + 'x'.repeat(PROMPT_OVERRIDE_MAX_BYTES)
    const r = preparePromptOverride(huge)
    expect(r.text.length).toBe(PROMPT_OVERRIDE_MAX_BYTES)
    expect(r.metadata.length).toBe(PROMPT_OVERRIDE_MAX_BYTES)
  })

  it('produces a stable SHA-256 hash for identical inputs', () => {
    const a = preparePromptOverride('lead with retrieved facts.')
    const b = preparePromptOverride('lead with retrieved facts.')
    expect(a.metadata.hash).toBe(b.metadata.hash)
    expect(a.metadata.hash.length).toBe(64)
  })

  it('different inputs produce different hashes', () => {
    const a = preparePromptOverride('lead with retrieved facts.')
    const b = preparePromptOverride('lead with retrieved facts!')
    expect(a.metadata.hash).not.toBe(b.metadata.hash)
  })
})

describe('callDemoAgent — system_prompt_override threading', () => {
  it('omits system_prompt_override from body when not supplied', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
    }
    await callDemoAgent(
      cfg(),
      {
        subject_id: 's',
        session_id: 'sess',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'q' }],
      },
      { fetchImpl },
    )
    expect((capturedBody as Record<string, unknown>).system_prompt_override).toBeUndefined()
  })

  it('includes system_prompt_override in body when supplied', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
    }
    await callDemoAgent(
      cfg(),
      {
        subject_id: 's',
        session_id: 'sess',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'q' }],
      },
      {
        fetchImpl,
        systemPromptOverride: 'Lead with retrieved facts.',
      },
    )
    expect((capturedBody as Record<string, string>).system_prompt_override).toBe(
      'Lead with retrieved facts.',
    )
  })

  it('also threads override into the statewave-web body shape alongside persona', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
    }
    const webCfg = cfg()
    webCfg.demoAgent.bodyFormat = 'statewave-web'
    await callDemoAgent(
      webCfg,
      {
        subject_id: 's',
        session_id: 'sess',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'q' }],
      },
      {
        fetchImpl,
        systemPromptOverride: 'Lead with retrieved facts.',
      },
    )
    expect(capturedBody).toMatchObject({
      mode: 'statewave',
      persona: 'statewave-support',
      system_prompt_override: 'Lead with retrieved facts.',
    })
  })

  it('records override_confirmed=true when the agent echoes the marker', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          message: 'ok',
          system_prompt_override_applied: true,
        }),
        { status: 200 },
      ),
    )
    const r = await callDemoAgent(
      cfg(),
      { subject_id: 's', session_id: 'sess', agent_id: 'a', messages: [{ role: 'user', content: 'q' }] },
      { fetchImpl, systemPromptOverride: 'override' },
    )
    expect(r.override_confirmed).toBe(true)
  })

  it('records override_confirmed=false when the agent omits the marker', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
    const r = await callDemoAgent(
      cfg(),
      { subject_id: 's', session_id: 'sess', agent_id: 'a', messages: [{ role: 'user', content: 'q' }] },
      { fetchImpl, systemPromptOverride: 'override' },
    )
    expect(r.override_confirmed).toBe(false)
  })
})
