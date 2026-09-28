import { WebPlugin } from '@capacitor/core';
import {
  DEFAULT_SETTINGS,
  type ListenerPlugin,
  type ListenerSettings,
  type PermissionStatus,
} from './definitions';

const MOCK_SETTINGS_KEY = 'vocalock.mock.settings';

/**
 * Browser mock so every screen can be built and checked with `npm run dev`
 * (spec hard rule 2). Nothing here runs on a device: on Android the calls go
 * to the Kotlin ListenerPlugin instead.
 */
export class ListenerPluginWeb extends WebPlugin implements ListenerPlugin {
  private running = false;
  private calibrationTimer: number | null = null;
  private clapTimer: number | null = null;
  private alertTimer: number | null = null;
  private phase = 0;

  async start(): Promise<void> {
    this.running = true;
    this.notifyListeners('serviceState', { running: true });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.notifyListeners('serviceState', { running: false });
  }

  async isRunning(): Promise<{ running: boolean }> {
    return { running: this.running };
  }

  async getInsets(): Promise<{ top: number; bottom: number; keyboard: number }> {
    // The browser resizes the viewport itself, so there is no inset to report.
    return { top: 0, bottom: 0, keyboard: 0 };
  }

  async setSettings(settings: Partial<ListenerSettings>): Promise<void> {
    const merged = { ...(await this.getSettings()), ...settings };
    localStorage.setItem(MOCK_SETTINGS_KEY, JSON.stringify(merged));
  }

  async getSettings(): Promise<ListenerSettings> {
    try {
      const raw = localStorage.getItem(MOCK_SETTINGS_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      // Private browsing or blocked site data — fall through to defaults.
    }
    return { ...DEFAULT_SETTINGS };
  }

  async testAlert(): Promise<void> {
    this.notifyListeners('alertFired', { trigger: 'test' });
    this.showMockAlert();
  }

  async startCalibration(): Promise<void> {
    this.stopMockTimers();
    // ~20 amplitude frames per second, same rate the service emits.
    this.calibrationTimer = window.setInterval(() => {
      this.phase += 0.35;
      const base = 0.18 + 0.1 * Math.sin(this.phase);
      const level = Math.min(1, Math.max(0, base + Math.random() * 0.12));
      this.notifyListeners('calibrationLevel', { level });
    }, 50);

    let count = 0;
    this.clapTimer = window.setInterval(() => {
      count += 1;
      // Spike the meter so the bar graph visibly reacts to the fake clap.
      this.notifyListeners('calibrationLevel', { level: 0.95 });
      this.notifyListeners('clapDetected', { count, at: Date.now() });
    }, 4000);
  }

  async stopCalibration(): Promise<void> {
    this.stopMockTimers();
  }

  async getPermissionStatus(): Promise<PermissionStatus> {
    return { mic: true, notifications: true, batteryExempt: true, overlay: true };
  }

  async requestPermission(): Promise<PermissionStatus> {
    return this.getPermissionStatus();
  }

  async openBatterySettings(): Promise<void> {
    console.info('[ListenerPlugin mock] openBatterySettings()');
  }

  async openOverlaySettings(): Promise<void> {
    console.info('[ListenerPlugin mock] openOverlaySettings()');
  }

  async setPin(): Promise<void> {
    localStorage.setItem('vocalock.mock.hasPin', 'true');
  }

  async hasPin(): Promise<{ hasPin: boolean }> {
    return { hasPin: localStorage.getItem('vocalock.mock.hasPin') === 'true' };
  }

  async startPhraseCheck(options: { phrase: string }): Promise<void> {
    // Mimic the device: a short listen, then a verdict. Phrases containing
    // "karo" fail, so the unhappy path can be exercised in a browser too.
    const spottable = !/\bkaro\b/i.test(options.phrase);
    window.setTimeout(
      () => this.notifyListeners('phraseCheckResult', { heard: spottable }),
      1600,
    );
  }

  async stopPhraseCheck(): Promise<void> {
    // Nothing to cancel in the mock.
  }

  async clearPin(): Promise<void> {
    localStorage.removeItem('vocalock.mock.hasPin');
  }

  async lock(): Promise<void> {
    await this.setSettings({ isLocked: true });
    this.notifyListeners('lockState', { locked: true });
    this.showMockLock();
  }

  async isDeviceLockAvailable(): Promise<{ active: boolean }> {
    // The browser has no device admin, so the mock always takes the overlay
    // path — which is the branch that needs exercising in a browser anyway.
    return { active: localStorage.getItem('vocalock.mock.deviceAdmin') === 'true' };
  }

  async requestDeviceLock(): Promise<{ opened: boolean }> {
    localStorage.setItem('vocalock.mock.deviceAdmin', 'true');
    return { opened: true };
  }

  async releaseDeviceLock(): Promise<void> {
    localStorage.removeItem('vocalock.mock.deviceAdmin');
  }

  async isLocked(): Promise<{ locked: boolean }> {
    return { locked: (await this.getSettings()).isLocked };
  }

  async unlock(): Promise<void> {
    await this.setSettings({ isLocked: false });
    document.getElementById('mock-lock')?.remove();
    this.notifyListeners('lockState', { locked: false, how: 'pin' });
  }

  private stopMockTimers() {
    if (this.calibrationTimer !== null) window.clearInterval(this.calibrationTimer);
    if (this.clapTimer !== null) window.clearInterval(this.clapTimer);
    this.calibrationTimer = null;
    this.clapTimer = null;
  }

  /** Stand-in for the native LockOverlay (spec 4.6). */
  private showMockLock() {
    if (document.getElementById('mock-lock')) return;
    const host = document.createElement('div');
    host.id = 'mock-lock';
    host.className = 'mock-lock';
    const clock = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    host.innerHTML = `
      <div class="mock-lock__clock">${clock}</div>
      <div style="font-size:15px;opacity:.75">Say your unlock phrase</div>
      <div style="font-size:12px;opacity:.5;margin-top:18px">
        Web mock of the native lock overlay
      </div>
      <button class="mock-alert__stop" type="button" style="margin-top:22px">
        Unlock
      </button>
    `;
    host.querySelector('button')!.addEventListener('click', () => void this.unlock());
    document.body.appendChild(host);
  }

  /** Stand-in for the native AlertActivity (screen 12). */
  private showMockAlert() {
    if (document.getElementById('mock-alert')) return;
    const host = document.createElement('div');
    host.id = 'mock-alert';
    host.className = 'mock-alert';
    host.innerHTML = `
      <div class="mock-alert__bell">&#128276;</div>
      <div class="mock-alert__title">Phone found</div>
      <div class="mock-alert__note">Web mock of the native alert screen</div>
      <button class="mock-alert__stop" type="button">Stop alert</button>
      <div class="mock-alert__count"></div>
    `;
    document.body.appendChild(host);

    let left = 10;
    const countEl = host.querySelector<HTMLElement>('.mock-alert__count')!;
    countEl.textContent = `Stops in ${left}s`;

    const close = (how: 'button' | 'timeout') => {
      if (this.alertTimer !== null) window.clearInterval(this.alertTimer);
      this.alertTimer = null;
      host.remove();
      this.notifyListeners('alertStopped', { how });
    };

    host.querySelector('.mock-alert__stop')!.addEventListener('click', () => close('button'));
    this.alertTimer = window.setInterval(() => {
      left -= 1;
      countEl.textContent = `Stops in ${left}s`;
      if (left <= 0) close('timeout');
    }, 1000);
  }
}
