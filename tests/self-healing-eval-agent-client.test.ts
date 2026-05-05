/**
 * Demo agent body-format adapter tests.
 *
 * Pins the wire shape that goes out on the network for both
 *   bodyFormat: "default"        (eval native)
 *   bodyFormat: "statewave-web"  (statewave-web /api/widget-chat)
 *
 * The default shape is what the eval expects from any external demo
 * agent. The statewave-web shape lets operators point the eval at the
 * already-running web app for a quick local end-to-end test, without
 * patching that repo.
 */
import { describe, expect, it } from 'vitest'
import { callDemoAgent } from '../server/self-healing-eval/agentClient'
import type { EvalConfig } from '../server/self-healing-eval/config'

function baseCfg(over: Partial<EvalConfig['demoAgent']> = {}): EvalConfig {
  return {
    enabled: true,
    llm: {
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
      apiKey: 'k',
      baseUrl: 'http://litellm.local',
    },
    demoAgent: {
      url: 'https://demo.example/agent',
      apiKey: null,
      bodyFormat: 'default',
      persona: 'statewave-support',
      ...over,
    },
    webhookConfigured: false,
    storagePath: null,
    statewaveApiUrl: 'https://upstream.example',
    statewaveApiKey: 'k',
  }
}

describe('callDemoAgent — default body shape', () => {
  it('sends {subject_id, session_id, agent_id, messages}', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ message: 'hi' }), { status: 200 })
    }
    const r = await callDemoAgent(
      baseCfg(),
      {
        subject_id: 's',
        session_id: 'sess',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'q' }],
      },
      { fetchImpl },
    )
    expect(r.ok).toBe(true)
    expect(r.answer).toBe('hi')
    expect(capturedBody).toMatchObject({
      subject_id: 's',
      session_id: 'sess',
      agent_id: 'demo-support-agent',
      messages: [{ role: 'user', content: 'q' }],
    })
  })
})

describe('callDemoAgent — statewave-web body shape', () => {
  it('translates to {messages, mode, persona} for /api/widget-chat', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      // statewave-web returns the assistant message under "message"
      // (matched by the lenient parser).
      return new Response(
        JSON.stringify({ message: 'Statewave is a memory runtime.' }),
        { status: 200 },
      )
    }
    const r = await callDemoAgent(
      baseCfg({ bodyFormat: 'statewave-web' }),
      {
        subject_id: 'admin-self-healing-eval-demo',
        session_id: 'admin-self-healing-eval-run-x',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'What is Statewave?' }],
      },
      { fetchImpl },
    )
    expect(r.ok).toBe(true)
    expect(r.answer).toMatch(/memory runtime/i)
    // Must be the web-shape, NOT the default shape.
    expect(capturedBody).toMatchObject({
      messages: [{ role: 'user', content: 'What is Statewave?' }],
      mode: 'statewave',
      persona: 'statewave-support',
    })
    // And should not leak our subject_id / session_id / agent_id —
    // /api/widget-chat doesn't accept those.
    const obj = capturedBody as Record<string, unknown>
    expect(obj.subject_id).toBeUndefined()
    expect(obj.session_id).toBeUndefined()
    expect(obj.agent_id).toBeUndefined()
  })

  it('honors a custom persona override', async () => {
    let capturedBody: unknown = null
    const fetchImpl = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200 })
    }
    await callDemoAgent(
      baseCfg({ bodyFormat: 'statewave-web', persona: 'demo-coding-assistant' }),
      {
        subject_id: 's',
        session_id: 'sess',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'q' }],
      },
      { fetchImpl },
    )
    const obj = capturedBody as Record<string, unknown>
    expect(obj.persona).toBe('demo-coding-assistant')
  })

  it('surfaces a 4xx body in the error so the operator can debug shape mismatches', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: 'messages and mode required' }), { status: 400 })
    const r = await callDemoAgent(
      baseCfg(),
      {
        subject_id: 's',
        session_id: 'sess',
        agent_id: 'demo-support-agent',
        messages: [{ role: 'user', content: 'q' }],
      },
      { fetchImpl },
    )
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/HTTP 400/)
    expect(r.error).toMatch(/messages and mode required/)
  })
})
