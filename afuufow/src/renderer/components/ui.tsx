import { type ReactNode } from 'react';
import { useL } from '../i18n';
import { dismissNotice, useUi } from '../store';

export function Card({ title, children, right, className }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={className ? `card ${className}` : 'card'}>
      {(title || right) && (
        <div className="row" style={{ marginBottom: 10 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          <span className="spacer" />
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Toasts() {
  const notices = useUi((s) => s.notices);
  const L = useL();
  return (
    <div className="toasts" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`toast ${n.level}`} onClick={() => dismissNotice(n.id)}>
          {L(n.so, n.en)}
        </div>
      ))}
    </div>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export const fmtTime = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
