import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { track } from '../lib/analytics';
import { requestOtp } from '../lib/api';

/** Screen 2. Phone number entry. */
export function Login() {
  const navigate = useNavigate();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = /^[6-9]\d{9}$/.test(digits);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    const phone = `+91${digits}`;
    try {
      await requestOtp(phone);
      track('login_otp_sent');
      navigate('/otp', { state: { phone } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      hero={
        <div className="hero__centre">
          <div className="hero-illo">&#128241;</div>
          <h1 className="hero__h1">What&rsquo;s your number?</h1>
          <p className="hero__sub">We&rsquo;ll text you a 4-digit code.</p>
        </div>
      }
      dock={
        <>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!valid || busy}
            onClick={submit}
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <p className="price__terms" style={{ marginTop: 12 }}>
            We use your number to keep your plan with you. Nothing else.
          </p>
        </>
      }
    >
      <div className="phone-field">
        <span className="phone-field__cc">+91</span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          maxLength={10}
          value={digits}
          aria-label="Phone number"
          onChange={(e) => {
            setDigits(e.target.value.replace(/\D/g, '').slice(0, 10));
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </div>

      <div className="field-error">
        {error || (digits.length === 10 && !valid ? 'That does not look like an Indian mobile number.' : '')}
      </div>
    </Screen>
  );
}
