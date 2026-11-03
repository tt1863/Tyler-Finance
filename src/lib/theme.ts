import { useEffect, useState } from 'react';
import { STORAGE_KEY } from './preview';

/**
 * Color themes. Each sets the accent colors (top bar, menu, buttons, links)
 * for light and dark mode; the rest of the palette comes from styles.css.
 * The choice is saved on this device, like the light/dark setting.
 */

export type Mode = 'system' | 'light' | 'dark';

interface Accent {
  navBg: string;
  navActive: string;
  navText: string;
  primary: string;
  primaryText: string;
}

export interface Theme {
  id: string;
  name: string;
  light: Accent;
  dark: Accent;
}

const W = '#ffffff';

export const THEMES: Theme[] = [
  {
    id: 'classic',
    name: 'Classic',
    light: { navBg: '#1f2a5a', navActive: '#34418a', navText: '#d8ddf2', primary: '#3b5bdb', primaryText: W },
    dark: { navBg: '#161a2e', navActive: '#2a3366', navText: '#d8ddf2', primary: '#5c7cfa', primaryText: W },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: { navBg: '#1d4332', navActive: '#2d6a4f', navText: '#d3eadf', primary: '#2b8a5e', primaryText: W },
    dark: { navBg: '#12261d', navActive: '#1f4a37', navText: '#d3eadf', primary: '#2f9e6b', primaryText: W },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    light: { navBg: '#0b3c49', navActive: '#11596b', navText: '#cdeaf0', primary: '#0b7a91', primaryText: W },
    dark: { navBg: '#0c2228', navActive: '#13414d', navText: '#cdeaf0', primary: '#1592ad', primaryText: W },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    light: { navBg: '#5a1f2b', navActive: '#82303f', navText: '#f6d9dd', primary: '#c2410c', primaryText: W },
    dark: { navBg: '#2a1418', navActive: '#4d222b', navText: '#f6d9dd', primary: '#e8590c', primaryText: W },
  },
  {
    id: 'grape',
    name: 'Grape',
    light: { navBg: '#3b1f5a', navActive: '#57308a', navText: '#e6d8f6', primary: '#7048e8', primaryText: W },
    dark: { navBg: '#1e1430', navActive: '#3a2560', navText: '#e6d8f6', primary: '#845ef7', primaryText: W },
  },
  {
    id: 'rose',
    name: 'Rose',
    light: { navBg: '#5c1a3c', navActive: '#86285a', navText: '#f7d6e6', primary: '#c2255c', primaryText: W },
    dark: { navBg: '#2b1220', navActive: '#4f1f3a', navText: '#f7d6e6', primary: '#e64980', primaryText: W },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    light: { navBg: '#25282e', navActive: '#3a3f48', navText: '#dcdfe5', primary: '#495057', primaryText: W },
    dark: { navBg: '#16181c', navActive: '#2c3038', navText: '#dcdfe5', primary: '#ced4da', primaryText: '#1b1f2e' },
  },
];

export interface ThemePrefs {
  theme: string;
  mode: Mode;
}

const KEY = `${STORAGE_KEY}-theme`;
const DEFAULT: ThemePrefs = { theme: 'classic', mode: 'system' };

export function loadPrefs(): ThemePrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ThemePrefs> | null;
    return {
      theme: THEMES.some((t) => t.id === p?.theme) ? p!.theme! : DEFAULT.theme,
      mode: p?.mode === 'light' || p?.mode === 'dark' ? p.mode : 'system',
    };
  } catch {
    return DEFAULT;
  }
}

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** Light or dark, after resolving "system". */
export const resolvedMode = (mode: Mode): 'light' | 'dark' => (mode === 'system' ? (darkQuery()?.matches ? 'dark' : 'light') : mode);

/** Set the page's colors from the saved (or given) preferences. */
export function applyTheme(prefs: ThemePrefs = loadPrefs()) {
  const root = document.documentElement;
  const mode = resolvedMode(prefs.mode);
  const theme = THEMES.find((t) => t.id === prefs.theme) ?? THEMES[0];
  const a = theme[mode];
  root.dataset.mode = mode;
  root.style.setProperty('--nav-bg', a.navBg);
  root.style.setProperty('--nav-active', a.navActive);
  root.style.setProperty('--nav-text', a.navText);
  root.style.setProperty('--primary', a.primary);
  root.style.setProperty('--primary-text', a.primaryText);
  // Phone status bar / browser chrome.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.navBg);
}

let listening = false;
/** Apply now, and again when the phone switches between light and dark. */
export function initTheme() {
  applyTheme();
  if (listening) return;
  listening = true;
  darkQuery()?.addEventListener('change', () => applyTheme());
}

export function useThemePrefs(): [ThemePrefs, (p: ThemePrefs) => void] {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => applyTheme(prefs), [prefs]);
  return [
    prefs,
    (p) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(p));
      } catch {
        // Private browsing: still applies for this visit.
      }
      setPrefs(p);
    },
  ];
}
