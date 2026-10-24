import type { ReactNode } from 'react';
import { GearIcon } from './Icons';

type Feature = 'clap' | 'lock';

interface FeatureTileProps {
  feature: Feature;
  icon: ReactNode;
  title: string;
  sub: string;
  /** What the action button says, e.g. "Listening", "Armed", "Turn on". */
  action: string;
  on: boolean;
  onAction: () => void;
  /** Opens this feature's settings. */
  onOpen: () => void;
  settingsLabel: string;
}

/**
 * One feature, as a tile. The tile IS the status display: its fill, its bottom
 * edge, its disc and its action button all change together, so there is no
 * separate "on" label to keep in sync.
 *
 * The action button carries a live indicator — bars for Clap (it is listening
 * for sound) and a pulse for Voice Lock (it is armed and waiting).
 */
export function FeatureTile({
  feature,
  icon,
  title,
  sub,
  action,
  on,
  onAction,
  onOpen,
  settingsLabel,
}: FeatureTileProps) {
  return (
    // The whole card opens the feature's settings; the gear stays as the
    // labelled, focusable way in. The action button below does its own thing.
    <div
      className={`tile tile--${feature}${on ? ' tile--on' : ''}`}
      data-track={`Open ${title}`}
      onClick={onOpen}
    >
      <button
        className="tile__gear"
        type="button"
        aria-label={settingsLabel}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <span>
          <GearIcon />
        </span>
      </button>

      <span className="tile__disc">{icon}</span>

      <span>
        <span className="tile__name" style={{ display: 'block' }}>
          {title}
        </span>
        <span className="tile__sub" style={{ display: 'block' }}>
          {sub}
        </span>
      </span>

      <button
        className="tile__action"
        type="button"
        aria-label={title}
        aria-pressed={on}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
      >
        {on && feature === 'clap' ? (
          <span className="bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
        {on && feature === 'lock' ? <span className="tile__pulse" aria-hidden="true" /> : null}
        {action}
      </button>
    </div>
  );
}
