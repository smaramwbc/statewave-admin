import { useEffect, useRef, useState, useCallback } from 'react'
import { Modal } from './ui'
import { useAdminChat, type AdminChatContextItem } from '../lib/useAdminChat'
import { MarkdownMessage } from './chat/MarkdownMessage'
import { toast } from 'sonner'
import type { ChatMessage } from '@statewavedev/chat-core'
import {
  RotateCcw, Send, Loader2, Copy, Check,
  ChevronDown, Database, AlertCircle,
} from 'lucide-react'

// ── Context item kind badge ───────────────────────────────────────────────────

function KindBadge({ kind }: { kind: string }) {
  const cls =
    kind === 'fact'
      ? 'bg-emerald-500/12 text-emerald-400 border-emerald-500/20'
      : kind === 'procedure'
        ? 'bg-blue-500/12 text-blue-400 border-blue-500/20'
        : 'bg-amber-500/12 text-amber-500 border-amber-500/20'
  return (
    <span className={`px-1.5 py-px rounded text-[9px] font-medium uppercase tracking-wide border ${cls}`}>
      {kind}
    </span>
  )
}

// ── Expandable context item ───────────────────────────────────────────────────

function ContextItemCard({ item }: { item: AdminChatContextItem }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-[var(--theme-surface-2)] transition-colors"
      >
        <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-mono bg-accent/12 text-accent border border-accent/20 shrink-0 mt-0.5">
          {item.id}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-mono text-theme-muted truncate flex-1 min-w-0">
              {item.subject}
            </span>
            <KindBadge kind={item.kind} />
          </div>
          <p className={`text-xs text-theme-secondary leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            {item.text}
          </p>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-theme-muted shrink-0 mt-0.5 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div className="border-t border-theme-border bg-[var(--theme-surface-0)] px-3 py-2.5">
          <pre className="text-xs text-theme-secondary whitespace-pre-wrap break-words font-mono leading-relaxed">
            {item.text}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Message bubbles ───────────────────────────────────────────────────────────

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-accent/15 border border-accent/20 text-theme-primary text-sm leading-relaxed">
        {message.content}
      </div>
    </div>
  )
}

function AssistantBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false)
  const isError = message.status === 'error'

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Copied to clipboard')
    }).catch(() => toast.error('Copy failed'))
  }

  return (
    <div className="flex justify-start">
      <div className="group relative max-w-[88%]">
        <div
          className={`px-3.5 py-2.5 rounded-2xl rounded-tl-sm border text-sm leading-relaxed ${
            isError
              ? 'bg-red-500/8 border-red-500/20 text-red-400'
              : 'bg-[var(--theme-surface-2)] border-theme-border text-theme-primary'
          }`}
        >
          {isError ? (
            <span className="flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              {message.content}
            </span>
          ) : (
            <MarkdownMessage content={message.content} className="text-sm leading-relaxed" />
          )}
        </div>

        {/* Copy button — visible on hover */}
        {!isError && (
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy response'}
            className="absolute -bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--theme-surface-1)] border border-theme-border text-theme-muted hover:text-theme-primary hover:bg-[var(--theme-surface-2)] text-[10px]"
          >
            {copied
              ? <><Check className="h-3 w-3 text-emerald-400" />Copied</>
              : <><Copy className="h-3 w-3" />Copy</>}
          </button>
        )}
      </div>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-[var(--theme-surface-2)] border border-theme-border">
        <div className="flex gap-1 items-center">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 rounded-full bg-theme-muted animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────────

function ChatInput({
  onSend,
  isLoading,
}: {
  onSend: (text: string) => void
  isLoading: boolean
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resizeTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isLoading) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2 bg-[var(--theme-surface-1)] rounded-xl border border-theme-border focus-within:border-accent/50 transition-colors px-3 py-2.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); resizeTextarea() }}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="Ask about memory in the selected subjects…"
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-theme-primary placeholder:text-theme-muted outline-none ring-0 disabled:opacity-50 leading-relaxed"
          style={{ minHeight: '24px', maxHeight: '120px' }}
          aria-label="Chat message input"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading || !value.trim()}
          title="Send (Enter)"
          className="shrink-0 p-2 rounded-lg bg-accent text-white hover:bg-accent/90 active:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Send className="h-4 w-4" aria-hidden="true" />}
          <span className="sr-only">{isLoading ? 'Sending…' : 'Send'}</span>
        </button>
      </div>
      <p className="text-[10px] text-theme-muted/70 pl-1">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  subjects: string[]
}

export function ChatWithMemoryPanel({ open, onClose, subjects }: Props) {
  const { messages, isLoading, contextItems, sendMessage, reset } = useAdminChat(subjects)
  const [showContext, setShowContext] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Reset state when panel opens
  useEffect(() => {
    if (open) {
      reset()
      setShowContext(false)
    }
    // reset is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading])

  const handleSend = useCallback(
    (text: string) => { sendMessage(text) },
    [sendMessage],
  )

  const hasContent = messages.length > 0 || isLoading

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chat with Memory"
      size="xl"
      description={`${subjects.length} subject${subjects.length === 1 ? '' : 's'} selected`}
    >
      {/* Toolbar row */}
      <div className="flex items-center gap-2 pb-3 border-b border-theme-border shrink-0">
        <div className="flex flex-wrap gap-1.5 items-center flex-1 min-w-0 overflow-hidden">
          {subjects.map((s) => (
            <span
              key={s}
              className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-[var(--theme-surface-2)] text-theme-secondary border border-theme-border truncate max-w-[20ch]"
              title={s}
            >
              {s}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Context inspector toggle */}
          {contextItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowContext((c) => !c)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showContext
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : 'text-theme-muted border-theme-border hover:text-theme-primary hover:border-[var(--theme-border-hover)]'
              }`}
            >
              <Database className="h-3 w-3" aria-hidden="true" />
              Context
              <span className="px-1.5 py-px rounded-full bg-[var(--theme-surface-3)] font-mono text-[10px]">
                {contextItems.length}
              </span>
            </button>
          )}
          {/* Clear conversation */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-theme-muted border border-theme-border hover:text-theme-primary hover:border-[var(--theme-border-hover)] transition-colors"
              title="Clear conversation"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Two-pane body */}
      <div className="flex h-[58vh] mt-0 gap-0 overflow-hidden">
        {/* ── Chat pane ── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Message list */}
          <div className={`flex-1 min-h-0 py-4 px-1 space-y-4 ${hasContent ? 'overflow-y-auto' : 'overflow-hidden'}`}>
            {!hasContent && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                <div className="w-10 h-10 rounded-xl bg-[var(--theme-surface-2)] border border-theme-border flex items-center justify-center">
                  <Database className="h-5 w-5 text-theme-muted" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium text-theme-secondary">Inspect your memory</p>
                  <p className="text-xs text-theme-muted mt-1 leading-relaxed max-w-xs">
                    Ask anything about the memory stored in the selected subjects. Answers are grounded in retrieved context — citation markers like [S1] reference specific memory items.
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg) =>
              msg.role === 'user'
                ? <UserBubble key={msg.id} message={msg} />
                : <AssistantBubble key={msg.id} message={msg} />
            )}
            {isLoading && <ThinkingBubble />}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="shrink-0 pt-3 border-t border-theme-border">
            <ChatInput onSend={handleSend} isLoading={isLoading} />
          </div>
        </div>

        {/* ── Context pane ── */}
        {showContext && contextItems.length > 0 && (
          <div className="w-72 shrink-0 ml-4 pl-4 border-l border-theme-border flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <span className="text-xs font-semibold text-theme-secondary tracking-wide">
                Retrieved Context
              </span>
              <span className="text-[10px] font-mono text-theme-muted">
                {contextItems.length} item{contextItems.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
              {contextItems.map((item) => (
                <ContextItemCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
