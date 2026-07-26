/**
 * UI tests for the SelfHealingEval card on /diagnostics.
 *
 * Pins:
 *   - card renders an "unavailable" state with the LLM-config message
 *     when ADMIN_EVAL_LLM_* are not set
 *   - card renders an enabled "Run Self-Healing Eval" button when
 *     status reports available=true
 *   - Diagnostics page mounts the card alongside SystemSmokeCheck
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DiagnosticsPage } from '../src/pages/DiagnosticsPage'

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

function isEvalStatusUrl(input: RequestInfo | URL): boolean {
  const u = typeof input === 'string' ? input : input.toString()
  return u.includes('/api/self-healing-eval/status')
}

function isSmokeStatusUrl(input: RequestInfo | URL): boolean {
  const u = typeof input === 'string' ? input : input.toString()
  return u.includes('/api/admin/smoke/status')
}

function isEvalReportUrl(input: RequestInfo | URL): boolean {
  const u = typeof input === 'string' ? input : input.toString()
  return u.includes('/api/self-healing-eval/report')
}

const SMOKE_STATUS_DONE = {
  enabled: true,
  has_run: true,
  is_running: false,
  subject_id: 'statewave-demo:first-admin-run',
  last_result: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
})

describe('SelfHealingEval card — unavailable state', () => {
  it('hides the card entirely when the feature is not configured', async () => {
    // As of #2026-06-05 the card is hidden when availability.available
    // is false rather than rendered as a "this feature is unavailable,
    // here are five env vars you forgot" wall. Operators who never
    // configure the eval should not see a permanently-broken-looking
    // card on /diagnostics.
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            availability: {
              available: false,
              enabled: false,
              llm_configured: false,
              demo_agent_configured: false,
              webhook_configured: false,
              reasons: [
                'Set ADMIN_SELF_HEALING_EVAL_ENABLED=true to enable Self-Healing Eval.',
                'ADMIN_EVAL_LLM_PROVIDER is not set (expected: openai | anthropic | openai-compatible).',
              ],
            },
            is_running: false,
            current_run_id: null,
            latest: null,
            progress: null,
            config_summary: {
              statewave_api_url_set: true,
              llm_provider: null,
              llm_model: null,
              demo_agent_url_set: false,
              webhook_url_set: false,
              storage_path_set: false,
            },
          }),
        )
      }
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })

    // SystemSmokeCheck still mounts; SelfHealingEval does not.
    await waitFor(() => {
      expect(screen.getByText('System smoke check')).toBeInTheDocument()
    })
    expect(screen.queryByText('Self-Healing Eval')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Self-Healing Eval requires an LLM evaluator/i),
    ).not.toBeInTheDocument()
  })
})

describe('SelfHealingEval card — available state', () => {
  it('enables the run button and shows the estimated LLM-call cost', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            availability: {
              available: true,
              enabled: true,
              llm_configured: true,
              demo_agent_configured: true,
              webhook_configured: true,
              reasons: [],
            },
            is_running: false,
            current_run_id: null,
            latest: null,
            progress: null,
            config_summary: {
              statewave_api_url_set: true,
              llm_provider: 'openai',
              llm_model: 'gpt-4o-mini',
              demo_agent_url_set: true,
              webhook_url_set: true,
              storage_path_set: false,
            },
          }),
        )
      }
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /run self-healing eval/i })).not.toBeDisabled()
    })
    // Pre-flight cost: smoke mode default is 8 questions × 2 calls = 16
    // total. The label splits the cost so an operator sees demo-agent
    // and judge calls separately.
    expect(screen.getByText(/Estimated eval interactions/i)).toBeInTheDocument()
    expect(screen.getByText(/8 demo-agent calls/i)).toBeInTheDocument()
    expect(screen.getByText(/8 LLM judge calls/i)).toBeInTheDocument()
    expect(screen.getByText(/16 total/)).toBeInTheDocument()
  })
})

describe('SelfHealingEval card — clears stale report on Run', () => {
  /**
   * Pins the UX contract: when the operator kicks off a new run, the
   * previous run's HEALTH/DEMO_JOB/WEBHOOK strip + level table +
   * recommendations clear immediately. Stale numbers from the last run
   * sticking around while a new run is in flight is confusing.
   */
  it('hides the previous report immediately on Run click and only re-renders when the new run lands', async () => {
    const PRIOR_RESULT = {
      run_id: 'eval-old',
      started_at: '2026-04-01T00:00:00Z',
      finished_at: '2026-04-01T00:00:30Z',
      status: 'fail',
      mode: 'smoke',
      max_level: 1,
      config: {
        statewave_api_url: 'x',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        demo_agent_configured: true,
        webhook_configured: false,
      },
      health: { status: 'pass', details: {} },
      webhook: {
        status: 'partial',
        trigger_attempted: true,
        delivery_observed: false,
        details: {},
        recommended_fix: '',
      },
      demo_job: { status: 'pass', details: {} },
      conversation: [],
      summary: { turns_total: 0, passes: 0, partials: 0, fails: 0, overall_score: 0 },
      summary_by_level: {
        '0': { name: 'basic identity', turns_total: 5, passes: 0, partials: 0, fails: 5, average_score: 0 },
      },
      summary_by_category: {},
      summary_by_root_cause: {},
      recommendations: [
        {
          priority: 'high',
          area: 'admin',
          problem: 'STALE-RECO-FROM-PREVIOUS-RUN',
          recommended_change: 'should disappear on next Run',
          acceptance_criteria: [],
        },
      ],
      copilot_prompt: '',
      progress: { completed: 0, total: 0, current_question_id: null },
      error: null,
    }
    let reportFetches = 0
    let runStarts = 0
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            availability: {
              available: true,
              enabled: true,
              llm_configured: true,
              demo_agent_configured: true,
              webhook_configured: true,
              reasons: [],
            },
            is_running: false,
            current_run_id: null,
            latest: {
              run_id: 'eval-old',
              status: 'fail',
              finished_at: '2026-04-01T00:00:30Z',
              overall_score: 0,
              mode: 'smoke',
            },
            progress: null,
            config_summary: {
              statewave_api_url_set: true,
              llm_provider: 'openai',
              llm_model: 'gpt-4o-mini',
              demo_agent_url_set: true,
              webhook_url_set: true,
              storage_path_set: false,
            },
          }),
        )
      }
      if (isEvalReportUrl(url)) {
        reportFetches += 1
        return Promise.resolve(jsonRes(PRIOR_RESULT))
      }
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/self-healing-eval/run')) {
        runStarts += 1
        // Pretend the run started but never finishes during this test.
        return Promise.resolve(
          jsonRes({
            ok: true,
            run_id: 'eval-new',
            status: 'running',
            estimated_llm_calls: 16,
            error: null,
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })

    // Prior report has loaded — stale-recommendation marker is visible.
    await waitFor(() => {
      expect(screen.getByText(/STALE-RECO-FROM-PREVIOUS-RUN/)).toBeInTheDocument()
    })
    expect(reportFetches).toBeGreaterThan(0)

    // Click Run.
    const button = screen.getByRole('button', { name: /run self-healing eval/i })
    await act(async () => {
      button.click()
    })

    // The stale recommendation must be gone immediately, before the new
    // run produces any output.
    await waitFor(() => {
      expect(screen.queryByText(/STALE-RECO-FROM-PREVIOUS-RUN/)).toBeNull()
    })
    expect(runStarts).toBe(1)
  })
})

