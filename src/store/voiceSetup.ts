import { create } from 'zustand';
import type { Language } from '../plugins';

interface VoiceSetupState {
  language: Language;
  lockPhrase: string;
  unlockPhrase: string;
  setLanguage: (language: Language) => void;
  setLockPhrase: (phrase: string) => void;
  setUnlockPhrase: (phrase: string) => void;
  reset: () => void;
}

/** In-progress setup only. The committed phrases live in SharedPreferences. */
export const useVoiceSetup = create<VoiceSetupState>((set) => ({
  language: 'en',
  lockPhrase: '',
  unlockPhrase: '',
  setLanguage: (language) => set({ language }),
  setLockPhrase: (lockPhrase) => set({ lockPhrase }),
  setUnlockPhrase: (unlockPhrase) => set({ unlockPhrase }),
  // Language is deliberately kept: it is a property of the speaker, not of a
  // particular attempt, so restarting setup should not silently reset it.
  reset: () => set({ lockPhrase: '', unlockPhrase: '' }),
}));

/**
 * Lowercase, strip punctuation, collapse whitespace — matches the Kotlin side.
 *
 * \p{M} matters: Devanagari vowel signs and anusvara are combining marks, not
 * letters, so a letters-only filter turns "करो" into "कर" and "बंद" into "बद" —
 * words no Hindi model has ever seen.
 */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(text: string): number {
  const normalized = normalizePhrase(text);
  return normalized === '' ? 0 : normalized.split(' ').length;
}

/** Must mirror PhraseSpotter.toleranceFor() in Kotlin. */
function toleranceFor(phrase: string): number {
  return Math.min(3, Math.max(1, Math.floor(phrase.length * 0.2)));
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/**
 * Whether the matcher could confuse these two phrases.
 *
 * "lock now" and "unlock now" are two edits apart — close enough that saying
 * one was being treated as a near-miss of the other. Setup refuses such a pair
 * rather than letting the user find out later that half of voice lock is dead.
 *
 * Must mirror PhraseSpotter.tooSimilar() in Kotlin.
 */
export function tooSimilar(a: string, b: string): boolean {
  const na = normalizePhrase(a);
  const nb = normalizePhrase(b);
  if (!na || !nb) return true;
  // One phrase wholly inside the other is confusable however far apart they are
  // by edit distance: "lock it" is inside "lock it now".
  if (containsWords(na, nb) || containsWords(nb, na)) return true;
  const threshold = Math.max(toleranceFor(na), toleranceFor(nb)) + 1;
  return editDistance(na, nb) <= threshold;
}

/** True when every word of `needle` appears consecutively in `haystack`. */
function containsWords(haystack: string, needle: string): boolean {
  const h = haystack.split(' ');
  const n = needle.split(' ');
  if (n.length === 0 || n.length > h.length) return false;
  for (let start = 0; start <= h.length - n.length; start += 1) {
    if (n.every((word, i) => h[start + i] === word)) return true;
  }
  return false;
}
