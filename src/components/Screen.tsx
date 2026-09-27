import type { ReactNode } from 'react';

/**
 * Which hue the screen belongs to. Blue is the app at large; purple is the
 * Voice Lock flow. The whole design hangs off this: `theme.css` reads
 * `[data-flow]` to set the --f-* tokens that every card edge, button, icon and
 * hero gradient below it inherits.
 */
export type Flow = 'blue' | 'purple';

interface ScreenProps {
  children: ReactNode;
  /** Bottom-pinned action area; adds matching body padding. */
  dock?: ReactNode;
  /**
   * Hero content: the gradient block at the top of the screen. The body rides
   * up over its rounded bottom edge, so anything passed here is drawn on the
   * gradient in white.
   */
  hero?: ReactNode;
  flow?: Flow;
}

export function Screen({ children, dock, hero, flow = 'blue' }: ScreenProps) {
  return (
    <div
      className={`screen screen--enter${hero ? ' screen--hero' : ''}`}
      data-flow={flow}
    >
      {hero ? <div className="hero">{hero}</div> : null}
      <div className={`screen__body${dock ? ' screen__body--docked' : ''}`}>
        {children}
      </div>
      {dock ? <div className="screen__dock">{dock}</div> : null}
    </div>
  );
}
