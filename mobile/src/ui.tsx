// Chronix dizayn tizimi (prototip 2026-11-16): tema tokenlari src/theme.tsx da, bu yerda umumiy bloklar.
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ComponentProps, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, Modal, Platform, Pressable, PressableProps, ScrollView, ScrollViewProps, StatusBar as RNStatusBar, StyleProp,
  Text, TextInput, TextInputProps, TextStyle, useWindowDimensions, View, ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from './i18n';
import { font, light, makeStyles, Palette, useTheme } from './theme';

export { font, makeStyles, useTheme } from './theme';
export type IconName = ComponentProps<typeof Ionicons>['name'];

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, xxl: 28, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const shadowOf = (c: Palette, level: 1 | 2 = 1): ViewStyle => Platform.select({
  android: { elevation: level === 1 ? 2 : 8, shadowColor: c.shadow },
  default: {
    shadowColor: c.shadow, shadowOpacity: level === 1 ? 0.06 : 0.16, shadowRadius: level === 1 ? 10 : 24,
    shadowOffset: { width: 0, height: level === 1 ? 4 : 12 },
  },
}) as ViewStyle;

/** Matn ierarxiyasi (Inter o'rniga tizim shrifti — og'irliklar prototipdagidek) */
export const useType = makeStyles((c) => ({
  display: { fontSize: 28, fontWeight: '800', color: c.text, letterSpacing: -0.8, lineHeight: 34 },
  h1: { fontSize: 26, fontWeight: '700', color: c.text, letterSpacing: -0.6, lineHeight: 32 },
  h2: { fontSize: 20, fontWeight: '700', color: c.text, letterSpacing: -0.5, lineHeight: 26 },
  h3: { fontSize: 16, fontWeight: '700', color: c.text, letterSpacing: -0.5, lineHeight: 22 },
  body: { fontSize: 15, color: c.text, letterSpacing: -0.5, lineHeight: 22 },
  small: { fontSize: 13, color: c.muted, letterSpacing: -0.3, lineHeight: 18 },
  tiny: { fontSize: 12, color: c.muted, fontWeight: '600', letterSpacing: -0.3 },
  caps: { fontSize: 12, color: c.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  link: { fontSize: 13, color: c.accent, fontWeight: '600', letterSpacing: -0.5 },
}));

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { c } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? c.text} />;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Bosilganda prujina bilan biroz kichrayadi (prototipdagi .press). Uslub (kenglik, flex) bosiladigan elementning o'zida */
export function Pressy({ style, children, scaleTo = 0.97, ...props }: PressableProps & {
  style?: StyleProp<ViewStyle>; children?: ReactNode; scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: Platform.OS !== 'web', speed: 40, bounciness: 6 }).start();
  return (
    <AnimatedPressable {...props} style={[style, { transform: [{ scale }] }]}
      onPressIn={(e) => { to(scaleTo); props.onPressIn?.(e); }}
      onPressOut={(e) => { to(1); props.onPressOut?.(e); }}>
      {children}
    </AnimatedPressable>
  );
}

export function Gradient({ colors, style, children, diagonal = true }: {
  colors: readonly [string, string, ...string[]]; style?: StyleProp<ViewStyle>; children?: ReactNode; diagonal?: boolean;
}) {
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={diagonal ? { x: 1, y: 1 } : { x: 0, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

/** Shisha sirt: haqiqiy blur (iOS, Android 12+) va ustida tema rangi */
export function Glass({ style, children, intensity = 40, tint }: {
  style?: StyleProp<ViewStyle>; children?: ReactNode; intensity?: number; tint?: string;
}) {
  const { c, dark } = useTheme();
  return (
    <View style={[{ overflow: 'hidden', borderWidth: 1, borderColor: c.glassLine }, style]}>
      <BlurView intensity={intensity} tint={dark ? 'dark' : 'light'} blurMethod="dimezisBlurViewSdk31Plus"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: tint ?? c.glass }} />
      {children}
    </View>
  );
}

export function Avatar({ name, photo, size = 48, colors }: {
  name: string; photo?: string | null; size?: number; colors?: readonly [string, string];
}) {
  const { c } = useTheme();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (photo) return <Image source={{ uri: photo }} style={box} />;
  return (
    <Gradient colors={colors ?? c.avatar} style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.34, ...font('700') }}>{initials}</Text>
    </Gradient>
  );
}

