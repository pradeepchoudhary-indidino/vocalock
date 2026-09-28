import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { FeatureTile } from '../components/FeatureCard';
import {
  BoltIcon,
  ChevronRight,
  ClapIcon,
  LockIcon,
  LogoMark,
  ShieldStatus,
  UserIcon,
} from '../components/Icons';
import { Listener } from '../plugins';
import { missingPermissionCount, useSettings } from '../store/settings';
import { daysLeft, usePremium } from '../store/account';
import { track } from '../lib/analytics';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Screen 4. */
export function Home() {
  const navigate = useNavigate();
  const { settings, permissions, serviceRunning, loaded } = useSettings();
  const { hydrate, patch, refreshPermissions, syncService } = useSettings();
  const entitlement = usePremium((s) => s.entitlement);

  useEffect(() => {
    if (!loaded) void hydrate();
    else void refreshPermissions();
  }, [loaded, hydrate, refreshPermissions]);

  const voiceLockSetUp = settings.lockPhrase !== '' && settings.unlockPhrase !== '';
  const missing = missingPermissionCount(permissions);
  const trialDays = daysLeft(entitlement);

  const clapOn = settings.clapEnabled && serviceRunning;
  const lockOn = voiceLockSetUp && settings.voiceLockEnabled && serviceRunning;
  const liveCount = (clapOn ? 1 : 0) + (lockOn ? 1 : 0);
  const heroTitle =
    liveCount === 2 ? 'You’re protected' : liveCount === 1 ? 'Half protected' : 'Not protected';

  const toggleClap = async (next: boolean) => {
    track('clap_toggle', { on: next });
    await patch({ clapEnabled: next });
    await syncService();
    if (next && missing > 0) navigate('/permissions');
  };

  const hero = (
    <>
      <div className="hero__bar">
        <span className="hero__tile">
          <LogoMark size={30} tone="#1669C5" />
        </span>
        <div>
          <div className="hero__greet">{greeting()}</div>
          <div className="hero__name">VocaLock</div>
        </div>
        <span className="hero__spacer" />
        <button
          className="hero__btn"
          type="button"
          aria-label="Profile"
          onClick={() => navigate('/profile')}
        >
          <UserIcon />
        </button>
      </div>

      <div className="hero__centre">
        <div className={`hero__emblem${liveCount === 0 ? ' hero__emblem--idle' : ''}`}>
          {liveCount > 0 ? (
            <>
              <span className="hero__emblem-ring" />
              <span className="hero__emblem-ring" />
            </>
          ) : null}
          <span className="hero__emblem-mark">
            <ShieldStatus size={62} armed={liveCount === 2} />
          </span>
        </div>
        <div className="hero__h1">{heroTitle}</div>
        <div className="hero__pips">
          <span className={`hero__pip${clapOn ? ' hero__pip--on' : ''}`}>Clap</span>
          <span className={`hero__pip${lockOn ? ' hero__pip--on' : ''}`}>Voice lock</span>
        </div>
      </div>
    </>
  );

  return (
    <Screen hero={hero}>
      <div className="home-grid">
        <FeatureTile
          feature="clap"
          icon={<ClapIcon size={30} />}
          title="Clap to Find"
          sub={
            settings.clapEnabled
              ? `Clap ${settings.clapsRequired}× and it rings`
              : 'Lost it? Just clap.'
          }
          action={clapOn ? 'Listening' : 'Turn on'}
          on={clapOn}
          onAction={() => void toggleClap(!settings.clapEnabled)}
          onOpen={() => navigate('/clap')}
          settingsLabel="Clap to Find settings"
        />

        <FeatureTile
          feature="lock"
          icon={<LockIcon size={28} />}
          title="Voice Lock"
          sub={voiceLockSetUp ? 'Say your phrase to lock' : 'Lock with your voice'}
          action={lockOn ? 'Armed' : voiceLockSetUp ? 'Turn on' : 'Set up'}
          on={lockOn}
          onAction={async () => {
            if (!voiceLockSetUp) {
              navigate('/voice-lock/intro');
              return;
            }
            await patch({ voiceLockEnabled: !settings.voiceLockEnabled });
            await syncService();
          }}
          onOpen={() => navigate(voiceLockSetUp ? '/voice-lock' : '/voice-lock/intro')}
          settingsLabel="Voice Lock settings"
        />
      </div>

      {missing > 0 ? (
        <button className="action-strip" type="button" onClick={() => navigate('/permissions')}>
          <span className="action-strip__tile">
            <BoltIcon />
          </span>
          <span className="action-strip__main">
            <span className="action-strip__name" style={{ display: 'block' }}>
              Finish setting up
            </span>
            <span className="action-strip__sub" style={{ display: 'block' }}>
              {missing} permission{missing > 1 ? 's' : ''} still needed
            </span>
          </span>
          <ChevronRight />
        </button>
      ) : null}

      <button className="action-strip" type="button" onClick={() => void Listener.testAlert()}>
        <span className="action-strip__tile">
          <BoltIcon />
        </span>
        <span className="action-strip__main">
          <span className="action-strip__name" style={{ display: 'block' }}>
            Test the alert
          </span>
          <span className="action-strip__sub" style={{ display: 'block' }}>
            Hear what it sounds like
          </span>
        </span>
        <ChevronRight />
      </button>

      {entitlement.status === 'trial' ? (
        <div className="plan-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="action-strip__tile" style={{ boxShadow: 'none', background: '#fff0c2' }}>
            &#11088;
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="action-strip__name" style={{ display: 'block' }}>
              Premium trial
            </span>
            <span className="tile__sub" style={{ display: 'block' }}>
              {trialDays} day{trialDays === 1 ? '' : 's'} left
            </span>
          </span>
        </div>
      ) : null}
    </Screen>
  );
}
