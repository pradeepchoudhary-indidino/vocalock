import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { Screen } from '../../components/Screen';
import { NavBar } from '../../components/NavBar';
import { LockIcon, MicIcon } from '../../components/Icons';
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
    <Screen flow="purple"
      hero={
        <>
          <NavBar title="Voice Lock" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="emblem">
              {settings.voiceLockEnabled ? (
                <>
                  <span className="emblem__ring" />
                  <span className="emblem__ring" />
                </>
              ) : null}
              <span className="emblem__disc">
                <LockIcon size={26} />
              </span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span className="hero__status">
                <span
                  className="chip__dot"
                  style={{ background: settings.voiceLockEnabled ? '#7dffb0' : 'rgba(255,255,255,.5)' }}
                />
                {settings.voiceLockEnabled ? 'Armed' : 'Off'}
              </span>
              <span className="hero__sub">
                {settings.voiceLockEnabled
                  ? 'Say your lock phrase any time'
                  : 'Turn it on to lock with your voice'}
              </span>
            </span>
          </div>
        </>
      }
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

      {/* The canvas shows the two saved phrases as a pair of small cards rather
          than as rows — they are the thing people come here to check. */}
      <div className="phrase-pair">
        <div className="phrase-card">
          <span className="phrase-card__icon">
            <LockIcon size={17} />
          </span>
          <span className="phrase-card__label">Lock phrase</span>
          <span className="phrase-card__value">&ldquo;{settings.lockPhrase}&rdquo;</span>
        </div>
        <div className="phrase-card">
          <span className="phrase-card__icon phrase-card__icon--alt">
            <MicIcon size={17} />
          </span>
          <span className="phrase-card__label">
            {!deviceLock && settings.unlockPhrase ? 'Unlock phrase' : 'To unlock'}
          </span>
          <span className="phrase-card__value">
            {!deviceLock && settings.unlockPhrase
              ? `\u201c${settings.unlockPhrase}\u201d`
              : 'Fingerprint or PIN'}
          </span>
        </div>
      </div>

      <button
        className="btn btn--ghost"
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
