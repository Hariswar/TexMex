import { CircleAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="animate-fade absolute inset-0 bg-scrim" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl sm:rounded-[28px]">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 pt-2 pb-2">
          <div className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" aria-hidden />
          <h2 id={titleId} className="flex-1 pt-3 text-lg font-bold">
            {title}
          </h2>
          <button className="icon-btn -mr-2 mt-1" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const TONES = {
  primary: 'bg-primary-soft text-primary-ink',
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-2 text-muted',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]}`}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

export function IconBubble({ icon: Icon, tone = 'primary', size = 'md' }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-14 rounded-2xl' : size === 'sm' ? 'size-8 rounded-full' : 'size-10 rounded-full';
  const glyph = size === 'lg' ? 'size-7' : size === 'sm' ? 'size-4' : 'size-5';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${box} ${TONES[tone]}`} aria-hidden>
      <Icon className={glyph} />
    </span>
  );
}

const AVATAR_TONES = [
  'bg-[#e2f3f0] text-[#0a5650] dark:bg-[#0e2d29] dark:text-[#5eead4]',
  'bg-[#e7eefd] text-[#1e40af] dark:bg-[#142040] dark:text-[#a5c0ff]',
  'bg-[#fcefe3] text-[#9a3412] dark:bg-[#33200f] dark:text-[#fdba74]',
  'bg-[#f3e8fd] text-[#6b21a8] dark:bg-[#2a1640] dark:text-[#d8b4fe]',
  'bg-[#fde8ef] text-[#9d174d] dark:bg-[#3a1424] dark:text-[#f9a8d4]',
  'bg-[#eaf5dc] text-[#3f6212] dark:bg-[#1d2a0f] dark:text-[#bef264]',
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  const box = size === 'lg' ? 'size-12 text-base' : size === 'sm' ? 'size-8 text-xs' : 'size-11 text-sm';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${box} ${tone}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="group inline-flex h-11 w-14 shrink-0 items-center justify-center"
    >
      <span className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${checked ? 'bg-primary' : 'bg-line'}`}>
        <span
          className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}

export function EmptyState({ icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <IconBubble icon={icon} size="lg" />
      <p className="text-base font-bold">{title}</p>
      {children && <div className="max-w-xs text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading">
      <div className="size-7 animate-spin rounded-full border-[3px] border-line border-t-primary" />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 ${
              active ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-fg hover:bg-surface-2'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
