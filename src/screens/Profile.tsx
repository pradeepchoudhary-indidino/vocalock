import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Card, LinkRow, Sheet } from '../components/Controls';
import { CardIcon, DocIcon, LifebuoyIcon, LogOutIcon, ShieldIcon } from '../components/Icons';
import { daysLeft, isPremium, usePremium } from '../store/account';
import { APP_VERSION } from '../lib/analytics';

const PLAN_LABEL: Record<string, string> = {
  none: 'No plan',
  trial: 'Trial',
  active: 'Premium',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Screen 13. */
export function Profile() {
  const navigate = useNavigate();
  const { session, entitlement, signOut } = usePremium();
  const [confirmOut, setConfirmOut] = useState(false);

  const premium = isPremium(entitlement);
  const left = daysLeft(entitlement);

  return (
    <Screen nav={<NavBar title="Profile" />}>
      <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
        <div className="hero-illo hero-illo--lilac" style={{ margin: '0 auto 12px' }}>
          &#128100;
        </div>
        <div style={{ fontSize: 19, fontWeight: 600 }}>{session?.phone ?? 'VocaLock'}</div>
        <div className="row__sub">VocaLock account</div>
      </div>

      <div className="plan-card">
        <div style={{ fontSize: 13, opacity: 0.85 }}>Your plan</div>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: '2px 0 10px' }}>
          {PLAN_LABEL[entitlement.status]}
        </div>
        {premium ? (
          <div className="plan-card__row">
            <span>{entitlement.status === 'cancelled' ? 'Access until' : 'Renews in'}</span>
            <strong>
              {left} day{left === 1 ? '' : 's'}
            </strong>
          </div>
        ) : (
          <div className="plan-card__row">
            <span>Premium features are locked</span>
          </div>
        )}
      </div>

      {!premium ? (
        <button className="btn btn--primary" type="button" onClick={() => navigate('/paywall')}>
          Unlock Premium
        </button>
      ) : null}

      <div style={{ height: 14 }} />

      <Card flush>
        <LinkRow
          label="Payment Settings"
          icon={<CardIcon />}
          tint="mint"
          onClick={() => navigate('/payment')}
        />
        <LinkRow
          label="Privacy Policy"
          icon={<ShieldIcon />}
          tint="sky"
          onClick={() => navigate('/legal/privacy')}
        />
        <LinkRow
          label="Terms of Service"
          icon={<DocIcon />}
          tint="sky"
          onClick={() => navigate('/legal/terms')}
        />
        <LinkRow
          label="Refund Policy"
          icon={<DocIcon />}
          tint="sky"
          onClick={() => navigate('/legal/refund')}
        />
        <LinkRow
          label="Help & Support"
          icon={<LifebuoyIcon />}
          tint="peach"
          onClick={() => navigate('/legal/help')}
        />
      </Card>

      <Card flush>
        <LinkRow
          label="Sign out"
          icon={<LogOutIcon />}
          tint="peach"
          onClick={() => setConfirmOut(true)}
        />
      </Card>

      <div className="version-foot">VocaLock {APP_VERSION}</div>

      {confirmOut ? (
        <Sheet title="Sign out" onDismiss={() => setConfirmOut(false)}>
          <h2 className="card__title">Sign out?</h2>
          <p className="card__text">
            Your number and plan are cleared from this phone. Your voice lock phrases and
            clap settings stay as they are.
          </p>
          <div style={{ height: 18 }} />
          <button
            className="btn btn--danger"
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            Sign out
          </button>
          <button className="text-btn" type="button" onClick={() => setConfirmOut(false)}>
            Stay signed in
          </button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
