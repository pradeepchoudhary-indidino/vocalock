import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Card, Note, Sheet } from '../components/Controls';
import { Listener, type PermissionName } from '../plugins';
import { track } from '../lib/analytics';
import { useSettings } from '../store/settings';

interface Entry {
  key: PermissionName;
  label: string;
  sub: string;
  required?: boolean;
}

const ENTRIES: Entry[] = [
  {
    key: 'mic',
    label: 'Microphone',
    sub: 'Needed to hear your claps and your unlock phrase',
    required: true,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    sub: 'Shows the listening notice and the Stop alert button',
  },
  {
    key: 'batteryExempt',
    label: 'Battery',
    sub: 'Stops Android from shutting the listener down',
  },
  {
    key: 'overlay',
    label: 'Draw over apps',
    sub: 'Lets the alert and the lock screen appear on top',
  },
];

/** Screen 10. */
export function Permissions() {
  const navigate = useNavigate();
  const { permissions, refreshPermissions } = useSettings();
  // Play policy: a prominent disclosure has to come before the mic prompt.
  const [disclosureFor, setDisclosureFor] = useState<PermissionName | null>(null);

  useEffect(() => {
    void refreshPermissions();
    // The user leaves the app for the battery and overlay system screens, so
    // re-check whenever they come back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshPermissions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshPermissions]);

  const request = async (key: PermissionName) => {
    track('permission_request', { name: key });
    if (key === 'batteryExempt') await Listener.openBatterySettings();
    else if (key === 'overlay') await Listener.openOverlaySettings();
    else await Listener.requestPermission({ name: key });
    await refreshPermissions();
    track('permission_result', {
      name: key,
      granted: useSettings.getState().permissions[key],
    });
  };

  const onAllow = (key: PermissionName) => {
    if (key === 'mic' && !permissions.mic) {
      track('permission_request', { name: key, step: 'disclosure_shown' });
      setDisclosureFor('mic');
    }
    else void request(key);
  };

  return (
    <Screen
      hero={
        <>
          <NavBar title="Permissions" />
          <p className="hero__sub">
            VocaLock needs these to hear you and to reach you. Nothing here leaves
            your phone.
          </p>
        </>
      }
      dock={
        <button className="btn btn--primary" type="button" onClick={() => navigate(-1)}>
          Done
        </button>
      }
    >
      <Card flush>
        {ENTRIES.map((entry) => (
          <div className="row" key={entry.key}>
            <div className="row__main">
              <div className="row__label">
                {entry.label}
                {entry.required ? (
                  <span className="required-tag" style={{ marginLeft: 8 }}>
                    Required
                  </span>
                ) : null}
              </div>
              <div className="row__sub">{entry.sub}</div>
            </div>
            {permissions[entry.key] ? (
              <span className="tick" aria-label="Allowed">
                &#10003;
              </span>
            ) : (
              <button className="allow-link" type="button" onClick={() => onAllow(entry.key)}>
                Allow
              </button>
            )}
          </div>
        ))}
      </Card>

      <Note>
        Android stops background apps to save battery. Without the battery exemption your
        phone may stop listening after a while — on Xiaomi, Realme, Oppo and Vivo phones you
        may also need to lock VocaLock in the recent-apps list.
      </Note>

      {/* Play's prominent disclosure, before the system prompt. A Sheet, rendered
          into <body>: drawn inside the screen it sat under the docked button. */}
      {disclosureFor === 'mic' ? (
        <Sheet title="VocaLock needs the microphone" onDismiss={() => setDisclosureFor(null)}>
          <h2 className="card__title">VocaLock needs the microphone</h2>
          <p className="card__text">
            VocaLock listens in the background for your claps and for your unlock phrase,
            including while the app is closed. Audio is processed on your phone only. It is
            never recorded, saved or sent anywhere.
          </p>
          <div style={{ height: 16 }} />
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => {
              setDisclosureFor(null);
              void request('mic');
            }}
          >
            Continue
          </button>
          <button
            className="text-btn"
            type="button"
            onClick={() => {
              track('permission_result', { name: 'mic', granted: false, step: 'disclosure_declined' });
              setDisclosureFor(null);
            }}
          >
            Not now
          </button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
