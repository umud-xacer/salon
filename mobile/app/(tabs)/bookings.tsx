// Mening bronlarim (prototip "10"): kelgusi / tarix / bekor qilingan; ko'chirish, bekor qilish, yo'nalish, baholash.
import { track } from '../../src/analytics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Linking, Platform, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, Appointment } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useAuthGate } from '../../src/authGate';
import { pickList, t } from '../../src/i18n';
import { cancelBookingReminder } from '../../src/localReminders';
import {
  Badge, Button, dateTimeOf, dayOf, EmptyState, FadeIn, Icon, makeStyles, money, Segments, timeOf, useTabSpace, useTheme, useType,
} from '../../src/ui';

type Tab = 'active' | 'history' | 'cancelled';
type Tone = 'accent' | 'success' | 'warning' | 'danger';

const STATUS: Record<Appointment['status'], { label: string; tone: Tone }> = {
  pending: { label: t("Tasdiq kutilmoqda"), tone: 'warning' },
  confirmed: { label: t("Tasdiqlangan"), tone: 'accent' },
  in_progress: { label: t("Jarayonda"), tone: 'accent' },
  completed: { label: t("Yakunlangan"), tone: 'success' },
  cancelled: { label: t("Bekor qilingan"), tone: 'danger' },
  no_show: { label: t("Kelinmadi"), tone: 'danger' },
};
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];

// Vaqti o'tib ketgan bron "Faol"da turmaydi: tasdiqlanmagani server tomonida avtomatik bekor bo'ladi,
// tasdiqlangani (salon yakunlamagan bo'lsa) "Tarix"ga o'tadi
const isPast = (a: Appointment) => new Date(a.ends_at).getTime() <= Date.now();
const inTab = (a: Appointment, tab: Tab) => {
  if (tab === 'cancelled') return a.status === 'cancelled' || a.status === 'no_show';
  if (tab === 'history') return a.status === 'completed' || (a.status === 'confirmed' && isPast(a));
  return a.status === 'in_progress' || ((a.status === 'pending' || a.status === 'confirmed') && !isPast(a));
};

const EMPTY: Record<Tab, string> = {
  active: t("Hali bronlaringiz yo'q"),
  history: t("Yakunlangan tashriflar yo'q"),
  cancelled: t("Bekor qilingan bronlar yo'q"),
};

function openMap(a: Appointment, route: boolean) {
  if (a.business_lat == null || a.business_lng == null) return;
  const point = `${a.business_lat},${a.business_lng}`;
  const label = encodeURIComponent(a.business_name ?? t("Salon"));
  // Telefonda o'rnatilgan xarita ilovasi ochiladi (Google, Yandex, 2GIS...). Bo'lmasa — brauzerda OSM
  const web = `https://www.openstreetmap.org/?mlat=${a.business_lat}&mlon=${a.business_lng}#map=17/${point.replace(',', '/')}`;
  const app = Platform.OS === 'ios'
    ? `https://maps.apple.com/?${route ? 'daddr' : 'q'}=${point}`
    : route ? `google.navigation:q=${point}` : `geo:${point}?q=${point}(${label})`;
  Linking.openURL(app).catch(() => (route
    ? Linking.openURL(`geo:${point}?q=${point}(${label})`).catch(() => Linking.openURL(web))
    : Linking.openURL(web)).catch(() => {}));
}

