import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/auth';
import { ageOf, colors, Icon, IconName, radius, shadow, shared, type } from '../../src/ui';

import { getLang, t } from "../../src/i18n";
import { chooseLanguage, LANG_NAMES } from "../../src/LangSwitch";
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'C';

function Row({ icon, label, value, onPress, danger }: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button">
      <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerSoft }]}>
        <Icon name={icon} size={19} color={danger ? colors.danger : colors.primary} />
      </View>
      <Text style={[type.body, { flex: 1, fontWeight: '600' }, danger && { color: colors.danger }]}>{label}</Text>
      {value && <Text style={type.small}>{value}</Text>}
      {!danger && <Icon name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  );
}

export default function Profile() {
  const { me, signOut } = useAuth();
  const router = useRouter();
  const user = me?.user;

  const facts = [
    user?.birth_date ? t("{a} yosh", { a: ageOf(user.birth_date) }) : null,
    user?.gender === 'male' ? t("Erkak") : user?.gender === 'female' ? t("Ayol") : null,
  ].filter(Boolean).join(' · ');

  const logout = () => Alert.alert(t("Hisobdan chiqasizmi?"), undefined, [
    { text: t("Yo'q"), style: 'cancel' },
    { text: t("Chiqish"), style: 'destructive', onPress: () => { signOut(); } },
  ]);

  return (
    <ScrollView style={shared.screen} contentContainerStyle={{ paddingBottom: 28 }}>
      <View style={styles.head}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(user?.full_name ?? '')}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={type.h2} numberOfLines={1}>{user?.full_name || t("Foydalanuvchi")}</Text>
          <Text style={[type.small, { marginTop: 2 }]}>{user?.phone}</Text>
          {!!facts && <Text style={[type.small, { marginTop: 2 }]}>{facts}</Text>}
        </View>
      </View>

      <View style={styles.group}>
        <Row icon="create-outline" label={t("Shaxsiy ma'lumotlar")} onPress={() => router.push('/profile-edit')} />
        <Row icon="heart-outline" label={t("Sevimli salonlar")} onPress={() => router.push('/favorites')} />
        {me?.workspace !== 'business' && (
          <Row icon="lock-closed-outline" label={t("Parolni almashtirish")} onPress={() => router.push('/change-password')} />
        )}
        <Row icon="settings-outline" label={t("Sozlamalar")} onPress={() => router.push('/settings')} />
      </View>
      <View style={styles.group}>
        <Row icon="language-outline" label={t("Tilingiz")} value={LANG_NAMES[getLang()]} onPress={chooseLanguage} />
        <Row icon="help-circle-outline" label={t("Qo'llab-quvvatlash")} onPress={() => router.push('/settings')} />
      </View>
      <View style={styles.group}>
        <Row icon="log-out-outline" label={t("Chiqish")} danger onPress={logout} />
      </View>
      <Text style={[type.small, { textAlign: 'center', marginTop: 8 }]}>{t("Chronix · Vaqtingiz – bizning ustuvorligimiz")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: radius.lg, padding: 16,
    marginBottom: 14, ...shadow,
  },
  avatar: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 23, fontWeight: '800' },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: 12, marginBottom: 14, ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
