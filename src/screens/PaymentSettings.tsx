import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Card, Sheet } from '../components/Controls';
import { PRICING, formatDate, isPremium, usePremium } from '../store/account';
import { track } from '../lib/analytics';

const STATUS_LABEL: Record<string, string> = {
  none: 'Not subscribed',
  trial: 'Trial',
  active: 'Active',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Screen 14. */
export function PaymentSettings() {
  const navigate = useNavigate();
  const { entitlement, cancel } = usePremium();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const premium = isPremium(entitlement);
  const canCancel = entitlement.status === 'trial' || entitlement.status === 'active';

  return (
    <Screen
      hero={
        <>
          <NavBar title="Payment Settings" />
          <p className="hero__sub">Your plan, and how to end it.</p>
        </>
      }
    >
      <Card>
        <div className="row">
          <div className="row__main">
            <div className="row__label">Plan</div>
          </div>
          <div className="row__sub">VocaLock Premium</div>
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__label">Status</div>
          </div>
          <div className="row__sub">{STATUS_LABEL[entitlement.status]}</div>
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__label">Price</div>
          </div>
          <div className="row__sub">
            {PRICING.currency}
            {PRICING.renewalPrice} / {PRICING.periodDays} days
          </div>
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__label">
              {entitlement.status === 'cancelled' ? 'Ended' : 'Valid until'}
            </div>
          </div>
          <div className="row__sub">{formatDate(entitlement.validUntil)}</div>
        </div>
      </Card>

      {canCancel ? (
        <button
          className="btn btn--danger"
          type="button"
          onClick={() => {
            track('cancel_tap');
            setConfirm(true);
          }}
        >
          Cancel subscription
        </button>
      ) : !premium ? (
        <button className="btn btn--primary" type="button" onClick={() => navigate('/paywall')}>
          Unlock Premium
        </button>
      ) : null}

      {confirm ? (
        <Sheet title="Cancel subscription" onDismiss={() => setConfirm(false)}>
          <h2 className="card__title">Cancel your subscription?</h2>
          <p className="card__text">
            Premium ends straight away and nothing further is charged. The rest of the
            current period is not refunded.
          </p>
          <button
            className="btn btn--danger"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await cancel();
              } catch (failure) {
                track('cancel_confirmed', { ok: false });
                setError((failure as Error).message || 'Could not cancel. Try again.');
                return;
              } finally {
                setBusy(false);
              }
              track('cancel_confirmed');
              setConfirm(false);
              navigate('/paywall', { replace: true });
            }}
          >
            Yes, cancel it
          </button>
          {error ? <div className="field-error">{error}</div> : null}
          <button
            className="text-btn"
            type="button"
            onClick={() => {
              track('cancel_abandoned');
              setConfirm(false);
            }}
          >
            Keep my subscription
          </button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
