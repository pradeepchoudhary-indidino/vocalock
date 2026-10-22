import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Card, LinkRow, SectionLabel, Segmented, Sheet } from '../components/Controls';
import { CardIcon, DocIcon, LifebuoyIcon, LogOutIcon, ShieldIcon, UserIcon } from '../components/Icons';
import { PRICING, daysLeft, isPremium, usePremium } from '../store/account';
import { APP_VERSION } from '../lib/analytics';
import { setThemePref, useTheme, type ThemePref } from '../lib/theme';

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
  const { session, entitlement, signOut, deleteAccount, cancel } = usePremium();
  const { pref: themePref } = useTheme();
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const premium = isPremium(entitlement);
  const left = daysLeft(entitlement);
  // Deleting the account never cancels: only the Cancel button stops the mandate.
  const subscribed = premium && (entitlement.status === 'trial' || entitlement.status === 'active');

  return (
    <Screen
      hero={
        <>
          <NavBar title="Profile" />
          <div className="hero__centre">
            <div className="hero-illo">&#128100;</div>
            <div className="hero__name">{session?.name ?? 'VocaLock'}</div>
            <div className="hero__sub">{session?.email ?? 'VocaLock account'}</div>
          </div>
        </>
      }
    >

      <div className="plan-card">
        <div className="plan-card__head">
          <span className="plan-card__tile">&#128081;</span>
          <span style={{ minWidth: 0 }}>
            <span className="plan-card__eyebrow" style={{ display: 'block' }}>
              Your plan
            </span>
            <span className="plan-card__name" style={{ display: 'block' }}>
              {PLAN_LABEL[entitlement.status]}
            </span>
            <span className="plan-card__note" style={{ display: 'block' }}>
              {premium
                ? `${entitlement.status === 'cancelled' ? 'Access until' : 'Renews in'} ${left} day${
                    left === 1 ? '' : 's'
                  }`
                : 'Premium features are locked'}
            </span>
          </span>
        </div>

        {!premium ? (
          <button
            className="btn btn--primary"
            type="button"
            style={{ minHeight: 52, marginTop: 14 }}
            onClick={() => navigate('/paywall')}
          >
            &#11088; Unlock Premium
          </button>
        ) : null}
      </div>

      <SectionLabel>Appearance</SectionLabel>
      <Card>
        <Segmented<ThemePref>
          value={themePref}
          onChange={setThemePref}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <p className="card__text" style={{ marginTop: 12 }}>
          Dark is easy on the eyes at night and uses less battery on OLED phones.
        </p>
      </Card>

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
        <LinkRow
          label="Delete account"
          icon={<UserIcon />}
          tint="peach"
          onClick={() => {
            setDeleteError('');
            setConfirmDelete(true);
          }}
        />
      </Card>

      <div className="version-foot">VocaLock {APP_VERSION}</div>

      {confirmOut ? (
        <Sheet title="Sign out" onDismiss={() => setConfirmOut(false)}>
          <h2 className="card__title">Sign out?</h2>
          <p className="card__text">
            Your account and plan are cleared from this phone. Your voice lock phrases and
            clap settings stay as they are.
          </p>
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

      {confirmDelete ? (
        <Sheet title="Delete account" onDismiss={() => setConfirmDelete(false)}>
          <h2 className="card__title">Delete your account?</h2>
          {subscribed ? (
            <>
              <p className="card__text">
                Deleting your account does <strong>not</strong> cancel your subscription. You
                will still be charged {PRICING.currency}
                {PRICING.renewalPrice} every {PRICING.periodDays} days until you cancel it.
              </p>
              <button
                className="btn btn--primary"
                type="button"
                disabled={cancelling || deleting}
                onClick={async () => {
                  setCancelling(true);
                  setDeleteError('');
                  try {
                    await cancel();
                  } catch (failure) {
                    setDeleteError((failure as Error).message || 'Could not cancel. Try again.');
                  } finally {
                    setCancelling(false);
                  }
                }}
              >
                {cancelling ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            </>
          ) : (
            <p className="card__text">
              You will be signed out on every device.
            </p>
          )}
          <button
            className="btn btn--danger"
            type="button"
            disabled={deleting || cancelling}
            onClick={async () => {
              setDeleting(true);
              setDeleteError('');
              try {
                await deleteAccount();
              } catch (failure) {
                setDeleteError((failure as Error).message || 'Could not delete. Try again.');
                return;
              } finally {
                setDeleting(false);
              }
              navigate('/login', { replace: true });
            }}
          >
            {deleting ? 'Deleting…' : subscribed ? 'Delete account only' : 'Delete my account'}
          </button>
          {deleteError ? <div className="field-error">{deleteError}</div> : null}
          <button className="text-btn" type="button" onClick={() => setConfirmDelete(false)}>
            Keep my account
          </button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
