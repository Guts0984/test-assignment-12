'use client';

import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700';

export const Button = ({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) => {
  const styles = {
    primary: 'bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-300',
    secondary: 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-rose-700 text-white hover:bg-rose-800 disabled:bg-slate-300',
    ghost: 'text-sky-800 hover:bg-sky-50 disabled:text-slate-400',
  }[variant];
  return <button type="button" {...p} className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition ${focus} ${styles} ${className}`} />;
};

type FieldProps = { label: string; error?: string | undefined; hint?: string };

/** Label + control + error wired for assistive tech: aria-invalid, aria-describedby, role=alert. */
export const TextField = ({ label, error, hint, className = '', ...input }: FieldProps & InputHTMLAttributes<HTMLInputElement>) => {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">{label}</label>
      <input id={id} {...input} aria-invalid={error ? true : undefined} aria-describedby={[error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined}
        className={`rounded-md border px-3 py-2 text-sm ${error ? 'border-rose-600' : 'border-slate-300'} ${focus}`} />
      {hint && <p id={hintId} className="text-xs text-slate-600">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-xs font-medium text-rose-700">{error}</p>}
    </div>
  );
};

export const SelectField = ({ label, error, children, className = '', ...sel }: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) => {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">{label}</label>
      <select id={id} {...sel} aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
        className={`rounded-md border bg-white px-3 py-2 text-sm ${error ? 'border-rose-600' : 'border-slate-300'} ${focus}`}>
        {children}
      </select>
      {error && <p id={errId} role="alert" className="text-xs font-medium text-rose-700">{error}</p>}
    </div>
  );
};

export const Card = ({ children, className = '', as: Tag = 'section', ...p }: { children: ReactNode; className?: string; as?: 'section' | 'article' | 'div' } & React.HTMLAttributes<HTMLElement>) => (
  <Tag {...p} className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</Tag>
);

export const Badge = ({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'amber' | 'rose' | 'sky'; children: ReactNode }) => {
  const c = { slate: 'bg-slate-100 text-slate-800', green: 'bg-emerald-100 text-emerald-900', amber: 'bg-amber-100 text-amber-900', rose: 'bg-rose-100 text-rose-900', sky: 'bg-sky-100 text-sky-900' }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
};

export const Spinner = () => <span role="status" aria-live="polite" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-700"><span className="sr-only">…</span></span>;

/** A translated, human message for an API error code; announced to screen readers. */
export const ErrorNote = ({ code }: { code: string | null | undefined }) => {
  const t = useTranslations('errors');
  if (!code) return null;
  const known = ['SLOT_TAKEN', 'ROOM_TAKEN', 'PATIENT_BUSY', 'FUTURE_LIMIT_REACHED', 'DOCTOR_DAILY_LIMIT', 'OUTSIDE_BOOKING_WINDOW', 'OUTSIDE_WORKING_HOURS', 'HOLD_EXPIRED', 'OFFER_EXPIRED', 'ONLINE_BOOKING_BLOCKED', 'INVALID_TRANSITION', 'IDEMPOTENCY_KEY_REUSED', 'EMAIL_TAKEN', 'INVALID_CREDENTIALS', 'WAITLIST_LIMIT_REACHED', 'SERVICE_NOT_PROVIDED', 'VERSION_CONFLICT', 'SCHEDULE_CONFLICT', 'RATE_LIMITED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'BAD_USER_INPUT', 'QUERY_TOO_COMPLEX', 'INTERNAL_SERVER_ERROR', 'network'];
  const key = known.includes(code) ? code : 'INTERNAL_SERVER_ERROR';
  return <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900" data-error-code={code}>{t(key)}</p>;
};

export const PageTitle = ({ children }: { children: ReactNode }) => <h1 className="mb-4 text-2xl font-semibold text-slate-900">{children}</h1>;
