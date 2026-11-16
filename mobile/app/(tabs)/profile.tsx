// Profil (prototip "11"): shaxsiy karta va statistika, sevimlilar, sozlamalar (mavzu, Face ID, til), chiqish.
import { useFocusEffect, useRouter } from 'expo-router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Appointment, BusinessCard, MyLoyalty } from '../../src/api';
import { useAuth } from '../../src/auth';
import { bioCheck, bioKind, bioLockEnabled, setBioAsked, setBioLock } from '../../src/biometric';
import { useFavorites } from '../../src/favorites';
import { getLang, pick, t } from '../../src/i18n';
import { chooseLanguage, LANG_NAMES } from '../../src/LangSwitch';
import {
  ageOf, Avatar, Gradient, Icon, IconButton, IconName, makeStyles, Pressy, SectionHeader, useTabSpace, useTheme, useType,
} from '../../src/ui';

function Row({ icon, label, value, onPress, right, danger }: {
  icon: IconName; label: string; value?: string; onPress?: () => void; right?: ReactNode; danger?: boolean;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={s.row} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[s.rowIcon, danger && { backgroundColor: c.dangerSoft }]}>
        <Icon name={icon} size={19} color={danger ? c.danger : c.accent} />
      </View>
      <Text style={[ty.body, { flex: 1, fontWeight: '600' }, danger && { color: c.danger }]}>{label}</Text>
      {value && <Text style={ty.small}>{value}</Text>}
      {right ?? (!danger && onPress && <Icon name="chevron-forward" size={18} color={c.muted} />)}
    </Pressable>
  );
}

