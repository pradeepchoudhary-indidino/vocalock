import { useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { NavBar } from '../components/NavBar';
import { Note } from '../components/Controls';
import { PRICING } from '../store/account';

interface Doc {
  title: string;
  body: { heading?: string; text: string }[];
}

/**
 * In-app copies so every screen works offline. The spec also requires publicly
 * hosted versions of these before launch (section 8) — these must be kept in
 * step with whatever is published.
 */
const DOCS: Record<string, Doc> = {
  privacy: {
    title: 'Privacy Policy',
    body: [
      {
        text: 'VocaLock listens through your microphone so it can hear your claps and your unlock phrase. This is the whole reason the app exists, and we want to be exact about what happens to that audio.',
      },
      {
        heading: 'Audio never leaves your phone',
        text: 'Every sound VocaLock hears is processed on the device, in memory, and thrown away immediately. Nothing is recorded to a file. Nothing is uploaded. No audio is sent to us, to any server, or to any third party. The speech model used to match your phrases is bundled inside the app and runs offline.',
      },
      {
        heading: 'What we do store',
        text: 'VocaLock does not ask you to create an account. Your plan status, your two phrases and your settings are stored on this device and nowhere else. Your backup PIN is never stored: only a salted one-way hash of it, held in Android encrypted storage. We cannot read your PIN and neither can anyone with the file.',
      },
      {
        heading: 'Permissions and why',
        text: 'Microphone: to hear claps and phrases. Notifications: to show the listening notice and the Stop button. Camera: only to switch the flashlight on and off — VocaLock never opens the camera or takes pictures. Battery exemption: so Android does not shut the listener down.',
      },
      {
        heading: 'Contact',
        text: 'Questions about your data: support@indidino.com',
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    body: [
      {
        text: 'By using VocaLock you agree to these terms. Please read the limits section — it matters.',
      },
      {
        heading: 'What VocaLock is',
        text: 'VocaLock is a convenience and focus tool. Voice Lock draws a cover over your screen to help you stay off your phone. It is not a security product and must not be relied on as one.',
      },
      {
        heading: 'Limits you should expect',
        text: 'VocaLock cannot cover the Android system lock screen. It can be got past by anyone who force-stops the app in Android settings. Android may stop the listener to save battery, especially on phones with aggressive power management. Clap and voice detection depend on background noise and will not work every time.',
      },
      {
        heading: 'Subscription',
        text: `Premium costs ${PRICING.currency}${PRICING.trialPrice} for the first ${PRICING.trialDays} days, then ${PRICING.currency}${PRICING.monthlyPrice} each month until cancelled. You can cancel at any time from Profile, Payment Settings. Access continues until the end of the period you have paid for.`,
      },
      {
        heading: 'No warranty',
        text: 'VocaLock is provided as is. We are not liable for a missed call, a missed alarm, a phone you could not find, or anything you could not get to because the screen was covered.',
      },
    ],
  },
  refund: {
    title: 'Refund Policy',
    body: [
      {
        heading: 'Trial',
        text: `The ${PRICING.currency}${PRICING.trialPrice} trial charge is not refundable — it is a nominal amount taken to set up the payment mandate.`,
      },
      {
        heading: 'Monthly charges',
        text: 'If you were charged after cancelling, or charged twice, write to us within 7 days and we will refund it in full. Refunds reach your account in 5 to 7 working days.',
      },
      {
        heading: 'Change of mind',
        text: 'We do not refund part-used months. Cancel before your renewal date and you will not be charged again. You keep Premium until the end of the period you have already paid for.',
      },
      {
        heading: 'How to ask',
        text: 'Email support@indidino.com with the date and amount, and the UPI reference from your payment app.',
      },
    ],
  },
  help: {
    title: 'Help & Support',
    body: [
      {
        heading: 'It stops listening after a while',
        text: 'This is almost always Android power management. Open Permissions in the app and allow the battery exemption. On Xiaomi, Realme, Oppo and Vivo phones, also open recent apps and lock VocaLock so it is not cleared.',
      },
      {
        heading: 'It does not hear my claps',
        text: 'Open Clap to Find, then Calibrate, and clap. If nothing registers, raise the sensitivity a step or lower the number of claps required. Sharp, loud claps with your hands cupped work best.',
      },
      {
        heading: 'It rings on its own',
        text: 'Lower the sensitivity, or ask for three claps instead of two. Turning on "Only when screen is off" also stops it reacting while you are using the phone.',
      },
      {
        heading: 'Nothing happens after I restart my phone',
        text: 'Android does not let an app open the microphone on its own at boot. Open VocaLock once after a restart and it starts listening again.',
      },
      {
        heading: 'I am locked out',
        text: 'Use your backup PIN on the lock screen. If you have forgotten it, force-stop VocaLock from Android Settings, Apps, VocaLock.',
      },
      {
        heading: 'Still stuck',
        text: 'support@indidino.com',
      },
    ],
  },
};

export function Legal() {
  const { doc } = useParams<{ doc: string }>();
  const content = DOCS[doc ?? ''] ?? DOCS.privacy;

  return (
    <Screen hero={<NavBar title={content.title} />}>
      {doc === 'privacy' ? (
        <Note>
          <strong>Audio never leaves your phone.</strong> Everything VocaLock hears is
          processed on the device and discarded.
        </Note>
      ) : null}
      <div className="card">
        <div className="policy-body">
          {content.body.map((section, i) => (
            <div key={i}>
              {section.heading ? <h3>{section.heading}</h3> : null}
              <p>{section.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
