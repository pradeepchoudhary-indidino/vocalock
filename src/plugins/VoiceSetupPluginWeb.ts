import { WebPlugin } from '@capacitor/core';
import type { VoiceSetupPlugin } from './definitions';

/** Canned phrases so the setup flow can be walked through in a browser. */
const SAMPLES = [
  'lock my phone now',
  'open sesame please',
  'keep it safe',
  'let me back in',
];

/**
 * Browser mock. It types a phrase out word by word to imitate the partial /
 * final transcript stream Android's SpeechRecognizer produces.
 */
export class VoiceSetupPluginWeb extends WebPlugin implements VoiceSetupPlugin {
  private timer: number | null = null;
  private index = 0;

  async isAvailable(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async startCapture(): Promise<void> {
    this.stopTimer();
    const phrase = SAMPLES[this.index % SAMPLES.length];
    this.index += 1;

    const words = phrase.split(' ');
    let spoken = 0;
    this.timer = window.setInterval(() => {
      spoken += 1;
      if (spoken < words.length) {
        this.notifyListeners('partialTranscript', {
          text: words.slice(0, spoken).join(' '),
        });
      } else {
        this.stopTimer();
        this.notifyListeners('finalTranscript', { text: phrase });
      }
    }, 420);
  }

  async stopCapture(): Promise<void> {
    this.stopTimer();
  }

  private stopTimer() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}
