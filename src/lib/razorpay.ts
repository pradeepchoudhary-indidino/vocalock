/**
 * Razorpay Standard Checkout, run inside the WebView.
 *
 * The script is loaded on demand from Razorpay's CDN rather than bundled: it is
 * the one part of the app that is online-only by nature, and Razorpay requires
 * it be served from checkout.razorpay.com.
 *
 * UPI apps open through `upi://` links, which Capacitor's WebView client hands
 * to Android as an ACTION_VIEW intent; `webview_intent` tells Checkout to offer
 * that flow.
 */
const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export interface CheckoutResult {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}

/** The user closed Checkout without paying. Not an error worth showing. */
export class CheckoutDismissed extends Error {
  constructor() {
    super('Payment cancelled');
  }
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null; // let the next tap retry
      script.remove();
      reject(new Error('Could not reach the payment page. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openSubscriptionCheckout(opts: {
  keyId: string;
  subscriptionId: string;
  email: string | null;
}): Promise<CheckoutResult> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Payment page failed to load.');

  return new Promise<CheckoutResult>((resolve, reject) => {
    new Razorpay({
      key: opts.keyId,
      subscription_id: opts.subscriptionId,
      name: 'VocaLock',
      description: 'Premium, renews every 30 days',
      // Checkout asks for the mobile number itself; UPI needs one anyway.
      ...(opts.email ? { prefill: { email: opts.email } } : {}),
      theme: { color: '#1565C0' },
      webview_intent: true,
      handler: (response: RazorpayResponse) =>
        resolve({
          paymentId: response.razorpay_payment_id,
          subscriptionId: response.razorpay_subscription_id,
          signature: response.razorpay_signature,
        }),
      // A failed attempt keeps Checkout open for a retry, so the only exit
      // without a payment is the user closing it.
      modal: { ondismiss: () => reject(new CheckoutDismissed()) },
    }).open();
  });
}
