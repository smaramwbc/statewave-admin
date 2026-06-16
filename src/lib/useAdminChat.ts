/**
 * useAdminChat — chat hook for the "Chat with Memory" panel.
 *
 * Manages message state and calls POST /api/admin-chat on each turn.
 * Exposes timing stats and context items from the server response.
 */

import { useState, useCallback, useRef } from 'react'
import type { ChatMessage } from '@statewavedev/chat-core'

export interface AdminChatContextItem {
  id: string
  text: string
  subject: string
  kind: string
  score?: number
  token_count?: number
}

export interface AdminChatStats {
  retrieval_ms: number
  llm_ms: number
  total_ms: number
  client_ms: number
  context_tokens_est: number
  llm_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  model: string
  subject_counts: Record<string, number>
}

export interface AdminChatState {
  messages: ChatMessage[]
  isLoading: boolean
  contextItems: AdminChatContextItem[]
  stats: AdminChatStats | null
  error: string | null
}

export interface UseAdminChatReturn extends AdminChatState {
  sendMessage: (text: string) => void
  reset: () => void
}

let _seq = 0
function nextId(prefix: string): string {
  return `${prefix}_${++_seq}_${Math.random().toString(36).slice(2, 7)}`
}

function makeUserMessage(content: string): ChatMessage {
  return {
    id: nextId('u'),
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    status: 'complete',
  }
}

function makeAssistantMessage(content: string, error?: boolean): ChatMessage {
  return {
    id: nextId('a'),
    role: 'assistant',
    content,
    createdAt: new Date().toISOString(),
    status: error ? 'error' : 'complete',
    error: error ? { code: 'unknown', message: content } : undefined,
  }
}

function toCoreMessage(m: ChatMessage): { role: string; content: string } {
  return { role: m.role, content: m.content }
}

export function useAdminChat(subjects: string[]): UseAdminChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [contextItems, setContextItems] = useState<AdminChatContextItem[]>([])
  const [stats, setStats] = useState<AdminChatStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isLoading) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const userMsg = makeUserMessage(trimmed)
      setMessages((prev) => [...prev, userMsg])
      setIsLoading(true)
      setError(null)

      const historyWithNew = [...messages, userMsg]
      const clientStart = Date.now()

      fetch('/api/admin-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          subjects,
          messages: historyWithNew.map(toCoreMessage),
        }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const client_ms = Date.now() - clientStart
          const data = (await res.json()) as {
            reply?: string
            error?: string
            context_items?: AdminChatContextItem[]
            stats?: AdminChatStats
          }
          if (!res.ok || data.error) {
            const msg = data.error === 'llm_not_configured'
              ? 'LLM not configured. Set ADMIN_EVAL_LLM_PROVIDER, ADMIN_EVAL_LLM_MODEL, and ADMIN_EVAL_LLM_API_KEY.'
              : data.error === 'statewave_not_configured'
                ? 'Statewave API not configured. Set STATEWAVE_API_URL.'
                : (data.error ?? `HTTP ${res.status}`)
            setMessages((prev) => [...prev, makeAssistantMessage(msg, true)])
            setError(msg)
          } else {
            setMessages((prev) => [...prev, makeAssistantMessage(data.reply ?? '')])
            setContextItems(data.context_items ?? [])
            if (data.stats) setStats({ ...data.stats, client_ms })
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return
          const msg = err instanceof Error ? err.message : 'Network error'
          setMessages((prev) => [...prev, makeAssistantMessage(msg, true)])
          setError(msg)
        })
        .finally(() => {
          setIsLoading(false)
        })
    },
    [subjects, messages, isLoading],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setContextItems([])
    setStats(null)
    setError(null)
    setIsLoading(false)
  }, [])

  return { messages, isLoading, contextItems, stats, error, sendMessage, reset }
}
