import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from './state';
import { renderMarkdown } from './markdown';

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span
      className={size === 'lg' ? 't-title' : ''}
      style={{ fontWeight: 800, letterSpacing: '-0.03em' }}
    >
      Shkills
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  if (!onClick) return <span className="chip chip-static">{children}</span>;
  return (
    <button type="button" className={`chip ${active ? 'chip-on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

const STATUS_TONE: Record<string, { label: string; color: string; background: string }> = {
  pending: { label: 'In review', color: 'var(--caution)', background: 'var(--caution-wash)' },
  approved: { label: 'Live', color: 'var(--positive)', background: 'transparent' },
  rejected: { label: 'Declined', color: 'var(--negative)', background: 'transparent' },
  superseded: { label: 'Replaced', color: 'var(--ink-faint)', background: 'transparent' },
  draft: { label: 'Draft', color: 'var(--ink-faint)', background: 'transparent' },
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.draft;
  return (
    <span
      className="chip chip-static"
      style={{ color: tone.color, background: tone.background, fontWeight: 700 }}
    >
      {tone.label}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="py-24 text-center">
      <div className="t-meta pulse-soft">{label}…</div>
    </div>
  );
}

export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-24 text-center rise">
      <p className="t-subtitle">{title}</p>
      {detail && <p className="t-meta mt-2 mx-auto" style={{ maxWidth: '34ch' }}>{detail}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="t-meta" style={{ color: 'var(--negative)' }} role="alert">
      {message}
    </p>
  );
}

/** A labelled control. The label is always visible — placeholders are not labels. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-eyebrow block mb-2">{label}</span>
      {children}
      {hint && <span className="t-meta block mt-1.5">{hint}</span>}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgb(0 0 0 / 0.32)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card rise w-full max-w-lg p-8"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="t-title mb-5">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 space-y-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className="card rise block px-5 py-3 text-left"
          style={{
            color:
              toast.tone === 'negative'
                ? 'var(--negative)'
                : toast.tone === 'positive'
                  ? 'var(--positive)'
                  : 'var(--ink)',
            fontSize: '0.9375rem',
            fontWeight: 600,
          }}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * A deliberately small Markdown renderer. Skill bodies are written by
 * colleagues, not attackers, but they still go through escaping first — and a
 * hand-rolled subset keeps a parser dependency out of the bundle.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