export default function Bookings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabSpace();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [items, setItems] = useState<Appointment[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [loading, setLoading] = useState(false);
  const { me } = useAuth();
  const { requireAuth } = useAuthGate();

  const load = useCallback(async () => {
    if (!me) { setItems([]); return; }
    setLoading(true);
    try {
      setItems(await api<Appointment[]>('/appointments/mine?upcoming=false'));
    } catch (e) {
      Alert.alert(t("Xatolik"), e instanceof ApiError ? e.message : t("Yuklab bo'lmadi"));
    } finally {
      setLoading(false);
    }
  }, [me]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const act = async (action: () => Promise<void>) => {
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert(t("Xatolik"), e instanceof ApiError ? e.message : t("Bajarib bo'lmadi"));
    }
  };

  const cancel = (a: Appointment) => Alert.alert(t("Bronni bekor qilasizmi?"), dateTimeOf(a.starts_at), [
    { text: t("Yo'q"), style: 'cancel' },
    {
      text: t("Ha, bekor qilish"),
      style: 'destructive',
      onPress: () => act(async () => {
        await api(`/appointments/${a.id}/cancel`, { method: 'POST', body: {} });
        track('booking_cancel');
        await cancelBookingReminder(a.id);
      }),
    },
  ]);

  if (!me) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 12, paddingHorizontal: 16 }}>
        <Text style={[ty.display, { marginBottom: 14 }]}>{t("Bronlarim")}</Text>
        <EmptyState icon="calendar-outline" title={t("Bronlaringiz shu yerda bo'ladi")}
          text={t("Bronlaringizni ko'rish va boshqarish uchun profilingizga kiring")}
          action={t("Kirish yoki ro'yxatdan o'tish")}
          onAction={() => { requireAuth(t("Bronlaringizni ko'rish uchun profilingizga kiring yoki ro'yxatdan o'ting")); }} />
      </View>
    );
  }

  const shown = items.filter((a) => inTab(a, tab));
  const counts = { active: items.filter((a) => inTab(a, 'active')).length };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16 }}>
        <Text style={[ty.display, { marginBottom: 14 }]}>{t("Bronlarim")}</Text>
        <Segments value={tab} onChange={setTab} options={[
          { id: 'active', label: counts.active ? `${t("Kelgusi")} · ${counts.active}` : t("Kelgusi") },
          { id: 'history', label: t("Tarix") },
          { id: 'cancelled', label: t("Bekor") },
        ]} />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: tabSpace }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}
        ListEmptyComponent={loading ? undefined : (
          <EmptyState icon="calendar-clear-outline" title={EMPTY[tab]}
            text={tab === 'active' ? t("O'zingizga qulay muassasa va vaqtni tanlang") : undefined}
            action={tab === 'active' ? t("Muassasalarni ko'rish") : undefined} onAction={() => router.navigate('/')} />
        )}
        renderItem={({ item: a, index }) => {
          const open = (a.status === 'pending' || a.status === 'confirmed') && new Date(a.starts_at) > new Date();
          const status = STATUS[a.status];
          const day = dayOf(a.starts_at);
          const pay = a.total_price - (a.discount ?? 0);
          return (
            <FadeIn delay={Math.min(index, 6) * 40}>
              <View style={[s.card, tab !== 'active' && { opacity: a.status === 'cancelled' ? 0.75 : 1 }]}>
                <View style={s.top}>
                  <View style={s.date}>
                    <Text style={s.month}>{t(MONTHS[+day.slice(5, 7) - 1])}</Text>
                    <Text style={s.dayNum}>{+day.slice(8)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Badge label={status.label} tone={status.tone} />
                    <Text style={ty.h3} numberOfLines={1}>{a.business_name ?? t("Salon")}</Text>
                    <Text style={ty.small} numberOfLines={2}>
                      {timeOf(a.starts_at)} · {pickList(a.services, a.services_ru).join(', ')}{a.member_name ? ` · ${a.member_name}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.price}>{money(pay)}</Text>
                    {!!a.discount && <Text style={s.old}>{money(a.total_price)}</Text>}
                  </View>
                </View>

                {a.status === 'pending' && a.confirm_by && !isPast(a) && (
                  <View style={[s.note, { backgroundColor: c.warningSoft }]}>
                    <Icon name="hourglass-outline" size={16} color={c.warning} />
                    <Text style={[ty.small, { flex: 1, color: c.warning }]}>
                      {t("Salon {a} gacha tasdiqlashi kerak. Tasdiqlanmasa, bron avtomatik bekor qilinadi.", { a: dateTimeOf(a.confirm_by) })}
                    </Text>
                  </View>
                )}
                {a.status === 'cancelled' && a.cancel_reason && (
                  <View style={[s.note, { backgroundColor: c.surface2 }]}>
                    <Icon name="information-circle-outline" size={16} color={c.muted} />
                    <Text style={[ty.small, { flex: 1 }]}>{a.cancel_reason}</Text>
                  </View>
                )}
                {a.attendance === 'confirmed' && open && (
                  <View style={[s.note, { backgroundColor: c.successSoft }]}>
                    <Icon name="checkmark-circle" size={16} color={c.success} />
                    <Text style={[ty.small, { color: c.success, fontWeight: '700' }]}>{t("Borishingiz tasdiqlangan")}</Text>
                  </View>
                )}

                {open && (
                  <View style={{ gap: 8, marginTop: 12 }}>
                    <View style={s.row}>
                      {a.business_lat != null && (
                        <View style={{ flex: 1 }}><Button title={t("Yo'nalish")} kind="soft" compact icon="navigate-outline" onPress={() => openMap(a, true)} /></View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Button title={t("Ko'chirish")} kind="outline" compact icon="calendar-outline"
                          onPress={() => router.push({ pathname: '/book', params: { appointmentId: String(a.id) } })} />
                      </View>
                    </View>
                    <View style={s.row}>
                      {a.attendance !== 'confirmed' && (
                        <View style={{ flex: 1 }}>
                          <Button title={t("Boraman")} compact icon="checkmark"
                            onPress={() => act(() => api(`/appointments/${a.id}/attend`, { method: 'POST' }))} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}><Button title={t("Bekor qilish")} kind="danger" compact onPress={() => cancel(a)} /></View>
                    </View>
                  </View>
                )}

                {a.status === 'completed' && a.review_rating != null && (
                  <View style={[s.row, { marginTop: 10, alignItems: 'center', gap: 6 }]}>
                    <Icon name="star" size={16} color={c.star} />
                    <Text style={ty.small}>{t("Bahoyingiz: {a} / 5", { a: a.review_rating })}</Text>
                  </View>
                )}
                {!open && tab !== 'active' && (
                  <View style={[s.row, { marginTop: 12 }]}>
                    {a.can_review && (
                      <View style={{ flex: 1 }}>
                        <Button title={t("Baholash")} icon="star-outline" compact
                          onPress={() => router.push({ pathname: '/review', params: { appointmentId: String(a.id) } })} />
                      </View>
                    )}
                    {a.business_slug && (
                      <View style={{ flex: 1 }}>
                        <Button title={t("Qayta bron")} kind="soft" compact icon="refresh"
                          onPress={() => router.push({ pathname: '/business/[slug]', params: { slug: a.business_slug! } })} />
                      </View>
                    )}
                  </View>
                )}
              </View>
            </FadeIn>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { padding: 14, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, marginBottom: 12 },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  date: { width: 54, height: 60, borderRadius: 16, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 11, fontWeight: '800', color: c.accent, textTransform: 'uppercase' },
  dayNum: { fontSize: 22, fontWeight: '800', color: c.accent },
  price: { fontSize: 15, fontWeight: '800', color: c.text },
  old: { fontSize: 12, color: c.muted, textDecorationLine: 'line-through' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, marginTop: 10 },
  row: { flexDirection: 'row', gap: 8 },
}));
