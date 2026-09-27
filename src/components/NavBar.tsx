import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from './Icons';

interface NavBarProps {
  title?: string;
  /** Route to fall back to when there is no history to pop. */
  backTo?: string;
  right?: ReactNode;
}

/**
 * The top row of a hero: back arrow, title, and whatever sits on the right.
 * It is always drawn on the gradient, so everything in it is white.
 */
export function NavBar({ title, backTo = '/home', right }: NavBarProps) {
  const navigate = useNavigate();
  return (
    <div className="hero__bar">
      <button
        className="hero__btn"
        type="button"
        aria-label="Back"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate(backTo, { replace: true });
        }}
      >
        <ChevronLeft />
      </button>
      {title ? <h1 className="hero__title">{title}</h1> : null}
      <span className="hero__spacer" />
      {right}
    </div>
  );
}
