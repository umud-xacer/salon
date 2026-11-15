// Chronix dizayn tokenlari (tasdiqlangan prototip, 2026-11-16): yorug' va tungi palitra, rejimni saqlash.
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { ImageStyle, StyleSheet, TextStyle, useColorScheme, ViewStyle } from 'react-native';

import { getItem, setItemAsync } from './secure';

export type Palette = {
  bg: string; surface: string; surface2: string; text: string; muted: string; line: string;
  accent: string; accentSoft: string; accent2: string; onAccent: string;
  success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string;
  star: string; hot: string; cta: string; ctaText: string; off: string;
  glass: string; glassLine: string; overlay: string; shadow: string;
  hero: readonly [string, string, string]; perk: readonly [string, string]; avatar: readonly [string, string];
  segment: string; segmentOn: string;
};

export const light: Palette = {
  bg: '#F5F6F8', surface: '#FFFFFF', surface2: '#F7F8FA', text: '#0E1116', muted: '#5B6474', line: '#E7E9EE',
  accent: '#1A5CE6', accentSoft: '#EAF1FF', accent2: '#6D4BD1', onAccent: '#FFFFFF',
  success: '#0B7A50', successSoft: '#E6F4EC', warning: '#B26A00', warningSoft: '#FFF3DF', danger: '#C62828', dangerSoft: '#FDECEC',
  star: '#B7791F', hot: '#E5484D', cta: '#0E1116', ctaText: '#FFFFFF', off: '#B8BEC9',
  glass: 'rgba(255,255,255,0.82)', glassLine: 'rgba(14,17,22,0.06)', overlay: 'rgba(11,13,18,0.45)', shadow: '#1E285A',
  hero: ['#1A5CE6', '#5B3BD9', '#8A4FD8'], perk: ['#6D4BD1', '#D0508A'], avatar: ['#1A5CE6', '#6D4BD1'],
  segment: '#E8EBF0', segmentOn: '#FFFFFF',
};

export const dark: Palette = {
  bg: '#0B0D12', surface: '#161A22', surface2: '#1E2330', text: '#F2F4F8', muted: '#9AA3B2', line: '#262B36',
  accent: '#7FA2FF', accentSoft: 'rgba(127,162,255,0.14)', accent2: '#9C82FF', onAccent: '#0B0D12',
  success: '#5FD3A2', successSoft: 'rgba(95,211,162,0.12)', warning: '#F5B83D', warningSoft: 'rgba(245,184,61,0.12)',
  danger: '#FF7A7A', dangerSoft: 'rgba(255,122,122,0.12)',
  star: '#F5B83D', hot: '#FF6B5A', cta: '#F2F4F8', ctaText: '#0B0D12', off: '#3A404D',
  glass: 'rgba(22,26,34,0.74)', glassLine: 'rgba(255,255,255,0.08)', overlay: 'rgba(0,0,0,0.6)', shadow: '#000000',
  hero: ['#1B2A6B', '#2A1F66', '#0B0D12'], perk: ['#5B3BD9', '#B0447A'], avatar: ['#3566FF', '#7B4BFF'],
  segment: '#161A22', segmentOn: '#2A303C',
};

export type Mode = 'system' | 'light' | 'dark';
const KEY = 'chronix_theme';

type Theme = { c: Palette; dark: boolean; mode: Mode; setMode: (m: Mode) => void };
const ThemeContext = createContext<Theme>({ c: light, dark: false, mode: 'system', setMode: () => {} });

function savedMode(): Mode {
  try {
    const v = getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>(savedMode);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    setItemAsync(KEY, m).catch(() => {});
  }, []);
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo(() => ({ c: isDark ? dark : light, dark: isDark, mode, setMode }), [isDark, mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Temaga bog'liq uslublar: `const useStyles = makeStyles((c) => ({...}))`, komponentda `const s = useStyles()` */
type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;
export function makeStyles<T extends Styles>(factory: (c: Palette, isDark: boolean) => T & Styles) {
  const cache = new WeakMap<Palette, T>();
  return function useStyles(): T {
    const { c, dark: isDark } = useTheme();
    let styles = cache.get(c);
    if (!styles) {
      styles = StyleSheet.create(factory(c, isDark));
      cache.set(c, styles);
    }
    return styles;
  };
}
