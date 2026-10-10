import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

/**
 * Razorpay Checkout, through the hosted page on indidino.com.
 *
 * The Razorpay account is registered to that website, so checkout must run
 * there rather than inside the app's WebView. The page takes the checkout
 * options as `?data=` JSON, opens Razorpay, and reports the result back.
 *
 * On the phone it opens in a Chrome Custom Tab, not the WebView: card payments
 * open the bank's OTP page as a popup, which a WebView cannot show, and a real
 * browser also hands UPI links to the UPI apps. After paying, the page sends
 * the browser to RETURN_URL, which Android routes back into this app.
 *
 * In a desktop browser (`npm run dev`) the page opens as a popup instead and
 * answers with postMessage.
 */
const PAGE_URL = 'https://beatai.indidino.com/vocalock/index.html';
const PAGE_ORIGIN = new URL(PAGE_URL).origin;
/** Must match the intent-filter on MainActivity in AndroidManifest.xml. */
const RETURN_URL = 'com.indidino.vocalock://payment-return';

export interface CheckoutResult {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}

/**
 * The user left checkout without a confirmed payment. Not an error worth
 * showing — but a payment may still have gone through (the app can lose the
 * redirect), so the caller re-checks the entitlement before giving up.
 */
export class CheckoutDismissed extends Error {
  constructor() {
    super('Payment cancelled');
  }
}

interface CheckoutOptions {
  keyId: string;
  subscriptionId: string;
  email: string | null;
}

function pageUrl(opts: CheckoutOptions, callback?: string): string {
  const data = {
    key: opts.keyId,
    subscription_id: opts.subscriptionId,
    name: 'VocaLock',
    description: 'Premium, renews every 30 days',
    theme: { color: '#1565C0' },
    // Checkout asks for the mobile number itself; UPI needs one anyway.
    ...(opts.email ? { prefill: { email: opts.email } } : {}),
  };
  const params = new URLSearchParams({ data: JSON.stringify(data) });
  if (callback) params.set('callback', callback);
  return `${PAGE_URL}?${params.toString()}`;
}

export function openSubscriptionCheckout(opts: CheckoutOptions): Promise<CheckoutResult> {
  return Capacitor.isNativePlatform() ? checkoutInCustomTab(opts) : checkoutInPopup(opts);
}

function checkoutInCustomTab(opts: CheckoutOptions): Promise<CheckoutResult> {
  return new Promise<CheckoutResult>((resolve, reject) => {
    const handles: Promise<PluginListenerHandle>[] = [];
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      handles.forEach((h) => void h.then((l) => l.remove()));
      outcome();
    };

    handles.push(
      App.addListener('appUrlOpen', ({ url }) => {
        if (!url.startsWith(RETURN_URL)) return;
        const params = new URL(url).searchParams;
        const paymentId = params.get('payment_id') ?? '';
        const signature = params.get('signature') ?? '';
        void Browser.close().catch(() => undefined);
        finish(() =>
          paymentId && signature
            ? // The page reports order_id, which a subscription does not have;
              // the server checks the signature against the id it created.
              resolve({ paymentId, signature, subscriptionId: opts.subscriptionId })
            : reject(new CheckoutDismissed()),
        );
      }),
    );
    handles.push(
      Browser.addListener('browserFinished', () => {
        // The tab also closes on the way back after a success; give that
        // appUrlOpen a moment to land first.
        window.setTimeout(() => finish(() => reject(new CheckoutDismissed())), 1500);
      }),
    );

    Browser.open({ url: pageUrl(opts, RETURN_URL), toolbarColor: '#1565C0' }).catch((error) =>
      finish(() =>
        reject(error instanceof Error ? error : new Error('Could not open the payment page.')),
      ),
    );
  });
}

function checkoutInPopup(opts: CheckoutOptions): Promise<CheckoutResult> {
  return new Promise<CheckoutResult>((resolve, reject) => {
    const popup = window.open(pageUrl(opts), 'vocalock-payment', 'width=480,height=760');
    if (!popup) {
      reject(new Error('Allow pop-ups for this site to open the payment page.'));
      return;
    }

    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedPoll);
      outcome();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== PAGE_ORIGIN || event.data?.source !== 'vocalock') return;
      if (event.data.type === 'razorpay_success') {
        finish(() =>
          resolve({
            paymentId: String(event.data.payment_id ?? ''),
            signature: String(event.data.signature ?? ''),
            subscriptionId: opts.subscriptionId,
          }),
        );
      } else if (event.data.type === 'razorpay_dismissed') {
        finish(() => reject(new CheckoutDismissed()));
      }
    };
    window.addEventListener('message', onMessage);
    // Closing the popup window itself sends no message.
    const closedPoll = window.setInterval(() => {
      if (popup.closed) window.setTimeout(() => finish(() => reject(new CheckoutDismissed())), 500);
    }, 500);
  });
}
