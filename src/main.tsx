import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { initCrashReporting, reportError } from './lib/crashlytics';
import { initAnalytics, track } from './lib/analytics';
import './theme.css';

// No pinch zoom, no long-press context menus.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

void initCrashReporting();
initAnalytics();

createRoot(document.getElementById('root')!, {
  // A render error that no boundary caught: React unmounts the tree, so this
  // is the white screen a user would see. Report it.
  onUncaughtError: (error) => {
    console.error(error);
    reportError(error);
    track('js_error', {
      message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      source: 'render',
    });
  },
}).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
