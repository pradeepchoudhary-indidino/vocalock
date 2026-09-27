import { useEffect, useRef, useState } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Card, Note } from '../components/Controls';
import { Listener } from '../plugins';
import { track } from '../lib/analytics';

const BARS = 48;
const PEAK = 0.7;

/** Screen 11. */
export function Calibrate() {
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const [claps, setClaps] = useState(0);
  const [heard, setHeard] = useState(false);
  const heardTimer = useRef<number | null>(null);

  useEffect(() => {
    track('calibrate_open');
    const handles: PluginListenerHandle[] = [];
    let live = true;

    void (async () => {
      const levelHandle = await Listener.addListener('calibrationLevel', ({ level }) => {
        setLevels((prev) => [...prev.slice(1), Math.min(1, Math.max(0, level))]);
      });
      const clapHandle = await Listener.addListener('clapDetected', () => {
        setClaps((n) => n + 1);
        setHeard(true);
        if (heardTimer.current !== null) window.clearTimeout(heardTimer.current);
        heardTimer.current = window.setTimeout(() => setHeard(false), 900);
      });
      if (!live) {
        void levelHandle.remove();
        void clapHandle.remove();
        return;
      }
      handles.push(levelHandle, clapHandle);
      await Listener.startCalibration();
    })();

    return () => {
      live = false;
      if (heardTimer.current !== null) window.clearTimeout(heardTimer.current);
      void Listener.stopCalibration();
      handles.forEach((h) => void h.remove());
    };
  }, []);

  return (
    <Screen
      hero={<NavBar title="Calibrate" />}
      dock={
        <button className="btn btn--mint" type="button" onClick={() => void Listener.testAlert()}>
          Test alert
        </button>
      }
    >
      <Card>
        <div className="meter-head">
          <div>
            <div className="row__label">Microphone level</div>
            <div className="row__sub">Clap and watch for the spike</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="meter-head__count">{claps}</div>
            <div className="row__sub">claps</div>
          </div>
        </div>
        <div className="meter" aria-hidden="true">
          {levels.map((level, i) => (
            <div
              key={i}
              className={`meter__bar${level >= PEAK ? ' meter__bar--peak' : ''}`}
              style={{ height: `${Math.max(2, level * 100)}%` }}
            />
          ))}
        </div>
        <div className={`heard${heard ? ' heard--show' : ''}`}>Heard a clap</div>
      </Card>

      <Note>
        If your claps do not register, raise the sensitivity a step. If it fires on its own,
        lower it or ask for more claps in a row.
      </Note>
    </Screen>
  );
}
