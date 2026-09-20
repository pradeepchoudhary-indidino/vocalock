import type { PluginListenerHandle } from '@capacitor/core';

export type Sensitivity = 'low' | 'med' | 'high';

/** Which bundled Vosk model spots the phrases. */
export type Language = 'en' | 'hi';

/**
 * Mirrors the SharedPreferences document the Kotlin ListenerService reads.
 * The WebView is never the only holder of these values — see spec section 3.
 */
export interface ListenerSettings {
  clapEnabled: boolean;
  sensitivity: Sensitivity;
  clapsRequired: number;
  whistleEnabled: boolean;
  onlyWhenScreenOff: boolean;
  ring: boolean;
  vibrate: boolean;
  flashlight: boolean;
  ringtone: string;
  alertDurationSec: number;
  voiceLockEnabled: boolean;
  /** Enter lock task mode when locking. Android prompts every time. */
  blockNotificationShade: boolean;
  language: Language;
  lockPhrase: string;
  unlockPhrase: string;
  isLocked: boolean;
}

export const DEFAULT_SETTINGS: ListenerSettings = {
  clapEnabled: false,
  sensitivity: 'med',
  clapsRequired: 2,
  whistleEnabled: true,
  onlyWhenScreenOff: true,
  ring: true,
  vibrate: true,
  flashlight: true,
  ringtone: 'default',
  alertDurationSec: 30,
  voiceLockEnabled: false,
  blockNotificationShade: false,
  language: 'en',
  lockPhrase: '',
  unlockPhrase: '',
  isLocked: false,
};

export type PermissionName = 'mic' | 'notifications' | 'batteryExempt' | 'overlay';

export interface PermissionStatus {
  mic: boolean;
  notifications: boolean;
  batteryExempt: boolean;
  overlay: boolean;
}

export type AlertTrigger = 'clap' | 'whistle' | 'test';
export type AlertStopReason = 'button' | 'notification' | 'timeout';

export interface CalibrationLevelEvent {
  /** Frame amplitude, 0..1. Emitted ~20x per second. */
  level: number;
}

export interface ClapDetectedEvent {
  /** How many claps have landed inside the current detection window. */
  count: number;
  /** Device uptime millis when the clap was heard. */
  at: number;
}

export interface AlertFiredEvent {
  trigger: AlertTrigger;
}

export interface AlertStoppedEvent {
  how: AlertStopReason;
}

export interface ServiceStateEvent {
  running: boolean;
}

export interface LockStateEvent {
  locked: boolean;
  /** Present on unlock: how the user got out. */
  how?: 'voice' | 'pin';
}

export interface PhraseCheckResultEvent {
  /** True when the offline model actually recognised the candidate phrase. */
  heard: boolean;
}

export interface PhraseHeardEvent {
  phrase: 'lock' | 'unlock';
  text: string;
}

export interface ListenerPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;

  setSettings(settings: Partial<ListenerSettings>): Promise<void>;
  getSettings(): Promise<ListenerSettings>;

  testAlert(): Promise<void>;

  startCalibration(): Promise<void>;
  stopCalibration(): Promise<void>;

  getPermissionStatus(): Promise<PermissionStatus>;
  requestPermission(options: { name: PermissionName }): Promise<PermissionStatus>;
  openBatterySettings(): Promise<void>;
  openOverlaySettings(): Promise<void>;

  /** The raw PIN is hashed in Kotlin and must not be retained in JS state. */
  setPin(options: { pin: string }): Promise<void>;
  hasPin(): Promise<{ hasPin: boolean }>;
  clearPin(): Promise<void>;

  /**
   * Arms the offline model with one candidate phrase and listens for it, so
   * setup can prove the phrase is spottable before saving it. Resolves
   * immediately; the answer arrives as a `phraseCheckResult` event.
   */
  startPhraseCheck(options: { phrase: string; language: Language }): Promise<void>;
  stopPhraseCheck(): Promise<void>;

  /** Raises the native lock overlay; used by "Try it" in the setup flow. */
  lock(): Promise<void>;
  unlock(): Promise<void>;
  isLocked(): Promise<{ locked: boolean }>;

  addListener(
    eventName: 'calibrationLevel',
    listener: (event: CalibrationLevelEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'clapDetected',
    listener: (event: ClapDetectedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'alertFired',
    listener: (event: AlertFiredEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'alertStopped',
    listener: (event: AlertStoppedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'serviceState',
    listener: (event: ServiceStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'lockState',
    listener: (event: LockStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'phraseCheckResult',
    listener: (event: PhraseCheckResultEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'phraseHeard',
    listener: (event: PhraseHeardEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

// ---------- VoiceSetupPlugin ----------

export interface TranscriptEvent {
  text: string;
}

export interface CaptureErrorEvent {
  /** Human-readable; already mapped from SpeechRecognizer's error codes. */
  message: string;
  code: number;
}

export interface VoiceSetupPlugin {
  /**
   * Runs Android's SpeechRecognizer for one utterance. Never the browser's Web
   * Speech API — it is unreliable inside the Android WebView (spec 4.1).
   */
  startCapture(options: { language: string }): Promise<void>;
  stopCapture(): Promise<void>;
  isAvailable(): Promise<{ available: boolean }>;

  addListener(
    eventName: 'partialTranscript',
    listener: (event: TranscriptEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'finalTranscript',
    listener: (event: TranscriptEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'captureError',
    listener: (event: CaptureErrorEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
