export type LanguageSetting = 'system' | 'en' | 'de';
export type ThemeSetting = 'system' | 'light' | 'dark';
/** Mouse mapping preset for the 3D view. */
export type NavigationPreset = 'mouse' | 'trackpad';
export type Projection = 'orthographic' | 'perspective';

export interface Settings {
  language: LanguageSetting;
  theme: ThemeSetting;
  navigation: NavigationPreset;
  projection: Projection;
  showFrameStats: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  theme: 'system',
  navigation: 'mouse',
  projection: 'orthographic',
  showFrameStats: false,
};

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Turns untrusted input (settings file, IPC payload) into valid settings; unknown fields are dropped. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    language: pick(raw.language, ['system', 'en', 'de'], base.language),
    theme: pick(raw.theme, ['system', 'light', 'dark'], base.theme),
    navigation: pick(raw.navigation, ['mouse', 'trackpad'], base.navigation),
    projection: pick(raw.projection, ['orthographic', 'perspective'], base.projection),
    showFrameStats: typeof raw.showFrameStats === 'boolean' ? raw.showFrameStats : base.showFrameStats,
  };
}
