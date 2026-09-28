import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Card, Note, Sheet } from '../components/Controls';
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
          <div className="row__sub">Monthly Premium</div>
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
            {PRICING.monthlyPrice}/month
          </div>
        </div>
        <div className="row">
          <div className="row__main">
            <div className="row__label">
              {entitlement.status === 'cancelled' ? 'Access until' : 'Valid until'}
            </div>
          </div>
          <div className="row__sub">{formatDate(entitlement.validUntil)}</div>
        </div>
      </Card>

      {entitlement.status === 'cancelled' ? (
        <Note>
          Your subscription is cancelled. You keep Premium until{' '}
          {formatDate(entitlement.validUntil)}, then the app goes back to the free state.
        </Note>
      ) : null}

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
            You keep Premium until {formatDate(entitlement.validUntil)}. Nothing further will
            be charged.
          </p>
          <div style={{ height: 18 }} />
          <button
            className="btn btn--danger"
            type="button"
            onClick={async () => {
              await cancel();
              track('cancel_confirmed');
              setConfirm(false);
            }}
          >
            Yes, cancel it
          </button>
          <button className="text-btn" type="button" onClick={() => setConfirm(false)}>
            Keep my subscription
          </button>
        </Sheet>
      ) : null}
    </Screen>
  );
}
