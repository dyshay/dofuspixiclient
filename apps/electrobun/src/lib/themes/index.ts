import type { Theme, ThemeColors, ThemeMetrics, ThemeLayout, ThemeFonts } from './types';

let activeTheme: Theme | null = null;

function parseColors(obj: unknown): unknown {
  if (typeof obj === 'string' && /^0x[0-9a-fA-F]+$/.test(obj)) {
    return Number(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(parseColors);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = parseColors(value);
    }
    return result;
  }
  return obj;
}

export async function loadTheme(name: string): Promise<void> {
  const response = await fetch(`/themes/${name}/theme.json`);
  const raw = await response.json();
  const parsed = parseColors(raw) as Theme;
  activeTheme = parsed;
}

function ensureLoaded(): Theme {
  if (!activeTheme) {
    throw new Error('Theme not loaded. Call loadTheme() before accessing theme.');
  }
  return activeTheme;
}

export function getTheme(): Theme {
  return ensureLoaded();
}

export function getColors(): ThemeColors {
  return ensureLoaded().colors;
}

export function getMetrics(): ThemeMetrics {
  return ensureLoaded().metrics;
}

export function getLayout(): ThemeLayout {
  return ensureLoaded().layout;
}

export function getFonts(): ThemeFonts {
  return ensureLoaded().fonts;
}

export function getAssetPath(path: string): string {
  return `${ensureLoaded().assets.basePath}/${path}`;
}