describe('SelfHealingEval card — topic + grounding question generation', () => {
  function isGenerateUrl(input: RequestInfo | URL): boolean {
    const u = typeof input === 'string' ? input : input.toString()
    return u.includes('/api/self-healing-eval/questions/generate')
  }

  const AVAILABLE_STATUS = {
    availability: {
      available: true,
      enabled: true,
      llm_configured: true,
      demo_agent_configured: true,
      webhook_configured: true,
      reasons: [],
    },
    is_running: false,
    current_run_id: null,
    latest: null,
    progress: null,
    config_summary: {
      statewave_api_url_set: true,
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_url_set: true,
      webhook_url_set: true,
      storage_path_set: false,
    },
  }

  it('renders topic + grounding controls and the Generate button', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Statewave memory runtime/i)).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText(/canonical docs/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate questions/i })).toBeInTheDocument()
  })

  it('Generate is disabled until topic + grounding (≥20 chars) are present', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    const btn = await waitFor(() =>
      screen.getByRole('button', { name: /generate questions/i }),
    )
    expect(btn).toBeDisabled()

    // Just topic — still disabled because grounding is empty.
    const topicInput = screen.getByPlaceholderText(/Statewave memory runtime/i)
    fireEvent.change(topicInput, { target: { value: 'Statewave' } })
    expect(btn).toBeDisabled()

    // Grounding too short — still disabled.
    const groundingInput = screen.getByPlaceholderText(/canonical docs/i)
    fireEvent.change(groundingInput, { target: { value: 'tooShort' } })
    expect(btn).toBeDisabled()

    // Long enough → enabled.
    fireEvent.change(groundingInput, {
      target: {
        value:
          'Statewave is a memory runtime for AI agents. Episodes are immutable inputs.',
      },
    })
    expect(btn).not.toBeDisabled()
  })

  it('renders a generated questions preview after a successful Generate call', async () => {
    const generatedQuestions = [
      {
        id: 'l0-what-is',
        level: 0,
        category: 'identity',
        question: 'What is Statewave?',
        expected_behavior: 'should describe.',
        must_include: ['memory'],
        must_not_claim: [],
        requires_code: false,
        requires_docs_grounding: true,
        topic_drift: false,
        false_premise: false,
        weight: 1,
      },
    ]
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      if (isGenerateUrl(url)) {
        return Promise.resolve(
          jsonRes({
            cache_key: 'sha256-abc',
            questions: generatedQuestions,
            warnings: [],
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    fireEvent.change(
      await waitFor(() => screen.getByPlaceholderText(/Statewave memory runtime/i)),
      { target: { value: 'Statewave' } },
    )
    fireEvent.change(screen.getByPlaceholderText(/canonical docs/i), {
      target: {
        value:
          'Statewave is a memory runtime for AI agents. Episodes are immutable inputs.',
      },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /generate questions/i }))
    })
    await waitFor(() => {
      expect(screen.getByText(/Generated bank ready/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/What is Statewave\?/)).toBeInTheDocument()
    expect(screen.getByText(/Generated questions preview/)).toBeInTheDocument()
  })
})

describe('SelfHealingEval card — subject picker + auto-suggest grounding', () => {
  function isSubjectsUrl(input: RequestInfo | URL): boolean {
    const u = typeof input === 'string' ? input : input.toString()
    // /api/proxy?path=/admin/subjects... — match either decoded or encoded.
    const decoded = decodeURIComponent(u)
    return decoded.includes('/admin/subjects')
  }
  function isSuggestUrl(input: RequestInfo | URL): boolean {
    const u = typeof input === 'string' ? input : input.toString()
    return u.includes('/api/self-healing-eval/grounding/suggest')
  }

  const AVAILABLE_STATUS = {
    availability: {
      available: true,
      enabled: true,
      llm_configured: true,
      demo_agent_configured: true,
      webhook_configured: true,
      reasons: [],
    },
    is_running: false,
    current_run_id: null,
    latest: null,
    progress: null,
    config_summary: {
      statewave_api_url_set: true,
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_url_set: true,
      webhook_url_set: true,
      storage_path_set: false,
    },
  }

  const SAMPLE_SUBJECTS = {
    subjects: [
      {
        subject_id: 'statewave-support-docs',
        tenant_id: null,
        episode_count: 100,
        memory_count: 80,
        last_episode_at: '2026-05-01T00:00:00Z',
        health_state: 'healthy',
        health_score: 0.9,
        open_sessions: 0,
      },
      {
        subject_id: 'demo-coding-assistant',
        tenant_id: null,
        episode_count: 12,
        memory_count: 6,
        last_episode_at: '2026-04-30T00:00:00Z',
        health_state: 'healthy',
        health_score: 0.8,
        open_sessions: 0,
      },
    ],
    total: 2,
    limit: 100,
    offset: 0,
  }

  it('renders the subject <select> with subjects from /admin/subjects', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      if (isSubjectsUrl(url)) return Promise.resolve(jsonRes(SAMPLE_SUBJECTS))
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(
        screen.getByText(/statewave-support-docs · 80 memories/i),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText(/demo-coding-assistant · 6 memories/i),
    ).toBeInTheDocument()
  })

  it('Auto-suggest is disabled until a subject is selected', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      if (isSubjectsUrl(url)) return Promise.resolve(jsonRes(SAMPLE_SUBJECTS))
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    const btn = await waitFor(() =>
      screen.getByRole('button', {
        name: /auto-suggest topic and grounding from selected subject/i,
      }),
    )
    expect(btn).toBeDisabled()
    // Pick a subject; button enables.
    const subjectSelect = screen.getByText(/Built-in demo subject/i).closest('select')
    expect(subjectSelect).toBeTruthy()
    fireEvent.change(subjectSelect!, { target: { value: 'statewave-support-docs' } })
    await waitFor(() => {
      expect(btn).not.toBeDisabled()
    })
  })

  it('clicking Auto-suggest populates topic + grounding fields', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      if (isSubjectsUrl(url)) return Promise.resolve(jsonRes(SAMPLE_SUBJECTS))
      if (isSuggestUrl(url)) {
        return Promise.resolve(
          jsonRes({
            topic: 'Statewave memory runtime',
            grounding:
              'Statewave is a memory runtime for AI agents. It ingests episodes and compiles memories.',
            source: {
              subject_id: 'statewave-support-docs',
              memory_count: 80,
              sampled_memory_ids: ['m-1'],
              grounding_truncated: false,
            },
          }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    const subjectSelect = await waitFor(() =>
      screen.getByText(/Built-in demo subject/i).closest('select'),
    )
    fireEvent.change(subjectSelect!, { target: { value: 'statewave-support-docs' } })
    const btn = screen.getByRole('button', {
      name: /auto-suggest topic and grounding from selected subject/i,
    })
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText(/Statewave memory runtime/i) as HTMLInputElement)
          .value,
      ).toBe('Statewave memory runtime')
    })
    const grounding = screen.getByPlaceholderText(/canonical docs/i) as HTMLTextAreaElement
    expect(grounding.value).toMatch(/memory runtime/i)
    expect(screen.getByText(/Suggested from 80 compiled memories/i)).toBeInTheDocument()
  })
})

