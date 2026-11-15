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

// Figma "Beauty Booking App — Mobil UI" (2026-11-16) tokenlari: color/bg, surface, border, text-primary/secondary, accent
export const light: Palette = {
  bg: '#FFFFFF', surface: '#FFFFFF', surface2: '#F5F5F7', text: '#111114', muted: '#6E6E78', line: '#E6E6EB',
  accent: '#6B4EFF', accentSoft: '#F0ECFF', accent2: '#6B4EFF', onAccent: '#FFFFFF',
  success: '#1E9E5A', successSoft: '#E8F6EE', warning: '#B26A00', warningSoft: '#FFF3DF', danger: '#D93636', dangerSoft: '#FDECEC',
  star: '#F5A623', hot: '#E5484D', cta: '#111114', ctaText: '#FFFFFF', off: '#C9C9D1',
  glass: 'rgba(255,255,255,0.94)', glassLine: '#E6E6EB', overlay: 'rgba(17,17,20,0.45)', shadow: '#111114',
  hero: ['#E9DED3', '#D7C6B5', '#C7B29E'], perk: ['#6B4EFF', '#9A7BFF'], avatar: ['#E9DED3', '#C7B29E'],
  segment: '#F5F5F7', segmentOn: '#FFFFFF',
};

export const dark: Palette = {
  bg: '#0E0E11', surface: '#18181C', surface2: '#222228', text: '#F4F4F6', muted: '#9C9CA6', line: '#2A2A31',
  accent: '#9A85FF', accentSoft: 'rgba(154,133,255,0.16)', accent2: '#9A85FF', onAccent: '#0E0E11',
  success: '#4CC98A', successSoft: 'rgba(76,201,138,0.14)', warning: '#F5B83D', warningSoft: 'rgba(245,184,61,0.12)',
  danger: '#FF7A7A', dangerSoft: 'rgba(255,122,122,0.12)',
  star: '#F5B83D', hot: '#FF6B5A', cta: '#F4F4F6', ctaText: '#0E0E11', off: '#3A3A42',
  glass: 'rgba(24,24,28,0.94)', glassLine: '#2A2A31', overlay: 'rgba(0,0,0,0.6)', shadow: '#000000',
  hero: ['#2A2622', '#3A332C', '#4A4036'], perk: ['#6B4EFF', '#9A7BFF'], avatar: ['#3A332C', '#4A4036'],
  segment: '#18181C', segmentOn: '#2A2A31',
};

/** Plus Jakarta Sans: Android'da fontWeight shrift tanlamaydi — har og'irlik o'z fayli */
export const FONTS: Record<string, string> = {
  '400': 'PlusJakartaSans_400Regular', normal: 'PlusJakartaSans_400Regular', '500': 'PlusJakartaSans_500Medium',
  '600': 'PlusJakartaSans_600SemiBold', '700': 'PlusJakartaSans_700Bold', bold: 'PlusJakartaSans_700Bold',
  '800': 'PlusJakartaSans_800ExtraBold', '900': 'PlusJakartaSans_800ExtraBold',
};
export const font = (weight: string = '400') => ({ fontFamily: FONTS[weight] ?? FONTS['400'] });

/** Uslubdagi matnlarga shrift: fontWeight bo'lsa mos fayl, fontSize bo'lsa (og'irliksiz) — Regular */
function withFonts<T extends Record<string, object>>(styles: T): T {
  const out: Record<string, object> = {};
  for (const [k, v] of Object.entries(styles)) {
    const st = v as { fontWeight?: string; fontSize?: number; fontFamily?: string; letterSpacing?: number };
    if (st.fontFamily || (st.fontWeight === undefined && st.fontSize === undefined)) out[k] = v;
    else {
      const { fontWeight, ...rest } = st;
      out[k] = { letterSpacing: -0.3, ...rest, ...font(fontWeight ?? '400') };
    }
  }
  return out as T;
}

export type Mode = 'system' | 'light' | 'dark';
const KEY = 'chronix_theme';

type Theme = { c: Palette; dark: boolean; mode: Mode; setMode: (m: Mode) => void };
const ThemeContext = createContext<Theme>({ c: light, dark: false, mode: 'system', setMode: () => {} });

function savedMode(): Mode {
  try {
    const v = getItem(KEY);
    return v === 'system' || v === 'dark' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<Mode>(savedMode);   // standart: kunduzgi (Figma)
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
      styles = StyleSheet.create(withFonts(factory(c, isDark)));
      cache.set(c, styles);
    }
    return styles;
  };
}
