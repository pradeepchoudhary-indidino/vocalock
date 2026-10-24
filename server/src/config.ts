import { readFile } from 'node:fs/promises';

/**
 * Settings the app reads at runtime, so they change without an app release.
 *
 * Kept in a JSON file on the droplet rather than the database or the code: it
 * is edited by scripts/paywall-video.sh, and read on every request (it is a
 * few bytes), so a change is live the moment the file is written.
 */
const CONFIG_PATH = process.env.APP_CONFIG_PATH ?? '/opt/vocalock/config/app-config.json';

export interface AppConfig {
  /** Explainer video on the paywall; null shows the feature slides instead. */
  paywallVideoUrl: string | null;
}

const DEFAULTS: AppConfig = { paywallVideoUrl: null };

export async function readAppConfig(): Promise<AppConfig> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Partial<AppConfig>;
    const url = typeof raw.paywallVideoUrl === 'string' ? raw.paywallVideoUrl : null;
    // Only https: the app is a WebView on https://localhost and would refuse
    // mixed content anyway, and a typo'd value should fall back, not break.
    return { paywallVideoUrl: url && /^https:\/\//.test(url) ? url : null };
  } catch {
    // No file yet, or a bad edit: the app shows its built-in slides.
    return DEFAULTS;
  }
}
