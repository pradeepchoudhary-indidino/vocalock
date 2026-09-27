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
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#EEF4FC',
    },
  },
};

export default config;
