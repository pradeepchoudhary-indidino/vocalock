import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from './Icons';

interface NavBarProps {
  title?: string;
  /** Route to fall back to when there is no history to pop. */
  backTo?: string;
  right?: ReactNode;
}

export function NavBar({ title, backTo = '/home', right }: NavBarProps) {
  const navigate = useNavigate();
  return (
    <div className="navbar">
      <button
        className="navbar__back"
        type="button"
        aria-label="Back"
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate(backTo, { replace: true });
        }}
      >
        <ChevronLeft />
      </button>
      {title ? <span className="navbar__title">{title}</span> : null}
      <span className="navbar__spacer" />
      {right}
    </div>
  );
}
