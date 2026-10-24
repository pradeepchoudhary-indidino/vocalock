import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { ClapIcon, CloseIcon, LockIcon, LogoMark, ShieldIcon } from '../components/Icons';
import { PaywallMedia } from '../components/PaywallMedia';
import { useRemoteConfig } from '../lib/remoteConfig';
import { PRICING, usePremium } from '../store/account';
import { track } from '../lib/analytics';
import { CheckoutDismissed } from '../lib/razorpay';

const { currency: C } = PRICING;

/**
 * The two offers. One ₹1 trial per person, ever; anyone who has had it (the
 * server decides) is asked the plan price up front.
 */
const OFFERS = {
  trial: {
    amount: PRICING.trialPrice,
    amountNote: 'today',
    then: `then ${C}${PRICING.renewalPrice} every ${PRICING.periodDays} days · Cancel anytime`,
    // Play's subscription rules want the price and what follows stated plainly.
    terms: `${C}${PRICING.trialPrice} today for a ${PRICING.trialDays}-day trial, then ${C}${PRICING.renewalPrice} every ${PRICING.periodDays} days until you cancel. Cancel any time in Profile → Payment Settings.`,
    cta: `Start trial for ${C}${PRICING.trialPrice}`,
  },
  paid: {
    amount: PRICING.renewalPrice,
    amountNote: `for ${PRICING.periodDays} days`,
    then: `Renews every ${PRICING.periodDays} days · Cancel anytime`,
    terms: `${C}${PRICING.renewalPrice} today, then every ${PRICING.periodDays} days until you cancel. Cancel any time in Profile → Payment Settings.`,
    cta: `Subscribe for ${C}${PRICING.renewalPrice}`,
  },
};

/**
 * Screen 3.
 *
 * With the server's Razorpay keys set, the button opens Razorpay Checkout for
 * the subscription mandate and Premium starts only once the server has verified
 * the payment. Without a backend it grants the trial on the device.
 */
export function Paywall() {
  const navigate = useNavigate();
  const subscribe = usePremium((s) => s.subscribe);
  const offer = usePremium((s) => (s.entitlement.trialEligible ? OFFERS.trial : OFFERS.paid));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const offerKind = offer === OFFERS.trial ? 'trial' : 'paid';
  const { paywallVideoUrl } = useRemoteConfig();
  const attempts = useRef(0);

  useEffect(() => {
    track('paywall_view', {
      offer: offerKind,
      video: Boolean(paywallVideoUrl),
    });
    // Once per visit, with the offer it opened on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    attempts.current += 1;
    const tapped = Date.now();
    track('paywall_cta_tap', { offer: offerKind, attempt: attempts.current });
    track('mandate_started', { offer: offerKind, attempt: attempts.current });
    try {
      await subscribe();
    } catch (failure) {
      setBusy(false);
      if (failure instanceof CheckoutDismissed) {
        track('mandate_failed', {
          reason: 'dismissed',
          offer: offerKind,
          ms: Date.now() - tapped,
        });
        return;
      }
      track('mandate_failed', {
        reason: 'error',
        offer: offerKind,
        ms: Date.now() - tapped,
        message: ((failure as Error).message ?? '').slice(0, 200),
      });
      setError((failure as Error).message || 'Payment did not go through. Try again.');
      return;
    }
    track('mandate_success', { offer: offerKind, ms: Date.now() - tapped });
    navigate('/home', { replace: true });
  };

  // Play requires a clearly visible way out of the paywall. Profile, Payment
  // Settings and Legal stay open without Premium, so dismissing lands there.
  const dismiss = (how: 'close') => {
    track('paywall_dismiss', {
      how,
      offer: offerKind,
      attempts: attempts.current,
    });
    navigate('/profile');
  };

  return (
    <Screen
      dock={
        <>
          {error ? <div className="field-error">{error}</div> : null}
          <button className="btn btn--primary" type="button" disabled={busy} onClick={unlock}>
            {busy ? 'Opening payment…' : offer.cta}
          </button>
          <p className="pw-terms">{offer.terms}</p>
        </>
      }
    >
      <div className="pw">
        <div className="pw-top">
          <span className="pw-brand">
            <span className="pw-brand__tile">
              <LogoMark size={24} tone="#1669C5" />
            </span>
            VocaLock
          </span>
          {/* The way out Play requires (1.1 was rejected without one): always on
            screen, a full 44px target. Android's Back does the same. */}
          <button
            className="pw-close"
            type="button"
            aria-label="Close"
            onClick={() => dismiss('close')}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Remote: a video set on the server replaces the slides, no release needed. */}
        <PaywallMedia key={paywallVideoUrl ?? 'slides'} videoUrl={paywallVideoUrl ?? undefined} />

        <div className="pw-heading">
          <h1 className="pw-title">Unlock VocaLock Premium</h1>
        </div>

        <div className="price__amount pw-price">
          <b>
            {C}
            {offer.amount}
          </b>
          <span>{offer.amountNote}</span>
        </div>
        <p className="pw-then">{offer.then}</p>

        <ul className="pw-features">
          <li className="pw-feature">
            <span className="pw-feature__icon pw-feature__icon--clap">
              <ClapIcon size={20} />
            </span>
            Clap to find your phone
          </li>
          <li className="pw-feature">
            <span className="pw-feature__icon pw-feature__icon--lock">
              <LockIcon size={19} />
            </span>
            Lock and unlock with your voice
          </li>
          <li className="pw-feature">
            <span className="pw-feature__icon pw-feature__icon--offline">
              <ShieldIcon size={19} />
            </span>
            Private, works offline
          </li>
        </ul>
      </div>
    </Screen>
  );
}
