import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  Listener,
  type ListenerSettings,
  type PermissionStatus,
} from '../plugins';

interface SettingsState {
  settings: ListenerSettings;
  permissions: PermissionStatus;
  serviceRunning: boolean;
  loaded: boolean;

  /** Pull the authoritative copy out of SharedPreferences. */
  hydrate: () => Promise<void>;
  /** Write through to Kotlin first, then mirror into React state. */
  patch: (patch: Partial<ListenerSettings>) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  setServiceRunning: (running: boolean) => void;
  /** Start or stop the foreground service to match `clapEnabled`. */
  syncService: () => Promise<void>;
}

const NO_PERMISSIONS: PermissionStatus = {
  mic: false,
  notifications: false,
  batteryExempt: false,
  overlay: false,
};

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  permissions: NO_PERMISSIONS,
  serviceRunning: false,
  loaded: false,

  hydrate: async () => {
    const [settings, permissions, running] = await Promise.all([
      Listener.getSettings(),
      Listener.getPermissionStatus(),
      Listener.isRunning(),
    ]);
    set({ settings, permissions, serviceRunning: running.running, loaded: true });
  },

  patch: async (patch) => {
    await Listener.setSettings(patch);
    set({ settings: { ...get().settings, ...patch } });
  },

  refreshPermissions: async () => {
    set({ permissions: await Listener.getPermissionStatus() });
  },

  setServiceRunning: (running) => set({ serviceRunning: running }),

  syncService: async () => {
    const { settings } = get();
    const shouldRun = settings.clapEnabled || settings.voiceLockEnabled;
    const { running } = await Listener.isRunning();
    if (shouldRun && !running) await Listener.start();
    if (!shouldRun && running) await Listener.stop();
    set({ serviceRunning: shouldRun });
  },
}));

export function missingPermissionCount(
  permissions: PermissionStatus,
): number {
  return Object.values(permissions).filter((granted) => !granted).length;
}
