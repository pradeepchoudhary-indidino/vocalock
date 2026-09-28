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


/**
 * Screen 3.
 *
 * UI only, by decision: "Unlock Now" grants the trial on the device straight
 * away. No mandate is created and no money moves. The real PhonePe AutoPay flow
 * replaces `startTrial` with the createSubscription call in M4 — everything on
 * this screen stays as it is.
 */
export function Paywall() {
  const navigate = useNavigate();
  const startTrial = usePremium((s) => s.startTrial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    track('paywall_view');
  }, []);

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    track('paywall_cta_tap');
    track('mandate_started', { mode: 'ui_only' });
    await startTrial('pending');
    track('mandate_success', { mode: 'ui_only' });
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
          <span className="trial-tag">
            {PRICING.trialDays}-DAY TRIAL
          </span>
          <h1 className="hero__h1">Unlock VocaLock Premium</h1>
        </div>
      }
      dock={
        <>
          <p className="price__terms">
            Cancel any time from Profile &rarr; Payment Settings
          </p>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={unlock}>
            Start trial for {PRICING.currency}
            {PRICING.trialPrice} &rarr;
          </button>
        </>
      }
    >
      <div className="price-card">
        <div className="price__amount">
          <b>
            {PRICING.currency}
            {PRICING.trialPrice}
          </b>
          <span>today</span>
        </div>
        <div className="price__then">
          then {PRICING.currency}
          {PRICING.monthlyPrice}/month &middot; Cancel anytime
        </div>

        <div className="price-card__rule" />

        {/* Play's subscription rules want the trial and what follows it stated
            plainly, so this is a timeline rather than small print. */}
        <div className="timeline__step">
          <span className="timeline__rail">
            <span className="timeline__dot">&#10003;</span>
            <span className="timeline__line" />
          </span>
          <span className="timeline__body">
            <span className="timeline__label" style={{ display: 'block' }}>
              Today
            </span>
            <span className="timeline__sub" style={{ display: 'block' }}>
              {PRICING.currency}
              {PRICING.trialPrice} for your {PRICING.trialDays}-day trial
            </span>
          </span>
        </div>
        <div className="timeline__step">
          <span className="timeline__rail">
            <span className="timeline__dot timeline__dot--next" />
          </span>
          <span>
            <span className="timeline__label" style={{ display: 'block' }}>
              After {PRICING.trialDays} day{PRICING.trialDays === 1 ? '' : 's'}
            </span>
            <span className="timeline__sub" style={{ display: 'block' }}>
              {PRICING.currency}
              {PRICING.monthlyPrice} every month until you cancel
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
