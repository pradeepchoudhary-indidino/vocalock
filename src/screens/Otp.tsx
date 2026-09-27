import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { track } from '../lib/analytics';
import { OTP_LENGTH, requestOtp, verifyOtp } from '../lib/api';
import { usePremium } from '../store/account';

/** Screen 2b. Code entry. */
export function Otp() {
  const navigate = useNavigate();
  const location = useLocation();
  const signIn = usePremium((s) => s.signIn);
  const phone = (location.state as { phone?: string } | null)?.phone;

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const inputRef = useRef<HTMLInputElement>(null);

  // Landing here without a number (reload, deep link) has nothing to verify.
  useEffect(() => {
    if (!phone) navigate('/login', { replace: true });
  }, [phone, navigate]);

  useEffect(() => {
    inputRef.current?.focus();
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const submit = async (value: string) => {
    if (!phone || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = await verifyOtp(phone, value);
      await signIn(session);
      track('login_success', { method: 'otp' });
      navigate('/paywall', { replace: true });
    } catch (err) {
      setCode('');
      setError(err instanceof Error ? err.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  };

  const onChange = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(next);
    setError('');
    if (next.length === OTP_LENGTH) void submit(next);
  };

  return (
    <Screen
      hero={
        <>
          <NavBar title="" backTo="/login" />
          <div className="hero__centre">
            <div className="hero-illo">&#128274;</div>
            <h1 className="hero__h1">Enter the code</h1>
            <p className="hero__sub">Sent to {phone}</p>
          </div>
        </>
      }
      dock={
        <button
          className="btn btn--primary"
          type="button"
          disabled={code.length !== OTP_LENGTH || busy}
          onClick={() => void submit(code)}
        >
          {busy ? 'Checking…' : 'Verify'}
        </button>
      }
    >
      {/* One real input behind the boxes: it keeps SMS autofill and the numeric
          keypad working, which per-digit inputs famously break. */}
      <div
        className="otp-row"
        onClick={() => inputRef.current?.focus()}
        role="presentation"
      >
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <div key={i} className={`otp-box${code.length === i ? ' otp-box--active' : ''}`}>
            {code[i] ?? ''}
          </div>
        ))}
        <input
          ref={inputRef}
          className="otp-input"
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={code}
          aria-label="Verification code"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      <div className="field-error">{error}</div>

      <button
        className="text-btn"
        type="button"
        disabled={secondsLeft > 0}
        onClick={() => {
          if (!phone) return;
          void requestOtp(phone);
          setSecondsLeft(30);
          track('login_otp_sent', { resend: true });
        }}
      >
        {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
      </button>
    </Screen>
  );
}