export function IconButton({ icon, onPress, label, badge, glass, size = 44 }: {
  icon: IconName; onPress: () => void; label: string; badge?: number | boolean; glass?: boolean; size?: number;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const body = (
    <>
      <Icon name={icon} size={20} color={glass ? '#FFFFFF' : c.text} />
      {!!badge && (
        <View style={[s.badge, typeof badge !== 'number' && s.badgeDot]}>
          {typeof badge === 'number' && <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>}
        </View>
      )}
    </>
  );
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} scaleTo={0.92}
      style={[s.iconBtn, { width: size, height: size }, glass && s.iconBtnGlass]}>
      {body}
    </Pressy>
  );
}

export function Button({ title, onPress, kind = 'primary', busy, disabled, icon, compact }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'accent' | 'outline' | 'danger' | 'soft' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  compact?: boolean;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const off = busy || disabled;
  const look: Record<string, [string, string, string]> = {          // fon, matn, chegara
    primary: [c.cta, c.ctaText, c.cta],
    accent: [c.accent, c.onAccent, c.accent],
    outline: [c.bg, c.text, c.line],
    danger: [c.dangerSoft, c.danger, c.dangerSoft],
    soft: [c.accentSoft, c.accent, c.accentSoft],
    ghost: ['transparent', c.muted, 'transparent'],
  };
  const [bg, fg, border] = off && (kind === 'primary' || kind === 'accent') ? [c.off, c.ctaText, c.off] : look[kind];
  return (
    <Pressy accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} onPress={onPress} disabled={off}
      style={[s.button, compact && s.compact, { backgroundColor: bg, borderColor: border }]}>
      {busy ? <ActivityIndicator color={fg} /> : (
        <>
          {icon && <Icon name={icon} size={compact ? 16 : 19} color={fg} />}
          <Text style={[s.buttonText, compact && { fontSize: 14 }, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressy>
  );
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [shown, setShown] = useState(false);
  const [focus, setFocus] = useState(false);
  const secret = !!props.secureTextEntry;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={[s.field, focus && { borderColor: c.accent }, props.editable === false && { backgroundColor: c.surface2 }]}>
        <Text style={s.fieldLabel}>{label}</Text>
        <TextInput placeholderTextColor={c.muted} {...props} secureTextEntry={secret && !shown}
          onFocus={(e) => { setFocus(true); props.onFocus?.(e); }} onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
          style={[s.input, secret && { paddingRight: 40 }, props.editable === false && { color: c.muted }, style]} />
        {secret && (
          <Pressable onPress={() => setShown(!shown)} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={shown ? t("Parolni yashirish") : t("Parolni ko'rsatish")} style={s.eye}>
            <Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.muted} />
          </Pressable>
        )}
      </View>
      {hint && <Text style={[ty.small, { marginTop: 5, marginLeft: 4 }]}>{hint}</Text>}
    </View>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  if (!onPress) return <View style={[s.card, style]}>{children}</View>;
  return <Pressy onPress={onPress} style={[s.card, style]}>{children}</Pressy>;
}

export function Chip({ label, active, onPress, icon }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <Pressy onPress={onPress} scaleTo={0.95} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={[s.chip, active && { backgroundColor: c.cta, borderColor: c.cta }]}>
      {icon && <Icon name={icon} size={16} color={active ? c.ctaText : c.accent} />}
      {/* Uzun yorliq (xizmat nomi · vaqt · narx) tor ekranda kartadan chiqib ketmaydi: ikki qatorga o'tadi */}
      <Text style={{ color: active ? c.ctaText : c.text, fontSize: 14, flexShrink: 1, letterSpacing: -0.5, ...font('600') }}>{label}</Text>
    </Pressy>
  );
}

/** Teng kenglikdagi bo'limlar: Faol, Tarix, Bekor qilingan */
export function Segments<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.segments}>
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => onChange(o.id)} style={[s.segment, value === o.id && s.segmentOn]}
          accessibilityRole="tab" accessibilityState={{ selected: value === o.id }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={{ fontSize: 14, color: value === o.id ? c.text : c.muted, letterSpacing: -0.5, ...font('600') }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Bosqich chiziqlari (kirish oqimi, bron) */
export function Steps({ step, total }: { step: number; total: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 6 }} accessibilityLabel={t("{a}-bosqich, {b} tadan", { a: step, b: total })}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < step ? c.accent : c.line }} />
      ))}
    </View>
  );
}

