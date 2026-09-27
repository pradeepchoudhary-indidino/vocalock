import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Bullet } from '../components/Controls';
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
          <div className="hero-illo">&#128274;</div>
          <span className="trial-tag">
            {PRICING.trialDays}-DAY TRIAL
          </span>
          <h1 className="hero__h1">Unlock VocaLock Premium</h1>
        </div>
      }
      dock={
        <>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={unlock}>
            Unlock Now
          </button>
          <button className="text-btn" type="button" onClick={() => navigate('/home', { replace: true })}>
            Maybe later
          </button>
        </>
      }
    >
      <PaywallVideo remoteUrl={PRICING.paywallVideoUrl} />

      <div className="price">
        <div className="price__big">
          {PRICING.currency}
          {PRICING.trialPrice} today
        </div>
        <div className="price__then">
          then {PRICING.currency}
          {PRICING.monthlyPrice}/month &middot; Cancel anytime
        </div>
      </div>

      {/* Play's subscription rules require the trial length in plain words. */}
      <p className="price__terms">
        Your {PRICING.trialDays}-day trial costs {PRICING.currency}
        {PRICING.trialPrice}. After {PRICING.trialDays} days it renews at {PRICING.currency}
        {PRICING.monthlyPrice} every month until you cancel. Cancel any time from
        Profile &rarr; Payment Settings.
      </p>

      <div className="bullets">
        <Bullet>Clap to find your phone &mdash; rings even on silent</Bullet>
        <Bullet>Lock your screen with your own voice phrase</Bullet>
        <Bullet>Works offline &mdash; audio never leaves your phone</Bullet>
        <Bullet>Flashlight strobe and vibration so you spot it in the dark</Bullet>
      </div>


    </Screen>
  );
}
