import type { Language } from '../plugins';

/** Devanagari block — the script Hindi speech recognition returns. */
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Which bundled Vosk model should spot a phrase, decided from the phrase
 * itself rather than from a picker.
 *
 * Script is the reliable signal: the Hindi model's vocabulary is Devanagari, so
 * "बंद करो" needs it and "lock my screen" does not. Latin text is treated as
 * English even when the words are Hindi ("band karo"), because that is exactly
 * what the English model can and cannot hear — a transliterated phrase fails
 * against both models, and the setup check is what catches it.
 */
export function detectLanguage(text: string): Language {
  return DEVANAGARI.test(text) ? 'hi' : 'en';
}

/**
 * The speech-recognition locale to capture with, taken from the device.
 * A phone set to Hindi gets Devanagari back; anything else gets Indian English.
 */
export function deviceSpeechTag(): string {
  const locale = (navigator.languages?.[0] ?? navigator.language ?? 'en-IN').toLowerCase();
  return locale.startsWith('hi') ? 'hi-IN' : 'en-IN';
}
