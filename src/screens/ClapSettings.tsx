import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import {
  Card,
  Chip,
  LinkRow,
  Note,
  SectionLabel,
  Segmented,
  StepperRow,
  ToggleRow,
} from '../components/Controls';
import { ShieldIcon } from '../components/Icons';
import { Listener, type Sensitivity } from '../plugins';
import { missingPermissionCount, useSettings } from '../store/settings';

const RINGTONES = [
  { value: 'default', label: 'Default alarm' },
  { value: 'siren', label: 'Siren' },
  { value: 'chime', label: 'Chime' },
  { value: 'beep', label: 'Beep' },
];

/** Screen 9. */
export function ClapSettings() {
  const navigate = useNavigate();
  const { settings, permissions, serviceRunning, loaded } = useSettings();
  const { hydrate, patch, refreshPermissions } = useSettings();

  useEffect(() => {
    if (!loaded) void hydrate();
    else void refreshPermissions();
  }, [loaded, hydrate, refreshPermissions]);

  const missing = missingPermissionCount(permissions);
  const on = settings.clapEnabled && serviceRunning;

  return (
    <Screen
      nav={<NavBar title="Clap to Find" />}
      dock={
        <div className="btn-pair">
          <button className="btn btn--ghost" type="button" onClick={() => void Listener.testAlert()}>
            Test alert
          </button>
          <button className="btn btn--mint" type="button" onClick={() => navigate('/calibrate')}>
            Calibrate
          </button>
        </div>
      }
    >
      <div style={{ marginBottom: 14 }}>
        <Chip tone={on ? 'on' : 'off'}>{on ? 'On — listening' : 'Off'}</Chip>
      </div>

      <Note>
        VocaLock ignores sounds coming from your own phone, so claps in a video or a song
        will not set it off.
      </Note>

      <Note>
        After you restart your phone, open VocaLock once to start listening again. Android
        does not let an app open the microphone on its own at boot.
      </Note>

      <Card flush>
        <LinkRow
          label="Permissions"
          sub={missing === 0 ? 'All set' : `${missing} still needed`}
          icon={<ShieldIcon />}
          tint={missing > 0 ? 'peach' : 'mint'}
          onClick={() => navigate('/permissions')}
          right={missing > 0 ? <Chip tone="warn">{missing}</Chip> : <span className="tick">&#10003;</span>}
        />
      </Card>

      <SectionLabel>Detection</SectionLabel>
      <Card>
        <div className="row__label" style={{ marginBottom: 10 }}>
          Sensitivity
        </div>
        <Segmented<Sensitivity>
          value={settings.sensitivity}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'med', label: 'Med' },
            { value: 'high', label: 'High' },
          ]}
          onChange={(sensitivity) => void patch({ sensitivity })}
        />
        <div className="row__sub" style={{ marginTop: 8 }}>
          Higher picks up quieter claps but reacts to more background noise.
        </div>
        <div style={{ height: 6 }} />
        <StepperRow
          label="Claps required"
          sub="How many claps in a row before it rings"
          value={settings.clapsRequired}
          min={1}
          max={5}
          onChange={(clapsRequired) => void patch({ clapsRequired })}
        />
        <ToggleRow
          label="Whistle detection"
          sub="Also ring on a held whistle"
          checked={settings.whistleEnabled}
          tint="mint"
          onChange={(whistleEnabled) => void patch({ whistleEnabled })}
        />
        <ToggleRow
          label="Only when screen is off"
          sub="Saves a lot of battery. You do not need to find a phone you are holding."
          checked={settings.onlyWhenScreenOff}
          tint="mint"
          onChange={(onlyWhenScreenOff) => void patch({ onlyWhenScreenOff })}
        />
      </Card>

      <SectionLabel>Alert</SectionLabel>
      <Card>
        <ToggleRow
          label="Ring"
          sub="Rings at alarm volume, even on silent"
          checked={settings.ring}
          tint="mint"
          onChange={(ring) => void patch({ ring })}
        />
        <ToggleRow
          label="Vibrate"
          checked={settings.vibrate}
          tint="mint"
          onChange={(vibrate) => void patch({ vibrate })}
        />
        <ToggleRow
          label="Flashlight"
          sub="Strobes the torch so you can spot it in the dark"
          checked={settings.flashlight}
          tint="mint"
          onChange={(flashlight) => void patch({ flashlight })}
        />
        <div className="row">
          <div className="row__main">
            <div className="row__label">Ringtone</div>
          </div>
          <select
            className="select"
            value={settings.ringtone}
            aria-label="Ringtone"
            onChange={(e) => void patch({ ringtone: e.target.value })}
          >
            {RINGTONES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <StepperRow
          label="Alert duration"
          sub="Stops on its own after this long"
          value={settings.alertDurationSec}
          min={10}
          max={120}
          step={10}
          format={(v) => `${v}s`}
          onChange={(alertDurationSec) => void patch({ alertDurationSec })}
        />
      </Card>

    </Screen>
  );
}
