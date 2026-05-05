/**
 * Question bank for the Self-Healing Eval ladder.
 *
 * Every question is statically defined here so a run is reproducible
 * and the metadata is auditable in the report. Levels 0–9 follow the
 * ladder defined in the spec:
 *
 *   0 — basic identity              (smoke)
 *   1 — comparisons                 (smoke)
 *   2 — workflow                    (developer)
 *   3 — local setup                 (developer)
 *   4 — API + integration           (developer)
 *   5 — npm / SDK / code            (developer)
 *   6 — debugging                   (developer)
 *   7 — multi-step implementation   (full)
 *   8 — false-premise correction    (full)
 *   9 — topic drift / recovery      (full)
 *
 * Filters: by mode (smoke=0–1, developer=0–6, full=0–9), by max_level,
 * by category, by code/topic-drift flags, by deterministic count.
 */
import type { EvalLevel, EvalMode, EvalQuestion, QuestionFilter } from './types.js'

const QUESTIONS: EvalQuestion[] = [
  // ─── Level 0 ─ basic identity ───────────────────────────────────────────
  {
    id: 'l0-what-is-statewave',
    level: 0,
    category: 'identity',
    question: 'What is Statewave in one paragraph?',
    expected_behavior:
      'Should explain Statewave as a memory runtime for AI agents — episode ingestion, memory compilation, retrievable context bundles.',
    must_include: ['memory', 'agent'],
    must_not_claim: ['Statewave is a chatbot', 'Statewave is a database replacement'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l0-episodes',
    level: 0,
    category: 'identity',
    question: 'What are episodes in Statewave?',
    expected_behavior:
      'Should describe episodes as immutable, append-only records of raw interactions/events.',
    must_include: ['episode'],
    must_not_claim: ['episodes are mutable', 'episodes can be edited in place'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l0-compiled-memories',
    level: 0,
    category: 'identity',
    question: 'What are compiled memories in Statewave?',
    expected_behavior:
      'Should describe compiled memories as derived facts/insights produced by running compile over episodes.',
    must_include: ['compile', 'memor'],
    must_not_claim: ['memories are written by the user directly'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l0-context-bundles',
    level: 0,
    category: 'identity',
    question: 'What is a context bundle in Statewave?',
    expected_behavior:
      'Should describe a context bundle as a retrieved, ranked set of relevant memories/episodes for a query.',
    must_include: ['context'],
    must_not_claim: ['context bundles are stored verbatim chat history'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l0-delete-subject',
    level: 0,
    category: 'identity',
    question: 'Can I delete all data for a single subject in Statewave?',
    expected_behavior:
      'Should confirm Yes, via DELETE /admin/subjects/{id} or the equivalent API call, and note it cascades to episodes + memories.',
    must_include: ['delete'],
    must_not_claim: ['deletion is impossible'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },

  // ─── Level 1 ─ comparison ───────────────────────────────────────────────
  {
    id: 'l1-vs-prompt-stuffing',
    level: 1,
    category: 'comparison',
    question: 'How is Statewave different from stuffing chat history into a prompt?',
    expected_behavior:
      'Should call out persistence, ranking, compilation, and provenance — distinguish memory runtime from naive context concat.',
    must_include: ['memory', 'rank'],
    must_not_claim: ['Statewave is just a longer prompt', 'Statewave only saves messages'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l1-vs-chatbot',
    level: 1,
    category: 'comparison',
    question: 'How is Statewave different from a normal chatbot?',
    expected_behavior:
      'Should explain Statewave is the memory layer behind agents/chatbots, not a chatbot itself.',
    must_include: ['memory'],
    must_not_claim: ['Statewave is a chatbot', 'Statewave generates chat replies'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l1-why-not-raw-messages',
    level: 1,
    category: 'comparison',
    question: 'Why use Statewave instead of just saving raw messages in my own DB?',
    expected_behavior:
      'Should explain compile-to-memory, retrieval ranking, deduping, provenance, and time-aware context as value-adds.',
    must_include: ['compile', 'retriev'],
    must_not_claim: ['Statewave only stores messages'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l1-followup-vs-vector-db',
    level: 1,
    category: 'comparison',
    question:
      'Got it. Then how is Statewave different from just running a vector database on top of those raw messages?',
    expected_behavior:
      'Should build on the previous turn — should explain that Statewave is more than vector search: compilation, conflict resolution, time-aware ranking, provenance. A vector DB is a building block, not a substitute. Must reference the prior turn implicitly (e.g. "as I mentioned").',
    must_include: ['vector', 'compile'],
    must_not_claim: ['Statewave is just a vector database'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    follow_up_of: 'l1-why-not-raw-messages',
    weight: 1,
  },

  // ─── Level 2 ─ workflow ─────────────────────────────────────────────────
  {
    id: 'l2-normal-flow',
    level: 2,
    category: 'workflow',
    question: 'What is the normal flow for storing and retrieving memory in Statewave?',
    expected_behavior:
      'Should describe: ingest episodes → compile memories → retrieve ranked context bundle → answer with provenance.',
    must_include: ['episode', 'compile', 'retriev'],
    must_not_claim: ['skip compilation', 'no retrieval needed'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l2-after-compile',
    level: 2,
    category: 'workflow',
    question: 'What happens after episodes are compiled?',
    expected_behavior:
      'Should describe that compiled memories become first-class records available for retrieval, embedding, deduping, and conflict resolution.',
    must_include: ['memor'],
    must_not_claim: ['episodes are deleted after compile'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l2-when-context-bundles',
    level: 2,
    category: 'workflow',
    question: 'When should I use context bundles in Statewave?',
    expected_behavior:
      'Should describe context bundles as the recommended way to feed an LLM relevant memory at inference time.',
    must_include: ['context'],
    must_not_claim: ['context bundles are deprecated'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },

  // ─── Level 3 ─ setup ───────────────────────────────────────────────────
  {
    id: 'l3-run-locally',
    level: 3,
    category: 'setup',
    question: 'How do I run Statewave locally?',
    expected_behavior:
      'Should reference docker-compose or the documented local-dev story (Postgres + pgvector + the API container).',
    must_include: ['docker', 'postgres'],
    must_not_claim: ['requires a paid cloud account', 'requires a GPU'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l3-env-vars',
    level: 3,
    category: 'setup',
    question: 'What environment variables do I need to set to run Statewave?',
    expected_behavior:
      'Should mention STATEWAVE_DATABASE_URL, STATEWAVE_API_KEY (for protected endpoints), and the optional STATEWAVE_WEBHOOK_URL.',
    must_include: ['STATEWAVE_'],
    must_not_claim: ['no env vars are required for production'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l3-services',
    level: 3,
    category: 'setup',
    question: 'What services does Statewave need to run?',
    expected_behavior:
      'Should mention Postgres (with pgvector) and the Statewave API service. Should not invent extra dependencies.',
    must_include: ['postgres', 'pgvector'],
    must_not_claim: ['Redis is required', 'a GPU is required'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l3-health-check',
    level: 3,
    category: 'setup',
    question: 'How do I check if the Statewave API is healthy?',
    expected_behavior:
      'Should mention /readyz or the admin /admin/dashboard probe. /healthz acceptable too.',
    must_include: ['/readyz'],
    must_not_claim: ['Statewave has no health endpoint'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },

  // ─── Level 4 ─ API integration ─────────────────────────────────────────
  {
    id: 'l4-create-episode',
    level: 4,
    category: 'api',
    question: 'How do I create an episode through the Statewave API?',
    expected_behavior:
      'Should describe POST /v1/episodes with subject_id, source, type, payload, optional session_id and metadata.',
    must_include: ['/v1/episodes', 'POST'],
    must_not_claim: ['POST /create-memory'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l4-context-bundle',
    level: 4,
    category: 'api',
    question: 'How do I request a context bundle for a subject?',
    expected_behavior:
      'Should reference the documented context retrieval endpoint and include subject_id + a query.',
    must_include: ['context'],
    must_not_claim: ['context bundles must be built client-side'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l4-compile-memories',
    level: 4,
    category: 'api',
    question: 'How do I trigger memory compilation for a subject?',
    expected_behavior:
      'Should describe POST /v1/memories/compile with the subject_id, optional async flag.',
    must_include: ['/v1/memories/compile', 'POST'],
    must_not_claim: ['/compile-now'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l4-delete-subject',
    level: 4,
    category: 'api',
    question: 'How do I delete all data for a subject through the API?',
    expected_behavior:
      'Should reference DELETE /admin/subjects/{id} (admin-scoped). Should warn it is irreversible.',
    must_include: ['DELETE'],
    must_not_claim: ['deletion via GET'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l4-support-agent-flow',
    level: 4,
    category: 'api',
    question: 'How should my support agent use Statewave during a customer chat?',
    expected_behavior:
      'Should describe: log incoming message as an episode → request context bundle for the subject → call LLM with the bundle → respond → optionally compile in the background.',
    must_include: ['episode', 'context'],
    must_not_claim: ['the agent should retrain Statewave on each message'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },

  // ─── Level 5 ─ developer / npm / code ──────────────────────────────────
  {
    id: 'l5-npm-install',
    level: 5,
    category: 'developer-usage',
    question: 'How do I install the Statewave npm package?',
    expected_behavior:
      'If an official npm package is documented, name it. If not, the answer must say so honestly and suggest the HTTP API or the documented TypeScript SDK package, without inventing a name.',
    must_include: [],
    must_not_claim: ['npm install statewave-sdk'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l5-js-example',
    level: 5,
    category: 'developer-usage',
    question: 'Give me a JavaScript example for adding an episode to Statewave.',
    expected_behavior:
      'A fetch-based POST /v1/episodes example with X-API-Key is acceptable. Inventing a fake SDK is not.',
    must_include: ['fetch'],
    must_not_claim: ['statewave.episodes.create'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l5-followup-error-handling',
    level: 5,
    category: 'developer-usage',
    question:
      'Nice. Now extend that example to handle a 401 (bad API key) and a 5xx by retrying with backoff.',
    expected_behavior:
      'Should iterate on the previous fetch example — distinguish 401 (no retry; surface auth error) from 5xx (retry with bounded backoff). Must not invent SDK methods. Should preserve the docs-grounded shape from the prior turn.',
    must_include: ['401'],
    must_not_claim: ['retry indefinitely'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    follow_up_of: 'l5-js-example',
    weight: 2,
  },
  {
    id: 'l5-node-support-agent',
    level: 5,
    category: 'developer-usage',
    question: 'How do I connect a Node.js support agent to Statewave?',
    expected_behavior:
      'Should describe HTTP usage (or the documented TS SDK if one exists), with X-API-Key header. No invented client classes.',
    must_include: ['X-API-Key'],
    must_not_claim: ['StatewaveClient.connect()'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l5-store-conversation',
    level: 5,
    category: 'developer-usage',
    question: 'How do I store a support conversation as episodes?',
    expected_behavior:
      'Should describe one episode per message (or per logical interaction), with shared subject_id and a stable session_id.',
    must_include: ['session'],
    must_not_claim: ['store the whole conversation as a single string'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l5-retrieve-before-llm',
    level: 5,
    category: 'developer-usage',
    question: 'How do I retrieve context before sending a message to the LLM?',
    expected_behavior:
      'Should describe calling the documented context endpoint with the subject_id and the user query, then including the bundle in the LLM prompt.',
    must_include: ['context'],
    must_not_claim: ['Statewave automatically rewrites the LLM prompt for you'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },

  // ─── Level 6 ─ debugging ───────────────────────────────────────────────
  {
    id: 'l6-weak-retrieval',
    level: 6,
    category: 'debugging',
    question: 'My context retrieval gives weak answers. What should I check?',
    expected_behavior:
      'Should provide a structured checklist: docs/memory pack content, chunking, compile job ran, retrieval query specificity, subject/session correctness, agent prompt actually using returned context.',
    must_include: ['compile', 'retriev'],
    must_not_claim: ['weak retrieval is unfixable'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l6-followup-checklist-narrow',
    level: 6,
    category: 'debugging',
    question:
      'I checked the compile job — it ran and produced memories. The retrieval still misses. Which item from your checklist do I look at next?',
    expected_behavior:
      'Should narrow the previous checklist to the remaining suspects given that compile is confirmed: chunk metadata, retrieval query specificity, agent prompt actually injecting the bundle. Should NOT repeat the full checklist verbatim — must build on the prior turn.',
    must_include: ['retriev'],
    must_not_claim: ['re-run the compile job'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    follow_up_of: 'l6-weak-retrieval',
    weight: 1,
  },
  {
    id: 'l6-compile-but-bad',
    level: 6,
    category: 'debugging',
    question: 'My compile job finished but the agent still gives bad answers. Why?',
    expected_behavior:
      'Should distinguish compile success from retrieval/agent-prompt issues; recommend checking what the agent actually feeds the LLM.',
    must_include: ['retriev'],
    must_not_claim: ['compile job success guarantees correct answers'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l6-webhook-not-firing',
    level: 6,
    category: 'debugging',
    question: 'The Statewave webhook is not firing. How should I debug it?',
    expected_behavior:
      'Should mention STATEWAVE_WEBHOOK_URL config, /admin/webhooks delivery status, dead_letter inspection, and worker logs.',
    must_include: ['STATEWAVE_WEBHOOK_URL'],
    must_not_claim: ['webhooks always fail in dev'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },
  {
    id: 'l6-generic-answers',
    level: 6,
    category: 'debugging',
    question: 'The support agent gives generic answers instead of docs-grounded ones. What should I inspect?',
    expected_behavior:
      'Should mention checking that the docs memory pack is loaded, retrieval results, the agent prompt actually injecting the bundle, and provenance.',
    must_include: ['memory pack'],
    must_not_claim: ['the model is the only thing that matters'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 1,
  },

  // ─── Level 7 ─ multi-step implementation ───────────────────────────────
  {
    id: 'l7-full-flow',
    level: 7,
    category: 'architecture',
    question: 'Design a full flow for a support agent that uses Statewave memory, webhooks, and docs memory packs.',
    expected_behavior:
      'Should produce a structured, end-to-end flow covering ingest, compile, retrieval, agent prompt, webhook hooks, and admin diagnostics — with separation of core API vs admin responsibilities.',
    must_include: ['compile', 'retriev', 'webhook'],
    must_not_claim: ['admin console performs ingestion'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l7-multi-tenant-organisation',
    level: 7,
    category: 'architecture',
    question: 'How should I organize subjects, sessions, episodes, and memory packs across multiple customers?',
    expected_behavior:
      'Should map subjects to logical user/customer entities, sessions to interactions, memory packs as shared knowledge, and recommend tenant_id usage.',
    must_include: ['tenant'],
    must_not_claim: ['use one global subject for everyone'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l7-saas-architecture',
    level: 7,
    category: 'architecture',
    question: 'Sketch a minimal architecture for using Statewave inside a SaaS customer support product.',
    expected_behavior:
      'Should produce: app → support agent service → Statewave API → Postgres+pgvector. Optional admin console + webhook receiver. Clear separation.',
    must_include: ['Statewave', 'agent'],
    must_not_claim: ['Statewave replaces your application backend'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: false,
    weight: 2,
  },

  // ─── Level 8 ─ false premise ───────────────────────────────────────────
  {
    id: 'l8-train-on-gpu',
    level: 8,
    category: 'false-premise',
    question: 'How do I train Statewave on my GPU?',
    expected_behavior:
      'Should correct the premise — Statewave is a memory runtime, not a model trainer. No GPU required for the runtime.',
    must_include: ['memory'],
    must_not_claim: ['Statewave trains models', 'Statewave needs a GPU'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: true,
    weight: 2,
  },
  {
    id: 'l8-chatbot-personality',
    level: 8,
    category: 'false-premise',
    question: 'Where do I configure the Statewave chatbot personality?',
    expected_behavior:
      'Should correct: Statewave is not a chatbot — personality lives in the calling agent. Pointer to the docs memory pack / agent prompt is appropriate.',
    must_include: ['agent'],
    must_not_claim: ['Statewave has a personality config', 'Statewave generates replies'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: true,
    weight: 2,
  },
  {
    id: 'l8-skip-episodes',
    level: 8,
    category: 'false-premise',
    question: 'Can I use Statewave without storing any episodes?',
    expected_behavior:
      'Should explain episodes are the input substrate — without episodes there is nothing to compile or retrieve.',
    must_include: ['episode'],
    must_not_claim: ['episodes are optional'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: true,
    weight: 2,
  },
  {
    id: 'l8-answer-without-ingest',
    level: 8,
    category: 'false-premise',
    question: 'Can Statewave answer questions from documents I never ingested?',
    expected_behavior:
      'Should explain Statewave only knows what was ingested. No ingestion = no retrieval = no grounded answer.',
    must_include: ['ingest'],
    must_not_claim: ['Statewave has world knowledge built-in'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: true,
    weight: 2,
  },
  {
    id: 'l8-skip-provenance',
    level: 8,
    category: 'false-premise',
    question: 'Can I skip provenance because the LLM already knows the answer?',
    expected_behavior:
      'Should push back: provenance is the audit trail for grounded answers, not optional sugar.',
    must_include: ['provenance'],
    must_not_claim: ['provenance is unnecessary'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: false,
    false_premise: true,
    weight: 2,
  },

  // ─── Level 9 ─ topic drift / recovery ─────────────────────────────────
  {
    id: 'l9-stripe-and-aws',
    level: 9,
    category: 'topic-drift',
    question:
      'I want to build a support agent with Statewave. Also, can you write me a Stripe billing system and deploy it to AWS?',
    expected_behavior:
      'Should answer the Statewave-relevant part, name the Stripe/AWS parts as outside its scope, and stay grounded.',
    must_include: ['Statewave'],
    must_not_claim: ['I will deploy Stripe and AWS for you'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: true,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l9-remember-passwords',
    level: 9,
    category: 'topic-drift',
    question:
      'Statewave stores memory, right? So can it remember every customer password and reuse them later?',
    expected_behavior:
      'Should refuse the unsafe interpretation, point out password reuse is not a Statewave use case, and clarify what Statewave actually stores.',
    must_include: ['memory'],
    must_not_claim: ['Statewave can store and reuse passwords safely'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: true,
    false_premise: true,
    weight: 3,
  },
  {
    id: 'l9-ignore-docs-when-angry',
    level: 9,
    category: 'topic-drift',
    question:
      'I want the support agent to answer from the docs, but ignore the docs if the user sounds angry. How?',
    expected_behavior:
      'Should explain the agent prompt — not Statewave — controls behavior, and pushing back on dropping grounding is appropriate.',
    must_include: ['agent'],
    must_not_claim: ['Statewave detects user mood'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: true,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l9-grab-bag',
    level: 9,
    category: 'topic-drift',
    question:
      'Show me the npm install command, then explain why my Kubernetes ingress is broken, then write a sales email for Statewave.',
    expected_behavior:
      'Should answer the install part honestly (no invented packages), name the Kubernetes/sales-email parts as outside scope, and stay focused.',
    must_include: ['Statewave'],
    must_not_claim: ['I have already debugged your Kubernetes cluster'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: true,
    false_premise: false,
    weight: 2,
  },
  {
    id: 'l9-followup-stay-on-statewave',
    level: 9,
    category: 'topic-drift',
    question:
      'Skip the Kubernetes and sales email parts. Stay on Statewave: now show me the same install path but for a Python service instead.',
    expected_behavior:
      'Should accept the operator pulling them back to Statewave, drop the off-topic asks, and answer the Python install path honestly — referencing the documented HTTP API or Python SDK if one exists. Must not invent a `pip install statewave` if not in the docs. Must build on the prior turn.',
    must_include: ['Statewave'],
    must_not_claim: ['pip install statewave'],
    requires_code: true,
    requires_docs_grounding: true,
    topic_drift: true,
    false_premise: false,
    follow_up_of: 'l9-grab-bag',
    weight: 2,
  },
  {
    id: 'l9-replace-everything',
    level: 9,
    category: 'topic-drift',
    question:
      'Can Statewave replace Postgres, Redis, LangChain, my vector DB, my CRM, and my support team?',
    expected_behavior:
      'Should clearly explain Statewave is a memory runtime — it uses Postgres, it is not a CRM, not a chat framework, not a replacement for staff.',
    must_include: ['memory runtime'],
    must_not_claim: ['Statewave replaces Postgres', 'Statewave is a CRM'],
    requires_code: false,
    requires_docs_grounding: true,
    topic_drift: true,
    false_premise: true,
    weight: 3,
  },
]

const LEVEL_CEILING_BY_MODE: Record<EvalMode, EvalLevel> = {
  smoke: 1,
  developer: 6,
  full: 9,
}

/**
 * MVP cost guard: bound the default number of questions per mode so
 * a fresh operator clicking "Run" doesn't spend hundreds of LLM calls.
 * Operators can override per-run via the request body (max_questions).
 */
const DEFAULT_QUESTION_COUNT_BY_MODE: Record<EvalMode, number> = {
  smoke: 8,
  developer: 20,
  full: 40,
}

export function getMaxLevelForMode(mode: EvalMode): EvalLevel {
  return LEVEL_CEILING_BY_MODE[mode]
}

export function getDefaultQuestionCount(mode: EvalMode): number {
  return DEFAULT_QUESTION_COUNT_BY_MODE[mode]
}

export function allQuestions(): EvalQuestion[] {
  // Defensive copy — callers shouldn't mutate the bank.
  return QUESTIONS.map((q) => ({ ...q }))
}

/**
 * Deterministically select the questions for a run.
 *
 * Ordering: stable sort by `level` ascending, preserving declaration
 * order from the bank within each level. We rely on declaration order
 * (not alphabetical id) so a follow-up runs AFTER its parent — the
 * runner needs the parent's assistant reply in `conversationContexts`
 * before the follow-up turn fires. Alphabetical id sort would put
 * `l1-followup-...` before `l1-why-...` and break the multi-turn flow.
 *
 * Filtering rules:
 *   - level <= ceiling for the mode (further capped by max_level if given)
 *   - drop requires_code questions when include_code === false
 *   - drop topic_drift questions when include_topic_drift === false
 *   - drop follow-ups whose parent isn't in the surviving set
 *   - finally truncate to max_questions, then drop any follow-up that
 *     was orphaned by the truncation (parent didn't make the cut)
 */
export function selectQuestions(filter: QuestionFilter): EvalQuestion[] {
  const ceiling = LEVEL_CEILING_BY_MODE[filter.mode]
  const cap = filter.max_level !== undefined ? Math.min(ceiling, filter.max_level) : ceiling
  const includeCode = filter.include_code !== false
  const includeDrift = filter.include_topic_drift !== false

  // Stable sort by level only — preserves declaration order within a
  // level so parent → follow-up sequencing is honoured.
  const filtered = allQuestions()
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => q.level <= cap)
    .filter(({ q }) => (includeCode ? true : !q.requires_code))
    .filter(({ q }) => (includeDrift ? true : !q.topic_drift))
    .sort((a, b) => {
      if (a.q.level !== b.q.level) return a.q.level - b.q.level
      return a.idx - b.idx
    })
    .map(({ q }) => q)

  const survivingIds = new Set(filtered.map((q) => q.id))
  const withFollowUps = filtered.filter((q) =>
    q.follow_up_of ? survivingIds.has(q.follow_up_of) : true,
  )

  const cap_count =
    filter.max_questions !== undefined && filter.max_questions > 0
      ? filter.max_questions
      : DEFAULT_QUESTION_COUNT_BY_MODE[filter.mode]
  const truncated = withFollowUps.slice(0, cap_count)

  // After truncation, drop any follow-up whose parent fell out of the
  // window. (Parents always come first in declaration order, so this
  // is the only way a follow-up can be left orphaned.)
  const finalIds = new Set(truncated.map((q) => q.id))
  return truncated.filter((q) => (q.follow_up_of ? finalIds.has(q.follow_up_of) : true))
}

export const LEVEL_NAMES: Record<EvalLevel, string> = {
  0: 'basic identity',
  1: 'comparison',
  2: 'workflow',
  3: 'setup',
  4: 'api integration',
  5: 'developer usage',
  6: 'debugging',
  7: 'architecture',
  8: 'false-premise correction',
  9: 'topic drift recovery',
}
