import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { FeatureCard } from '../components/FeatureCard';
import { Card, Chip, LinkRow } from '../components/Controls';
import { BoltIcon, ClapIcon, LockIcon, ShieldIcon, UserIcon } from '../components/Icons';
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

  const toggleClap = async (next: boolean) => {
    track('clap_toggle', { on: next });
    await patch({ clapEnabled: next });
    await syncService();
    if (next && missing > 0) navigate('/permissions');
  };

  const nav = (
    <div className="navbar">
      <div>
        <div className="brand">
          <div className="brand__mark">V</div>
          <div>
            <div className="brand__name">VocaLock</div>
            <div className="greeting">{greeting()}</div>
          </div>
        </div>
      </div>
      <span className="navbar__spacer" />
      <button className="avatar-btn" type="button" aria-label="Profile" onClick={() => navigate('/profile')}>
        <UserIcon />
      </button>
    </div>
  );

  return (
    <Screen nav={nav}>
      <FeatureCard
        tint="mint"
        icon={<ClapIcon />}
        title="Clap to Find"
        sub={
          settings.clapEnabled
            ? `Clap ${settings.clapsRequired} times and it rings`
            : 'Lost your phone? Just clap.'
        }
        state={settings.clapEnabled && serviceRunning ? 'Listening' : 'Off'}
        live={settings.clapEnabled && serviceRunning}
        checked={settings.clapEnabled}
        onToggle={toggleClap}
        onOpen={() => navigate('/clap')}
      />

      <FeatureCard
        tint="lilac"
        icon={<LockIcon size={26} />}
        title="Voice Lock"
        sub={
          voiceLockSetUp
            ? 'Say your phrase to lock the screen'
            : 'Lock your screen with your voice'
        }
        state={voiceLockSetUp ? (settings.voiceLockEnabled ? 'Armed' : 'Off') : 'Not set up'}
        live={voiceLockSetUp && settings.voiceLockEnabled && serviceRunning}
        checked={voiceLockSetUp ? settings.voiceLockEnabled : undefined}
        onToggle={
          voiceLockSetUp
            ? async (next) => {
                await patch({ voiceLockEnabled: next });
                await syncService();
              }
            : undefined
        }
        onOpen={() => navigate(voiceLockSetUp ? '/voice-lock' : '/voice-lock/intro')}
        action={
          voiceLockSetUp ? undefined : (
            <button
              className="feature__state"
              type="button"
              style={{ fontWeight: 600 }}
              onClick={() => navigate('/voice-lock/intro')}
            >
              Set up &rarr;
            </button>
          )
        }
      />

      {missing > 0 ? (
        <Card flush>
          <LinkRow
            label="Finish setting up"
            sub={`${missing} permission${missing > 1 ? 's' : ''} still needed`}
            icon={<ShieldIcon />}
            tint="peach"
            onClick={() => navigate('/permissions')}
            right={<Chip tone="warn">{missing}</Chip>}
          />
        </Card>
      ) : null}

      <Card flush>
        <LinkRow
          label="Test the alert"
          sub="Hear what it sounds like"
          icon={<BoltIcon />}
          tint="peach"
          onClick={() => void Listener.testAlert()}
        />
      </Card>

      {entitlement.status === 'trial' ? (
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <Chip tone="off">
            Trial &middot; {trialDays} day{trialDays === 1 ? '' : 's'} left
          </Chip>
        </div>
      ) : null}
    </Screen>
  );
}
