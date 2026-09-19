import type { ReactNode } from 'react';
import { Toggle } from './Controls';

export type Tint = 'mint' | 'lilac' | 'peach';

interface FeatureCardProps {
  tint: Tint;
  icon: ReactNode;
  title: string;
  sub: string;
  /** Short status word shown in the pill, e.g. "Listening" or "Off". */
  state: string;
  live?: boolean;
  checked?: boolean;
  onToggle?: (next: boolean) => void;
  onOpen: () => void;
  action?: ReactNode;
}

/**
 * The Home screen's main unit: one tinted card per feature. Each feature keeps
 * its own colour everywhere else in the app, so a row icon or a button reads as
 * "that's the Clap one" without a label.
 */
export function FeatureCard({
  tint,
  icon,
  title,
  sub,
  state,
  live = false,
  checked,
  onToggle,
  onOpen,
  action,
}: FeatureCardProps) {
  return (
    <div className={`feature feature--${tint}`}>
      <button
        type="button"
        className="feature__head"
        style={{ width: '100%', textAlign: 'left', color: 'inherit' }}
        onClick={onOpen}
      >
        <span className={`feature__icon${live ? ' feature__icon--live' : ''}`}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="feature__title" style={{ display: 'block' }}>
            {title}
          </span>
          <span className="feature__sub" style={{ display: 'block' }}>
            {sub}
          </span>
        </span>
      </button>

      <div className="feature__foot">
        <span className="feature__state">{state}</span>
        <span className="feature__spacer" />
        {action}
        {onToggle ? (
          <Toggle
            label={title}
            checked={checked ?? false}
            onChange={onToggle}
            tint={tint === 'lilac' ? 'lilac' : 'mint'}
          />
        ) : null}
      </div>
    </div>
  );
}
