import type { ReactNode } from 'react';
import { ChevronRight, InfoIcon, WarnIcon } from './Icons';

export function Card({
  children,
  flush = false,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  return <div className={`card${flush ? ' card--flush' : ''}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  tint = 'mint',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  tint?: 'mint' | 'lilac';
}) {
  return (
    <button
      type="button"
      role="switch"
      className={`toggle${tint === 'lilac' ? ' toggle--lilac' : ''}`}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function ToggleRow({
  label,
  sub,
  checked,
  onChange,
  disabled = false,
  tint = 'mint',
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  tint?: 'mint' | 'lilac';
}) {
  return (
    <div className="row">
      <div className="row__main">
        <div className="row__label">{label}</div>
        {sub ? <div className="row__sub">{sub}</div> : null}
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label={label}
        tint={tint}
      />
    </div>
  );
}

export function LinkRow({
  label,
  sub,
  icon,
  tint,
  onClick,
  right,
}: {
  label: string;
  sub?: string;
  icon?: ReactNode;
  tint?: 'mint' | 'lilac' | 'peach' | 'sky';
  onClick: () => void;
  right?: ReactNode;
}) {
  return (
    <button className="row" type="button" onClick={onClick}>
      {icon ? <span className={`row__icon row__icon--${tint ?? 'sky'}`}>{icon}</span> : null}
      <div className="row__main">
        <div className="row__label">{label}</div>
        {sub ? <div className="row__sub">{sub}</div> : null}
      </div>
      {right}
      <span className="row__chevron">
        <ChevronRight />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="segmented__opt"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function StepperRow({
  label,
  sub,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  sub?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="row">
      <div className="row__main">
        <div className="row__label">{label}</div>
        {sub ? <div className="row__sub">{sub}</div> : null}
      </div>
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          &minus;
        </button>
        <span className="stepper__value">{format ? format(value) : value}</span>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone: 'on' | 'off' | 'warn';
  children: ReactNode;
}) {
  return (
    <span className={`chip chip--${tone}`}>
      <span className="chip__dot" />
      {children}
    </span>
  );
}

export function Note({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warn';
}) {
  return (
    <div className={`note${tone === 'warn' ? ' note--warn' : ''}`}>
      <span className="note__icon">{tone === 'warn' ? <WarnIcon /> : <InfoIcon />}</span>
      <span>{children}</span>
    </div>
  );
}


export function Sheet({
  title,
  children,
  onDismiss,
}: {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="sheet">{children}</div>
    </div>
  );
}


export function StepPips({ total, done }: { total: number; done: number }) {
  return (
    <div className="steps">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`steps__pip${i < done ? ' steps__pip--done' : ''}`} />
      ))}
    </div>
  );
}
