import type { ReactNode } from 'react';

interface ScreenProps {
  children: ReactNode;
  /** Bottom-pinned action area; adds matching body padding. */
  dock?: ReactNode;
  nav?: ReactNode;
}

export function Screen({ children, dock, nav }: ScreenProps) {
  return (
    <div className="screen screen--enter">
      {nav}
      <div className={`screen__body${dock ? ' screen__body--docked' : ''}`}>{children}</div>
      {dock ? <div className="screen__dock">{dock}</div> : null}
    </div>
  );
}
