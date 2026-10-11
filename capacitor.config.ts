import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.indidino.vocalock',
  appName: 'VocaLock',
  webDir: 'dist',
  android: {
    // Keep the WebView opaque so the native LockOverlay / AlertActivity
    // are the only things that ever draw over the app. This is the light-theme
    // ground (--bg); MainActivity repaints it for a phone in dark mode.
    backgroundColor: '#EEF4FC',
  },
  plugins: {
    // Google only. Facebook's SDK would add the AD_ID permission Play then asks
    // about. Apple stays on although unused: on Android it is just
    // androidx.browser, and switching it off makes that compile-only, which
    // clashes with the older copy Google's browser helper pulls in.
    SocialLogin: {
      providers: { google: true, facebook: false, apple: true, twitter: false },
    },
  },
};

export default config;
