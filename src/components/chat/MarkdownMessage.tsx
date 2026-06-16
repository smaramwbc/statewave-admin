/**
 * MarkdownMessage — safe Markdown rendering for the "Chat with Memory" panel.
 *
 * Security posture mirrors statewave-web/MarkdownMessage:
 *  - No rehype-raw, no dangerouslySetInnerHTML — model HTML can't escape.
 *  - Anchor hrefs flow through safeUrl (http/https/mailto/tel/fragment only).
 *  - Images are dropped; alt text is surfaced as plain text.
 *  - [S1]–[S9x] citation markers are rendered as inline accent chips.
 */

import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeUrl } from '@statewavedev/chat-react'
import React from 'react'

// ── Citation chips ────────────────────────────────────────────────────────────

const CITATION_RE = /(\[S\d+\])/g

function injectCitationChips(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== 'string') return child
    const parts = child.split(CITATION_RE)
    if (parts.length === 1) return child
    return parts.map((part, i) =>
      CITATION_RE.test(part) ? (
        <span
          key={i}
          className="inline-flex items-center px-1.5 py-px mx-0.5 rounded text-[10px] font-mono bg-accent/12 text-accent border border-accent/25 align-baseline leading-tight"
        >
          {part}
        </span>
      ) : part,
    )
  })
}

// ── Component overrides ───────────────────────────────────────────────────────

function isExternalHttp(url: string): boolean {
  return /^https?:/i.test(url)
}

const components: Components = {
  // Citation chips in paragraphs and list items
  p: ({ children }) => <p>{injectCitationChips(children)}</p>,
  li: ({ children }) => <li>{injectCitationChips(children)}</li>,

  a({ href, children, ...rest }) {
    const safe = typeof href === 'string' ? safeUrl(href) : null
    if (!safe) return <span {...rest}>{children}</span>
    const external = isExternalHttp(safe.href)
    return (
      <a
        {...rest}
        href={safe.href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    )
  },

  // code is called for both inline and block code.
  // Styling is done purely via CSS arbitrary-variant classes on the wrapper
  // (see PROSE_CLASSES below) so we don't need to branch here.
  code({ children, className, ...rest }) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  },

  // Drop images — model-emitted img srcs would trigger outbound fetches.
  img({ alt }) {
    return alt ? <span>{alt}</span> : null
  },
}

// ── Prose styling ─────────────────────────────────────────────────────────────

const PROSE_CLASSES = [
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_li>p]:my-0',
  '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:my-2',
  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:my-2',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1.5',
  '[&_strong]:font-semibold [&_strong]:text-theme-primary',
  '[&_em]:italic',
  '[&_del]:line-through [&_del]:opacity-70',
  '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words',
  'hover:[&_a]:opacity-80',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5',
  '[&_:not(pre)>code]:bg-[var(--theme-code-bg)] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em]',
  '[&_:not(pre)>code]:text-theme-primary',
  '[&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:p-3',
  '[&_pre]:bg-[var(--theme-code-bg)] [&_pre]:overflow-x-auto',
  '[&_pre]:text-[0.85em] [&_pre]:leading-snug',
  '[&_pre_code]:font-mono [&_pre_code]:text-theme-primary',
  '[&_blockquote]:my-2 [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-theme-border [&_blockquote]:text-theme-muted',
  '[&_table]:my-2 [&_table]:w-full [&_table]:text-left [&_table]:border-collapse [&_table]:block [&_table]:overflow-x-auto',
  '[&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_th]:border-b [&_th]:border-theme-border',
  '[&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-theme-border/60',
  '[&_hr]:my-3 [&_hr]:border-theme-border',
].join(' ')

// ── Public component ──────────────────────────────────────────────────────────

interface Props {
  content: string
  className?: string
}

export function MarkdownMessage({ content, className }: Props) {
  return (
    <div className={className ? `${PROSE_CLASSES} ${className}` : PROSE_CLASSES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => safeUrl(url)?.href ?? ''}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
