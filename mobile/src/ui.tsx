import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

export const colors = {
  primary: '#1565F5',
  navy: '#010D49',
  danger: '#b3261e',
  text: '#1c1c1e',
  muted: '#6b6b70',
  line: '#e4e4e7',
  card: '#ffffff',
  background: '#f5f5f7',
};

export function Button({ title, onPress, kind = 'primary', busy, disabled }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'outline' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={[styles.button, kind === 'outline' && styles.outline, kind === 'danger' && styles.danger, off && styles.off]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'outline' ? colors.primary : '#fff'} />
      ) : (
        <Text style={[styles.buttonText, kind === 'outline' && { color: colors.primary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...props} style={styles.input} />
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

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={{ color: active ? '#fff' : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export const Empty = ({ text }: { text: string }) => <Text style={styles.empty}>{text}</Text>;
export const ErrorText = ({ text }: { text: string | null }) =>
  text ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{text}</Text> : null;

export const money = (value: number) => `${value.toLocaleString('ru-RU')} so'm`;

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

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 6 },
  heading: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 16, marginBottom: 8 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gap: { gap: 8 },
});

const styles = StyleSheet.create({
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  off: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  label: { color: colors.muted, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 16, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 32 },
});
