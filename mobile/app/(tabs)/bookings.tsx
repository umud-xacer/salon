import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Linking, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { api, ApiError, Appointment } from '../../src/api';
import { cancelBookingReminder } from '../../src/localReminders';
import {
  Button, Card, colors, dateTimeOf, EmptyState, Icon, money, radius, Segments, shared, type,
} from '../../src/ui';

type Tab = 'active' | 'history' | 'cancelled';

const STATUS: Record<Appointment['status'], { label: string; color: string; bg: string }> = {
  pending: { label: 'Tasdiq kutilmoqda', color: colors.warning, bg: '#FFF4E0' },
  confirmed: { label: 'Tasdiqlangan', color: colors.primary, bg: colors.primarySoft },
  in_progress: { label: 'Jarayonda', color: colors.primary, bg: colors.primarySoft },
  completed: { label: 'Yakunlangan', color: colors.success, bg: colors.successSoft },
  cancelled: { label: 'Bekor qilingan', color: colors.danger, bg: colors.dangerSoft },
  no_show: { label: 'Kelinmadi', color: colors.danger, bg: colors.dangerSoft },
};

const inTab = (a: Appointment, tab: Tab) => {
  if (tab === 'cancelled') return a.status === 'cancelled' || a.status === 'no_show';
  if (tab === 'history') return a.status === 'completed';
  return a.status === 'pending' || a.status === 'confirmed' || a.status === 'in_progress';
};

const EMPTY: Record<Tab, string> = {
  active: "Hali bronlaringiz yo'q",
  history: "Yakunlangan tashriflar yo'q",
  cancelled: "Bekor qilingan bronlar yo'q",
};

export default function Bookings() {
  const router = useRouter();
  const [items, setItems] = useState<Appointment[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api<Appointment[]>('/appointments/mine?upcoming=false'));
    } catch (e) {
      Alert.alert('Xatolik', e instanceof ApiError ? e.message : 'Yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const act = async (action: () => Promise<void>) => {
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert('Xatolik', e instanceof ApiError ? e.message : 'Bajarib bo\'lmadi');
    }
  };

  const cancel = (a: Appointment) => Alert.alert('Bronni bekor qilasizmi?', dateTimeOf(a.starts_at), [
    { text: 'Yo\'q', style: 'cancel' },
    {
      text: 'Ha, bekor qilish',
      style: 'destructive',
      onPress: () => act(async () => {
        await api(`/appointments/${a.id}/cancel`, { method: 'POST', body: {} });
        await cancelBookingReminder(a.id);
      }),
    },
  ]);

  const openMap = (a: Appointment, route: boolean) => {
    if (a.business_lat == null || a.business_lng == null) return;
    const point = `${a.business_lat},${a.business_lng}`;
    const label = encodeURIComponent(a.business_name ?? 'Salon');
    // Telefonda o'rnatilgan xarita ilovasi ochiladi (Google, Yandex, 2GIS...). Bo'lmasa — brauzerda OSM
    const web = `https://www.openstreetmap.org/?mlat=${a.business_lat}&mlon=${a.business_lng}#map=17/${point.replace(',', '/')}`;
    const app = Platform.OS === 'ios'
      ? `https://maps.apple.com/?${route ? 'daddr' : 'q'}=${point}`
      : route ? `google.navigation:q=${point}` : `geo:${point}?q=${point}(${label})`;
    Linking.openURL(app).catch(() => (route
      ? Linking.openURL(`geo:${point}?q=${point}(${label})`).catch(() => Linking.openURL(web))
      : Linking.openURL(web)).catch(() => {}));
  };

  const shown = items.filter((a) => inTab(a, tab));

  return (
    <View style={shared.screen}>
      <Segments value={tab} onChange={setTab} options={[
        { id: 'active', label: 'Faol' }, { id: 'history', label: 'Tarix' }, { id: 'cancelled', label: 'Bekor qilingan' },
      ]} />
      <FlatList
        data={shown}
        keyExtractor={(a) => String(a.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : (
          <EmptyState icon="calendar-clear-outline" title={EMPTY[tab]}
            text={tab === 'active' ? "O'zingizga qulay salon va vaqtni tanlang" : undefined}
            action={tab === 'active' ? "Salonlarni ko'rish" : undefined} onAction={() => router.navigate('/')} />
        )}
        renderItem={({ item: a }) => {
          const open = (a.status === 'pending' || a.status === 'confirmed') && new Date(a.starts_at) > new Date();
          const status = STATUS[a.status];
          const hasMap = a.business_lat != null;
          return (
            <Card>
              <View style={shared.row}>
                <Text style={[type.h3, { flex: 1, paddingRight: 8 }]} numberOfLines={1}>{a.business_name ?? 'Salon'}</Text>
                <View style={[styles.status, { backgroundColor: status.bg }]}>
                  <Text style={{ color: status.color, fontSize: 12, fontWeight: '700' }}>{status.label}</Text>
                </View>
              </View>
              <View style={styles.line}>
                <Icon name="time-outline" size={16} color={colors.muted} />
                <Text style={type.body}>{dateTimeOf(a.starts_at)}</Text>
              </View>
              {a.member_name && (
                <View style={styles.line}>
                  <Icon name="person-outline" size={16} color={colors.muted} />
                  <Text style={type.body}>{a.member_name}</Text>
                </View>
              )}
              <View style={styles.line}>
                <Icon name="cut-outline" size={16} color={colors.muted} />
                <Text style={[type.body, { flex: 1 }]} numberOfLines={2}>{a.services.join(', ')}</Text>
                <Text style={{ fontWeight: '700', color: colors.text }}>{money(a.total_price)}</Text>
              </View>
              {a.attendance === 'confirmed' && (
                <View style={styles.line}>
                  <Icon name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={{ color: colors.success }}>Borishingiz tasdiqlangan</Text>
                </View>
              )}
              {hasMap && tab === 'active' && (
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}><Button title="Xaritada" kind="soft" compact icon="map-outline" onPress={() => openMap(a, false)} /></View>
                  <View style={{ flex: 1 }}><Button title="Yo'nalish" kind="soft" compact icon="navigate-outline" onPress={() => openMap(a, true)} /></View>
                </View>
              )}
              {open && (
                <View style={[shared.gap, { marginTop: 8 }]}>
                  {a.attendance !== 'confirmed' && (
                    <Button title="Boraman" icon="checkmark" onPress={() => act(() => api(`/appointments/${a.id}/attend`, { method: 'POST' }))} />
                  )}
                  <Button
                    title="Vaqtni o'zgartirish"
                    kind="outline"
                    onPress={() => router.push({ pathname: '/book', params: { appointmentId: String(a.id), memberId: String(a.member_id) } })}
                  />
                  <Button title="Bekor qilish" kind="danger" onPress={() => cancel(a)} />
                </View>
              )}
              {!open && tab !== 'active' && a.business_slug && (
                <View style={{ marginTop: 10 }}>
                  <Button title="Qayta bron qilish" kind="soft" compact
                    onPress={() => router.push({ pathname: '/business/[slug]', params: { slug: a.business_slug! } })} />
                </View>
              )}
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  line: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