/** Ostki chiziqli tablar (Figma: salon sahifasi, qidiruv kunlari) — gorizontal suriladi */
export function UnderlineTabs<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 22 }}>
        {options.map((o) => {
          const on = value === o.id;
          return (
            <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={{ paddingTop: 10, paddingBottom: 10, borderBottomWidth: 3, borderBottomColor: on ? c.text : 'transparent', marginBottom: -1 }}>
              <Text style={{ fontSize: 15, letterSpacing: -0.5, color: on ? c.text : c.muted, ...font(on ? '700' : '400') }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Bo'lim sarlavhasi va o'ngda havola ("Hammasi") */
export function SectionHeader({ title, sub, action, onAction, style }: {
  title: string; sub?: ReactNode; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle>;
}) {
  const ty = useType();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }, style]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={ty.h2} accessibilityRole="header">{title}</Text>
        {sub ? <Text style={ty.small}>{sub}</Text> : null}
      </View>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button"><Text style={ty.link}>{action}</Text></Pressable>
      )}
    </View>
  );
}

/** Ochiq/yopiq kabi kichik holat yorlig'i */
export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'success' | 'warning' | 'danger' | 'hot' }) {
  const { c } = useTheme();
  const map = {
    accent: [c.accentSoft, c.accent], success: [c.successSoft, c.success], warning: [c.warningSoft, c.warning],
    danger: [c.dangerSoft, c.danger], hot: [c.hot, '#FFFFFF'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, ...font('700') }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, text, action, onAction }: {
  icon: IconName;
  title: string;
  text?: string;
  action?: string;
  onAction?: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  return (
    <View style={s.empty}>
      <View style={s.emptyCircle}><Icon name={icon} size={42} color={c.accent} /></View>
      <Text style={[ty.h3, { textAlign: 'center' }]}>{title}</Text>
      {text && <Text style={[ty.small, { textAlign: 'center', marginTop: 6 }]}>{text}</Text>}
      {action && onAction && <View style={{ marginTop: 18, alignSelf: 'stretch' }}><Button title={action} onPress={onAction} /></View>}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const { c } = useTheme();
  return <Text style={{ color: c.muted, textAlign: 'center', marginTop: 32 }}>{text}</Text>;
}

export function ErrorText({ text }: { text: string | null }) {
  const { c } = useTheme();
  return text ? <Text style={{ color: c.danger, marginBottom: 10 }} accessibilityLiveRegion="polite">{text}</Text> : null;
}

/** Ekran pastidagi xavfsiz masofa: tizim tugmalari / imo-ishora chizig'i balandligi + qo'shimcha bo'shliq.
 *  Android'da ilova chetdan-chetga chiziladi, shuning uchun pastki kontent tizim paneli ostida qolmasligi kerak. */
export function useBottomSpace(extra = 24) {
  return useSafeAreaInsets().bottom + extra;
}

/** Tab ekranlari pastidagi bo'shliq (menyu endi kontent ostida emas, alohida qator) */
/** Ekran yuqorisidagi xavfsiz bo'shliq: status bar (soat, batareya) ostiga tushmaslik uchun.
 *  Ba'zi Android qurilmalarda birinchi kadrda insets.top 0 bo'ladi — StatusBar.currentHeight zaxira. */
export function useTopInset(extra = 0) {
  const insets = useSafeAreaInsets();
  const bar = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 0;
  return Math.max(insets.top, bar) + extra;
}

export function useTabSpace() {
  return 28;
}

/** Stack ekranlari uchun skroll: yon chetlar bir xil, oxirgi element tizim paneli ostida qolmaydi */
export function ScreenScroll({ children, contentContainerStyle, style, ...props }: ScrollViewProps) {
  const bottom = useBottomSpace();
  const { c } = useTheme();
  return (
    <ScrollView style={[{ flex: 1, backgroundColor: c.bg }, style]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
      {...props} contentContainerStyle={[{ padding: 16, paddingBottom: bottom }, contentContainerStyle]}>
      {children}
    </ScrollView>
  );
}

/** Pastdan chiquvchi oyna: prujinali ochilish, foni bosilsa yopiladi.
 *  Balandligi ekranga moslashadi: kontent ichkarida skroll bo'ladi, `footer` (tugmalar) esa doim pastda,
 *  tizim panelidan xavfsiz masofada qotib turadi. */
export function BottomSheet({ visible, title, onClose, children, footer, header }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
}) {
  const y = useRef(new Animated.Value(800)).current;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const s = useStyles();
  const ty = useType();

  useEffect(() => {
    if (visible) {
      y.setValue(800);
      Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180, mass: 0.9 }).start();
    }
  }, [visible, y]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t("Yopish")} />
      <Animated.View style={[s.sheet, {
        maxHeight: height - insets.top - 24, paddingBottom: Math.max(insets.bottom, 8) + 16, transform: [{ translateY: y }],
      }]}>
        <View style={s.grabber} />
        {header ?? <Text style={[ty.h2, { marginBottom: 14 }]}>{title}</Text>}
        <ScrollView style={s.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
        {footer && <View style={s.sheetFooter}>{footer}</View>}
      </Animated.View>
    </Modal>
  );
}

