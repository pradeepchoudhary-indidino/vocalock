import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.indidino.vocalock',
  appName: 'VocaLock',
  webDir: 'dist',
  android: {
    // Keep the WebView opaque so the native LockOverlay / AlertActivity
    // are the only things that ever draw over the app.
    backgroundColor: '#F4F7FD',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#F4F7FD',
    },
  },
};

export default config;
