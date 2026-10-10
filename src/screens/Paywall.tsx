import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import {
  BoltIcon,
  ClapIcon,
  LockIcon,
  LogoMark,
  ShieldIcon,
} from '../components/Icons';
import { PaywallVideo } from '../components/PaywallVideo';
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
    tag: `${PRICING.trialDays}-DAY TRIAL`,
    amount: PRICING.trialPrice,
    amountNote: 'today',
    then: `then ${C}${PRICING.renewalPrice} every ${PRICING.periodDays} days · Cancel anytime`,
    first: ['Today', `${C}${PRICING.trialPrice} for your ${PRICING.trialDays}-day trial`],
    next: [
      `After ${PRICING.trialDays} day${PRICING.trialDays === 1 ? '' : 's'}`,
      `${C}${PRICING.renewalPrice} every ${PRICING.periodDays} days until you cancel`,
    ],
    cta: `Start trial for ${C}${PRICING.trialPrice}`,
  },
  paid: {
    tag: 'PREMIUM',
    amount: PRICING.renewalPrice,
    amountNote: `for ${PRICING.periodDays} days`,
    then: `Renews every ${PRICING.periodDays} days · Cancel anytime`,
    first: ['Today', `${C}${PRICING.renewalPrice} for your first ${PRICING.periodDays} days`],
    next: [`Every ${PRICING.periodDays} days`, `${C}${PRICING.renewalPrice} until you cancel`],
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

  useEffect(() => {
    track('paywall_view');
  }, []);

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    track('paywall_cta_tap');
    track('mandate_started');
    try {
      await subscribe();
    } catch (failure) {
      setBusy(false);
      if (failure instanceof CheckoutDismissed) {
        track('mandate_failed', { reason: 'dismissed' });
        return;
      }
      track('mandate_failed', { reason: 'error' });
      setError((failure as Error).message || 'Payment did not go through. Try again.');
      return;
    }
    track('mandate_success');
    navigate('/home', { replace: true });
  };

  return (
    <Screen
      hero={
        <div className="hero__centre">
          {/* The canvas draws the app tile here. The Hindi explainer was asked
              for before the redesign and has no slot in the canvas, so it takes
              the tile's place when a video is present. */}
          {PRICING.paywallVideoUrl ? (
            <PaywallVideo remoteUrl={PRICING.paywallVideoUrl} />
          ) : (
            <span className="paywall-mark">
              <span className="paywall-mark__ring" />
              <span className="paywall-mark__ring" />
              <span className="paywall-mark__tile">
                <LogoMark size={52} tone="#1669C5" />
                <span className="paywall-mark__badge">&#11088;</span>
              </span>
            </span>
          )}
          <span className="trial-tag">{offer.tag}</span>
          <h1 className="hero__h1">Unlock VocaLock Premium</h1>
        </div>
      }
      dock={
        <>
          <p className="price__terms">
            Cancel any time from Profile &rarr; Payment Settings
          </p>
          {error ? <div className="field-error">{error}</div> : null}
          <button className="btn btn--primary" type="button" disabled={busy} onClick={unlock}>
            {offer.cta} &rarr;
          </button>
        </>
      }
    >
      <div className="price-card">
        <div className="price__amount">
          <b>
            {C}
            {offer.amount}
          </b>
          <span>{offer.amountNote}</span>
        </div>
        <div className="price__then">{offer.then}</div>

        <div className="price-card__rule" />

        {/* Play's subscription rules want the price and what follows it stated
            plainly, so this is a timeline rather than small print. */}
        <div className="timeline__step">
          <span className="timeline__rail">
            <span className="timeline__dot">&#10003;</span>
            <span className="timeline__line" />
          </span>
          <span className="timeline__body">
            <span className="timeline__label" style={{ display: 'block' }}>
              {offer.first[0]}
            </span>
            <span className="timeline__sub" style={{ display: 'block' }}>
              {offer.first[1]}
            </span>
          </span>
        </div>
        <div className="timeline__step">
          <span className="timeline__rail">
            <span className="timeline__dot timeline__dot--next" />
          </span>
          <span>
            <span className="timeline__label" style={{ display: 'block' }}>
              {offer.next[0]}
            </span>
            <span className="timeline__sub" style={{ display: 'block' }}>
              {offer.next[1]}
            </span>
          </span>
        </div>
      </div>

      <ul className="bullets">
        <li className="bullet">
          <span className="bullet__tick bullet__tick--clap">
            <ClapIcon size={19} />
          </span>
          <span>Clap to find your phone &mdash; rings even on silent</span>
        </li>
        <li className="bullet">
          <span className="bullet__tick bullet__tick--lock">
            <LockIcon size={18} />
          </span>
          <span>Lock your screen with your own voice phrase</span>
        </li>
        <li className="bullet">
          <span className="bullet__tick bullet__tick--offline">
            <ShieldIcon size={18} />
          </span>
          <span>Works offline &mdash; audio never leaves your phone</span>
        </li>
        <li className="bullet">
          <span className="bullet__tick bullet__tick--torch">
            <BoltIcon size={18} />
          </span>
          <span>Flashlight strobe and vibration so you spot it in the dark</span>
        </li>
      </ul>
    </Screen>
  );
}