/** Ro'yxat elementlari pastdan sekin ko'tarilib chiqadi (prototipdagi .fade) */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** 901234567 -> "90 123 45 67" */
export const formatPhone = (digits: string) =>
  [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(' ');

export const money = (value: number) => t("{a} so'm", { a: value.toLocaleString('ru-RU').replace(/[, ]/g, ' ') });

// Bizneslar hozircha faqat O'zbekistonda (UTC+5, yozgi vaqt yo'q)
const TZ_MS = 5 * 3600 * 1000;
const shifted = (iso: string) => new Date(new Date(iso).getTime() + TZ_MS).toISOString();
export const dayOf = (iso: string) => shifted(iso).slice(0, 10);
export const timeOf = (iso: string) => shifted(iso).slice(11, 16);
export const dateTimeOf = (iso: string) => {
  const [, m, d] = dayOf(iso).split('-');
  return `${d}.${m} ${timeOf(iso)}`;
};
export const nextDays = (count: number) =>
  Array.from({ length: count }, (_, i) => dayOf(new Date(Date.now() + i * 86400000).toISOString()));

/** "1995-02-03" -> yosh */
export function ageOf(birthDate: string) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  const before = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  return now.getFullYear() - y - (before ? 1 : 0);
}

/** "03.02.1995" kiritilgan matnni "1995-02-03" ga aylantiradi. Xato bo'lsa null */
export function parseBirthDate(text: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
  if (+y < 1900 || date.getTime() > Date.now()) return null;
  return `${y}-${mo}-${d}`;
}

export const showBirthDate = (iso: string) => iso.split('-').reverse().join('.');

/** Raqam kiritilgan sari nuqtalar qo'yiladi: 03021995 -> 03.02.1995 */
export function maskBirthDate(text: string) {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('.');
}

/** Umumiy matn/qator uslublari (temaga bog'liq) */
export const useShared = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg, padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: c.text, marginBottom: 6, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '800', color: c.text, marginTop: 18, marginBottom: 10, letterSpacing: -0.2 },
  name: { fontSize: 16, fontWeight: '700', color: c.text },
  muted: { color: c.muted, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gap: { gap: 10 },
}));

/** @deprecated faqat tema kontekstidan tashqaridagi joylar uchun (splash, bildirishnoma) */
export const colors = {
  primary: light.accent, text: light.text, muted: light.muted, background: light.bg, card: light.surface,
  line: light.line, danger: light.danger, success: light.success, star: light.star, navy: '#010D49',
};

const useStyles = makeStyles((c, isDark) => ({
  button: {
    minHeight: 52, borderRadius: radius.pill, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1,
  },
  compact: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 16 },
  buttonText: { fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'center', letterSpacing: -0.5 },
  field: {
    backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.line, borderRadius: radius.lg, paddingHorizontal: 14,
    paddingTop: 9, paddingBottom: 4,
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { fontSize: 16, fontWeight: '600', color: c.text, paddingVertical: Platform.OS === 'ios' ? 8 : 4, paddingHorizontal: 0 },
  eye: { position: 'absolute', right: 4, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: c.surface, borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.line,
  },
  chip: {
    borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, borderRadius: radius.pill, paddingVertical: 9,
    paddingHorizontal: 16, marginRight: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
    maxWidth: '100%',
  },
  segments: { flexDirection: 'row', backgroundColor: c.segment, borderRadius: radius.md, padding: 4, marginBottom: 12 },
  segment: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 11 },
  segmentOn: { backgroundColor: c.segmentOn, ...shadowOf(c) },
  iconBtn: {
    borderRadius: radius.pill, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnGlass: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.28)' },
  badge: {
    position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9,
    backgroundColor: '#FF5A5F', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: isDark ? c.bg : '#FFFFFF',
  },
  badgeDot: { minWidth: 12, width: 12, height: 12, top: 7, right: 8, paddingHorizontal: 0 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  emptyCircle: {
    width: 100, height: 100, borderRadius: 34, backgroundColor: c.accentSoft, alignItems: 'center',
    justifyContent: 'center', marginBottom: 16,
  },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%', backgroundColor: c.surface, padding: 20,
    paddingBottom: 26, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, ...shadowOf(c, 2),
  },
  sheetBody: { flexGrow: 0, flexShrink: 1 },
  sheetFooter: { gap: 8, paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: c.line },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 14 },
}));

export type { TextStyle };