export default function Profile() {
  const { me, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabSpace();
  const { c, dark, setMode } = useTheme();
  const s = useStyles();
  const ty = useType();
  const favorites = useFavorites();
  const user = me?.user;
  const [mine, setMine] = useState<Appointment[]>([]);
  const [favs, setFavs] = useState<BusinessCard[]>([]);
  const [loyalty, setLoyalty] = useState<MyLoyalty[]>([]);
  const [bio, setBio] = useState<'face' | 'finger' | null>(null);
  const [lock, setLock] = useState(bioLockEnabled);

  useEffect(() => {
    bioKind().then(setBio);
  }, []);

  useFocusEffect(useCallback(() => {
    api<Appointment[]>('/appointments/mine?upcoming=false').then(setMine).catch(() => {});
    api<BusinessCard[]>('/me/favorites').then(setFavs).catch(() => {});
    api<MyLoyalty[]>('/me/loyalty').then(setLoyalty).catch(() => {});
  }, []));
  const readyBonus = loyalty.filter((l) => l.ready).length;
  const bonusText = readyBonus > 0 ? t("{a} ta tayyor", { a: readyBonus }) : loyalty.length > 0 ? t("{a} ta seriya", { a: loyalty.length }) : undefined;

  const facts = [
    user?.phone,
    user?.birth_date ? t("{a} yosh", { a: ageOf(user.birth_date) }) : null,
  ].filter(Boolean).join(' · ');
  const visits = mine.filter((a) => a.status === 'completed').length;
  const reviews = mine.filter((a) => a.review_rating != null).length;

  const toggleLock = async (on: boolean) => {
    if (on && !(await bioCheck())) return;
    setLock(on);
    await setBioLock(on);
    await setBioAsked();
  };

  const logout = () => Alert.alert(t("Hisobdan chiqasizmi?"), undefined, [
    { text: t("Yo'q"), style: 'cancel' },
    { text: t("Chiqish"), style: 'destructive', onPress: () => { void signOut(); } },
  ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: tabSpace }}>
      <View style={[s.blob, { backgroundColor: c.accentSoft }]} />
      <View style={s.pad}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={ty.display}>{t("Profil")}</Text>
          <IconButton icon={dark ? 'sunny-outline' : 'moon-outline'} label={t("Rejimni almashtirish")}
            onPress={() => setMode(dark ? 'light' : 'dark')} />
        </View>

        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={user?.full_name || '?'} size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={ty.h2} numberOfLines={1}>{user?.full_name || t("Foydalanuvchi")}</Text>
              <Text style={[ty.small, { marginTop: 2 }]}>{facts}</Text>
            </View>
            <IconButton icon="create-outline" label={t("Shaxsiy ma'lumotlar")} size={40} onPress={() => router.push('/profile-edit')} />
          </View>
          <View style={s.stats}>
            {[[visits, t("Tashrif")], [favorites.count, t("Sevimli")], [reviews, t("Sharh")]].map(([v, k]) => (
              <View key={String(k)} style={s.stat}>
                <Text style={s.statValue}>{v}</Text>
                <Text style={ty.tiny}>{k}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {favs.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <SectionHeader title={t("Sevimlilar")} action={t("Hammasi")} onAction={() => router.push('/favorites')} style={s.pad} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingTop: 12 }}>
            {favs.slice(0, 8).map((b) => (
              <Pressy key={b.id} style={s.fav} accessibilityRole="button"
                onPress={() => router.push({ pathname: '/business/[slug]', params: { slug: b.slug } })}>
                <View style={s.favTop}>
                  {b.photos?.[0] ? <Image source={{ uri: b.photos[0] }} style={s.fill} /> : <Gradient colors={c.avatar} style={s.fill} />}
                  <View style={s.heart}><Icon name="heart" size={15} color="#E0245E" /></View>
                </View>
                <View style={{ padding: 10, gap: 2 }}>
                  <Text style={ty.h3} numberOfLines={1}>{b.name}</Text>
                  <Text style={ty.tiny} numberOfLines={1}>
                    {b.rating_count > 0 ? `★ ${b.rating_avg.toFixed(1)} · ` : ''}{pick(b.category_name, b.category_name_ru)}
                  </Text>
                </View>
              </Pressy>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={[s.pad, { marginTop: 22, gap: 10 }]}>
        <Text style={ty.h2}>{t("Sozlamalar")}</Text>
        <View style={s.group}>
          <Row icon="ribbon-outline" label={t("Bonuslarim")} value={bonusText} onPress={() => router.push('/bonuses')} />
        </View>
        <View style={s.group}>
          <Row icon="notifications-outline" label={t("Bildirishnomalar")} onPress={() => router.push('/inbox')} />
          <Row icon="alarm-outline" label={t("Eslatmalar va ovoz")} onPress={() => router.push('/settings')} />
          {bio && (
            <Row icon={bio === 'face' ? 'scan-outline' : 'finger-print-outline'} label={bio === 'face' ? t("Face ID bilan kirish") : t("Barmoq izi bilan kirish")}
              right={<Switch value={lock} trackColor={{ true: c.accent }} onValueChange={(on) => { void toggleLock(on); }} />} />
          )}
          <Row icon={dark ? 'moon-outline' : 'sunny-outline'} label={t("Mavzu")} value={dark ? t("Tungi") : t("Kunduzgi")}
            onPress={() => router.push('/settings')} />
          <Row icon="language-outline" label={t("Til")} value={LANG_NAMES[getLang()]} onPress={chooseLanguage} />
        </View>
        <View style={s.group}>
          <Row icon="heart-outline" label={t("Sevimli muassasalar")} onPress={() => router.push('/favorites')} />
          {me?.workspace !== 'business' && (
            <Row icon="lock-closed-outline" label={t("Parolni almashtirish")} onPress={() => router.push('/change-password')} />
          )}
          <Row icon="help-circle-outline" label={t("Yordam va aloqa")} onPress={() => router.push('/settings')} />
        </View>
        <View style={s.group}>
          <Row icon="log-out-outline" label={t("Chiqish")} danger onPress={logout} />
        </View>
        <Text style={[ty.small, { textAlign: 'center', marginTop: 4 }]}>{t("Chronix · Vaqtingiz – bizning ustuvorligimiz")}</Text>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  pad: { paddingHorizontal: 16 },
  blob: { position: 'absolute', width: 380, height: 380, borderRadius: 190, left: -90, top: -200 },
  card: { marginTop: 16, padding: 18, borderRadius: 26, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 16 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, backgroundColor: c.surface2, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800', color: c.text },
  fav: { width: 150, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
  favTop: { height: 86, backgroundColor: c.line },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heart: { position: 'absolute', right: 8, top: 8, width: 28, height: 28, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  group: { borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
}));
