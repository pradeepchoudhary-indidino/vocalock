import { registerPlugin } from '@capacitor/core';
import type { ListenerPlugin, VoiceSetupPlugin } from './definitions';

export const Listener = registerPlugin<ListenerPlugin>('ListenerPlugin', {
  web: () => import('./ListenerPluginWeb').then((m) => new m.ListenerPluginWeb()),
});

export const VoiceSetup = registerPlugin<VoiceSetupPlugin>('VoiceSetupPlugin', {
  web: () => import('./VoiceSetupPluginWeb').then((m) => new m.VoiceSetupPluginWeb()),
});

export * from './definitions';
