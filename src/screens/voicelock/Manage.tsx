import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { Card, Note, Sheet, ToggleRow } from '../../components/Controls';
import { Listener } from '../../plugins';
import { useSettings } from '../../store/settings';

/** Manage an existing voice lock: re-record, disarm, or remove it entirely. */
export function VoiceLockManage() {
  const navigate = useNavigate();
  const { settings, patch, syncService } = useSettings();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const remove = async () => {
    await patch({ lockPhrase: '', unlockPhrase: '', voiceLockEnabled: false, isLocked: false });
    await Listener.clearPin();
    await syncService();
    setConfirmRemove(false);
    navigate('/home', { replace: true });
  };

  return (
    <Screen
      nav={<NavBar title="Voice Lock" />}
      dock={
        <button className="btn btn--lilac" type="button" onClick={() => void Listener.lock()}>
          Lock my screen now
        </button>
      }
    >
      <Card>
        <ToggleRow
          label="Voice Lock"
          sub={settings.voiceLockEnabled ? 'Listening for your lock phrase' : 'Off'}
          checked={settings.voiceLockEnabled}
          tint="lilac"
          onChange={async (next) => {
            await patch({ voiceLockEnabled: next });
            await syncService();
          }}
        />
        <ToggleRow
          label="Block the notification shade"
          sub="Stronger, but Android asks you to confirm every single time you lock."
          checked={settings.blockNotificationShade}
          tint="lilac"
          onChange={(blockNotificationShade) => void patch({ blockNotificationShade })}
        />
      </Card>

      <Card>
        <div className="row">
          <div className="row__main">
            <div className="row__sub">Lock phrase</div>
            <div className="row__label">&ldquo;{settings.lockPhrase}&rdquo;</div>
          </div>
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__sub">Unlock phrase</div>
            <div className="row__label">&ldquo;{settings.unlockPhrase}&rdquo;</div>
          </div>
        </div>
      </Card>

      <button
        className="btn btn--quiet"
        type="button"
        onClick={() => navigate('/voice-lock/intro')}
      >
        Change phrases
      </button>
      <div style={{ height: 10 }} />
      <button className="btn btn--danger" type="button" onClick={() => setConfirmRemove(true)}>
        Remove voice lock
      </button>

      <div style={{ height: 14 }} />
      <Note tone="warn">
        A focus tool, not a security lock. It cannot cover your Android lock screen, and it
        can be got past by force-stopping VocaLock in Android settings.
      </Note>

      {confirmRemove ? (
        <Sheet title="Remove voice lock" onDismiss={() => setConfirmRemove(false)}>
          <h2 className="card__title">Remove voice lock?</h2>
          <p className="card__text">
            Your phrases and backup PIN are deleted from this phone. You can set it up again
            any time.
          </p>
          <div style={{ height: 18 }} />
          <button className="btn btn--danger" type="button" onClick={remove}>
            Remove it
          </button>
          <button className="text-btn" type="button" onClick={() => setConfirmRemove(false)}>
            Keep it
          </button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