describe('SelfHealingEval card — agent prompt override + comparison delta', () => {
  function isEvalRunUrl(input: RequestInfo | URL): boolean {
    const u = typeof input === 'string' ? input : input.toString()
    return u.includes('/api/self-healing-eval/run')
  }
  const AVAILABLE_STATUS = {
    availability: {
      available: true,
      enabled: true,
      llm_configured: true,
      demo_agent_configured: true,
      webhook_configured: true,
      reasons: [],
    },
    is_running: false,
    current_run_id: null,
    latest: {
      run_id: 'eval-prev',
      status: 'partial',
      finished_at: '2026-04-01T00:00:30Z',
      overall_score: 0.31,
      mode: 'smoke',
    },
    progress: null,
    config_summary: {
      statewave_api_url_set: true,
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_url_set: true,
      webhook_url_set: true,
      storage_path_set: false,
    },
  }

  const REPORT_WITH_COMPARISON = {
    run_id: 'eval-cand',
    started_at: '2026-04-02T00:00:00Z',
    finished_at: '2026-04-02T00:01:00Z',
    status: 'partial',
    mode: 'smoke',
    max_level: 1,
    config: {
      statewave_api_url: 'http://x',
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      demo_agent_configured: true,
      webhook_configured: false,
      agent_prompt_override: {
        used: true,
        delivery: 'sent_unconfirmed',
        length: 120,
        hash: 'h'.repeat(64),
        preview: 'Lead with retrieved facts.',
      },
    },
    health: { status: 'pass', details: {} },
    webhook: { status: 'not_configured', trigger_attempted: false, delivery_observed: false, details: {}, recommended_fix: '' },
    demo_job: { status: 'pass', details: {} },
    conversation: [],
    summary: { turns_total: 6, passes: 4, partials: 1, fails: 1, overall_score: 0.49 },
    summary_by_level: {},
    summary_by_category: {},
    summary_by_root_cause: {},
    recommendations: [],
    copilot_prompt: '',
    progress: { completed: 6, total: 6, current_question_id: null },
    error: null,
    comparison: {
      baseline_run_id: 'eval-prev',
      candidate_run_id: 'eval-cand',
      baseline_score: 0.31,
      candidate_score: 0.49,
      score_delta: 0.18,
      pass_delta: 1,
      partial_delta: -1,
      fail_delta: 0,
      root_cause_delta: {
        'retrieved-context-ignored': { before: 7, after: 2, delta: -5 },
      },
      level_delta: {},
      improved_turns: ['t-1'],
      regressed_turns: [],
      unchanged_failed_turns: [],
    },
  }

  it('renders the override textarea + checkbox + suggested-prompt button', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(screen.getByText(/Agent prompt override/i)).toBeInTheDocument()
    })
    expect(
      screen.getByPlaceholderText(/Paste a candidate demo-agent system prompt/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Insert suggested stricter prompt/i).closest('button') as HTMLButtonElement,
    ).toBeInTheDocument()
    expect(screen.getByText(/Compare next run against latest previous run/i)).toBeInTheDocument()
  })

  it('only sends system_prompt_override + baseline_run_id when toggled on', async () => {
    let capturedBody: unknown = null
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) return Promise.resolve(jsonRes(AVAILABLE_STATUS))
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      if (isEvalRunUrl(url) && (init as RequestInit | undefined)?.body) {
        capturedBody = JSON.parse((init as RequestInit).body as string)
        return Promise.resolve(
          jsonRes({ ok: true, run_id: 'r-new', status: 'running', estimated_llm_calls: 16, error: null }),
        )
      }
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    // Default: compareToPrevious is checked, override is unchecked.
    // Click the suggested-prompt button — that should fill the
    // textarea AND auto-toggle the override on.
    const suggest = await waitFor(() =>
      screen.getByText(/Insert suggested stricter prompt/i).closest('button') as HTMLButtonElement,
    )
    await act(async () => {
      fireEvent.click(suggest)
    })
    const runBtn = screen.getByRole('button', { name: /run self-healing eval/i })
    await act(async () => {
      fireEvent.click(runBtn)
    })
    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })
    const body = capturedBody as Record<string, unknown>
    expect(typeof body.system_prompt_override).toBe('string')
    expect((body.system_prompt_override as string).length).toBeGreaterThan(0)
    // baseline_run_id should be set from status.latest.run_id
    expect(body.baseline_run_id).toBe('eval-prev')
  })

  it('renders the comparison delta strip when the report has a comparison block', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            ...AVAILABLE_STATUS,
            latest: {
              run_id: 'eval-cand',
              status: 'partial',
              finished_at: '2026-04-02T00:01:00Z',
              overall_score: 0.49,
              mode: 'smoke',
            },
          }),
        )
      }
      if (isEvalReportUrl(url)) {
        return Promise.resolve(jsonRes(REPORT_WITH_COMPARISON))
      }
      return Promise.resolve(jsonRes({}))
    })
    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(screen.getByText(/Comparison to baseline run/i)).toBeInTheDocument()
    })
    // Score delta should appear with a sign.
    expect(screen.getByText(/\+0\.18/)).toBeInTheDocument()
    // Root cause shift line.
    expect(screen.getByText(/retrieved-context-ignored/)).toBeInTheDocument()
    // Override delivery surfaces (the strip shows "Agent prompt override:"
    // immediately followed by the delivery code — there are multiple
    // "Agent prompt override" occurrences on the page so we lock onto
    // the strip variant via `getAllByText` + presence assertion).
    expect(screen.getAllByText(/Agent prompt override/i).length).toBeGreaterThan(1)
    expect(screen.getByText(/sent_unconfirmed/i)).toBeInTheDocument()
  })
})

