import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
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
  // Device admin IS the mode, so this reads the real thing rather than a
  // setting that could drift from it — the user can revoke admin in Android
  // settings at any time and we would never hear about it.
  const [deviceLock, setDeviceLock] = useState(false);

  const refreshMode = useCallback(async () => {
    const { active } = await Listener.isDeviceLockAvailable();
    // oxlint-disable-next-line react/set-state-in-effect -- device admin lives
    // in Android, not in React. Reading it is exactly the external-system
    // synchronisation an effect is for, and it cannot be derived during render.
    setDeviceLock(active);
  }, []);

  useEffect(() => {
    void refreshMode();
    // The consent and revoke screens are separate activities, so the answer
    // only arrives when the user comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshMode();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshMode]);

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
          label="Lock my phone properly"
          sub={
            deviceLock
              ? 'Your phrase locks your real lock screen. Unlock with your fingerprint or PIN.'
              : 'Use your phone\u2019s own lock instead of covering the screen.'
          }
          checked={deviceLock}
          tint="lilac"
          onChange={(next) => {
            if (next) void Listener.requestDeviceLock();
            else void Listener.releaseDeviceLock().then(refreshMode);
          }}
        />
      </Card>

      <Card>
        <div className="row">
          <div className="row__main">
            <div className="row__sub">Lock phrase</div>
            <div className="row__label">&ldquo;{settings.lockPhrase}&rdquo;</div>
          </div>
        </div>
        {!deviceLock && settings.unlockPhrase ? (
          <div className="row">
            <div className="row__main">
              <div className="row__sub">Unlock phrase</div>
              <div className="row__label">&ldquo;{settings.unlockPhrase}&rdquo;</div>
            </div>
          </div>
        ) : (
          <div className="row">
            <div className="row__main">
              <div className="row__sub">To unlock</div>
              <div className="row__label">Your fingerprint or PIN</div>
            </div>
          </div>
        )}
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
      {!deviceLock ? (
        <Note tone="warn">
          A focus tool, not a security lock. It cannot cover your Android lock screen, and
          it can be got past by force-stopping VocaLock in Android settings.
        </Note>
      ) : (
        <Note>
          Your phrase locks your phone with its own lock screen, so it stays locked even if
          VocaLock is closed or force-stopped.
        </Note>
      )}

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
