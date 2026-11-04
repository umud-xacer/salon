// Chronix dizayn tizimi: ranglar, radiuslar, soyalar, matn uslublari va umumiy bloklar.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps,
  View,
} from 'react-native';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export const colors = {
  primary: '#1565F5',
  primaryDark: '#0D4CC4',
  primarySoft: '#E8F0FF',
  navy: '#010D49',
  danger: '#C62828',
  dangerSoft: '#FDECEC',
  success: '#12845A',
  successSoft: '#E5F6EF',
  warning: '#B26A00',
  star: '#F5A623',
  text: '#14161F',
  muted: '#6C7080',
  line: '#E6E8EF',
  card: '#FFFFFF',
  background: '#F4F6FB',
};

export const radius = { sm: 10, md: 12, lg: 16, xl: 20, pill: 999 };

export const shadow = Platform.select({
  android: { elevation: 3 },
  default: { shadowColor: '#0B1B4D', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});

export const type = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700', color: colors.text },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.muted },
});

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function Button({ title, onPress, kind = 'primary', busy, disabled, icon, compact }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'outline' | 'danger' | 'soft';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  compact?: boolean;
}) {
  const off = busy || disabled;
  const tint = kind === 'outline' || kind === 'soft' ? colors.primary : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button, compact && styles.compact, kind === 'outline' && styles.outline, kind === 'danger' && styles.danger,
        kind === 'soft' && styles.soft, off && styles.off, pressed && !off && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={tint} /> : (
        <>
          {icon && <Icon name={icon} size={compact ? 16 : 18} color={tint} />}
          <Text style={[styles.buttonText, compact && { fontSize: 14 }, { color: tint }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  // Parol maydonida o'ng tomonda "ko'z": bosilsa parol ochiq ko'rinadi
  const [shown, setShown] = useState(false);
  const secret = !!props.secureTextEntry;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <View>
        <TextInput placeholderTextColor={colors.muted} {...props} secureTextEntry={secret && !shown}
          style={[styles.input, secret && { paddingRight: 48 }, props.editable === false && styles.inputOff]} />
        {secret && (
          <Pressable onPress={() => setShown(!shown)} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={shown ? 'Parolni yashirish' : "Parolni ko'rsatish"}
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {hint && <Text style={[type.small, { marginTop: 4 }]}>{hint}</Text>}
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.card}>
      {children}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, icon }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityState={{ selected: active }}>
      {icon && <Icon name={icon} size={16} color={active ? '#fff' : colors.primary} />}
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

/** Teng kenglikdagi bo'limlar: Faol, Tarix, Bekor qilingan */
export function Segments<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <View style={styles.segments}>
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.segment, value === o.id && styles.segmentOn]}
          accessibilityState={{ selected: value === o.id }}>
          <Text numberOfLines={1} style={{ fontWeight: '600', fontSize: 13, color: value === o.id ? colors.primary : colors.muted }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
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
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCircle}><Icon name={icon} size={44} color={colors.primary} /></View>
      <Text style={[type.h3, { textAlign: 'center' }]}>{title}</Text>
      {text && <Text style={[type.small, { textAlign: 'center', marginTop: 6 }]}>{text}</Text>}
      {action && onAction && <View style={{ marginTop: 18 }}><Button title={action} onPress={onAction} /></View>}
    </View>
  );
}

export const Empty = ({ text }: { text: string }) => <Text style={styles.emptyText}>{text}</Text>;

export const ErrorText = ({ text }: { text: string | null }) =>
  text ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{text}</Text> : null;

/** Pastdan chiquvchi oyna. Ko'rinishi animatsiyali, foni bosilsa yopiladi */
export function BottomSheet({ visible, title, onClose, children }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const y = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    if (visible) {
      y.setValue(500);
      Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
    }
  }, [visible, y]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Yopish" />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: y }] }]}>
        <View style={styles.grabber} />
        <Text style={[type.h2, { marginBottom: 14 }]}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </Animated.View>
    </Modal>
  );
}

export const money = (value: number) => `${value.toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`;

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

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 6 },
  heading: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gap: { gap: 8 },
});

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  compact: { paddingVertical: 9, paddingHorizontal: 12 },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  soft: { backgroundColor: colors.primarySoft },
  off: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, marginBottom: 6, fontSize: 14 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 13, fontSize: 16,
    color: colors.text,
  },
  inputOff: { backgroundColor: colors.background, color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginBottom: 12, ...shadow },
  chip: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: radius.pill, paddingVertical: 9,
    paddingHorizontal: 14, marginRight: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segments: { flexDirection: 'row', backgroundColor: '#E9ECF4', borderRadius: radius.md, padding: 4, marginBottom: 12 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  segmentOn: { backgroundColor: colors.card, ...shadow },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  emptyCircle: {
    width: 104, height: 104, borderRadius: 52, backgroundColor: colors.primarySoft, alignItems: 'center',
    justifyContent: 'center', marginBottom: 16,
  },
  emptyText: { color: colors.muted, textAlign: 'center', marginTop: 32 },
  backdrop: { flex: 1, backgroundColor: 'rgba(1,13,73,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%', backgroundColor: colors.card, padding: 18,
    paddingBottom: 26, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 12 },
});