describe('Diagnostics page — composition', () => {
  it('mounts both SystemSmokeCheck and SelfHealingEval', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (isSmokeStatusUrl(url)) return Promise.resolve(jsonRes(SMOKE_STATUS_DONE))
      if (isEvalStatusUrl(url)) {
        return Promise.resolve(
          jsonRes({
            availability: {
              // Eval must be available for the card to mount — the
              // unavailable-state test above pins the hide-when-disabled
              // behaviour; this composition test pins the happy path.
              available: true,
              enabled: true,
              llm_configured: true,
              demo_agent_configured: true,
              webhook_configured: true,
              reasons: [],
            },
            is_running: false,
            current_run_id: null,
            latest: null,
            progress: null,
            config_summary: {
              statewave_api_url_set: true,
              llm_provider: 'openai',
              llm_model: 'gpt-4o-mini',
              demo_agent_url_set: true,
              webhook_url_set: false,
              storage_path_set: false,
            },
          }),
        )
      }
      if (isEvalReportUrl(url)) return Promise.resolve(jsonRes({}, 404))
      return Promise.resolve(jsonRes({}))
    })

    await act(async () => {
      render(
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>,
      )
    })
    await waitFor(() => {
      expect(screen.getByText('System smoke check')).toBeInTheDocument()
    })
    expect(screen.getByText('Self-Healing Eval')).toBeInTheDocument()
  })
})
