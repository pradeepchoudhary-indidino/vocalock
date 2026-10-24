import { useEffect, useState } from 'react';
import { PRICING } from '../store/account';

/**
 * Settings the server can change without an app release (`GET /config`, see
 * server/src/config.ts). Today that is the paywall video.
 *
 * The last answer is kept in localStorage, so the paywall shows the right media
 * straight away and only a change arrives a moment later. Offline, or before
 * the first answer, the built-in value in PRICING applies.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const CACHE_KEY = 'vocalock.remoteConfig';

export interface RemoteConfig {
  paywallVideoUrl: string | null;
}

const BUILT_IN: RemoteConfig = { paywallVideoUrl: PRICING.paywallVideoUrl || null };

function cached(): RemoteConfig {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...BUILT_IN, ...(JSON.parse(raw) as Partial<RemoteConfig>) } : BUILT_IN;
  } catch {
    return BUILT_IN;
  }
}

let inflight: Promise<RemoteConfig> | null = null;

async function fetchConfig(): Promise<RemoteConfig> {
  if (!API_BASE) return cached();
  inflight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/config`, { cache: 'no-store' });
      if (!response.ok) return cached();
      const fresh = (await response.json()) as Partial<RemoteConfig>;
      const config: RemoteConfig = {
        paywallVideoUrl: typeof fresh.paywallVideoUrl === 'string' ? fresh.paywallVideoUrl : null,
      };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(config));
      } catch {
        // Not cached; asked again next time.
      }
      return config;
    } catch {
      return cached();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The current config: the cached copy at once, the server's when it answers. */
export function useRemoteConfig(): RemoteConfig {
  const [config, setConfig] = useState<RemoteConfig>(cached);
  useEffect(() => {
    let live = true;
    void fetchConfig().then((fresh) => {
      if (live) setConfig(fresh);
    });
    return () => {
      live = false;
    };
  }, []);
  return config;
}
