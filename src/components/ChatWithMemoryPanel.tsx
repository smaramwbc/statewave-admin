import { useEffect, useCallback } from 'react'
import { MessageThread, ChatComposer, TypingIndicator } from '@statewavedev/chat-react'
import { Modal } from './ui'
import { useAdminChat } from '../lib/useAdminChat'
import { MarkdownMessage } from './chat/MarkdownMessage'
import { RotateCcw } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  subjects: string[]
}

export function ChatWithMemoryPanel({ open, onClose, subjects }: Props) {
  const { messages, isLoading, sendMessage, reset } = useAdminChat(subjects)

  useEffect(() => {
    if (open) reset()
    // reset is stable (useCallback [] deps) — no loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const renderContent = useCallback(
    (content: string) => <MarkdownMessage content={content} className="text-sm leading-relaxed" />,
    [],
  )

  const renderTypingIndicator = useCallback(
    () => <TypingIndicator className="text-theme-muted py-1" label="Thinking…" />,
    [],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chat with Memory"
      size="xl"
      description={`${subjects.length} subject${subjects.length === 1 ? '' : 's'} selected`}
    >
      <div className="flex flex-col h-[58vh]">
        {/* Selected subjects strip */}
        <div className="flex flex-wrap gap-1.5 items-center pb-3 border-b border-theme-border shrink-0">
          {subjects.map((s) => (
            <span
              key={s}
              className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-[var(--theme-surface-2)] text-theme-secondary border border-theme-border truncate max-w-[24ch]"
              title={s}
            >
              {s}
            </span>
          ))}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="ml-auto flex items-center gap-1 text-[11px] text-theme-muted hover:text-theme-primary transition-colors shrink-0"
              title="Clear conversation"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {/* Chat area */}
        {messages.length === 0 && !isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-theme-muted text-center px-4 leading-relaxed">
              Ask anything about the memory in the selected subjects.
              <br />
              <span className="text-xs opacity-70">Answers are grounded in retrieved context.</span>
            </p>
          </div>
        ) : (
          <MessageThread
            messages={messages}
            isLoading={isLoading}
            renderContent={renderContent}
            renderTypingIndicator={renderTypingIndicator}
            className="flex-1 min-h-0 overflow-y-auto py-3 space-y-3 pr-1"
            userMessageClassName="ml-auto max-w-[78%] px-3.5 py-2.5 rounded-2xl rounded-tr-sm bg-accent/15 border border-accent/20 text-theme-primary text-sm"
            assistantMessageClassName="mr-auto max-w-[88%] px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-[var(--theme-surface-2)] border border-theme-border text-theme-primary text-sm"
          />
        )}

        {/* Composer */}
        <div className="pt-3 border-t border-theme-border shrink-0">
          <ChatComposer
            onSend={sendMessage}
            isLoading={isLoading}
            placeholder="Ask about memory in the selected subjects…"
            className="flex items-end gap-2"
            inputClassName="flex-1 resize-none px-3 py-2 text-sm rounded-xl border border-theme-border bg-[var(--theme-surface-1)] text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent/50 transition-colors"
            buttonClassName="px-4 py-2 text-sm font-medium rounded-xl bg-accent text-white hover:bg-accent/90 active:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          />
        </div>
      </div>
    </Modal>
  )
}
