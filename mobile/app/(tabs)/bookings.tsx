import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, Text, View } from 'react-native';

import { api, ApiError, Appointment } from '../../src/api';
import { Button, Card, colors, dateTimeOf, Empty, money, shared } from '../../src/ui';

const STATUS: Record<Appointment['status'], string> = {
  pending: 'Salon tasdig\'ini kutmoqda',
  confirmed: 'Tasdiqlangan',
  in_progress: 'Jarayonda',
  completed: 'Yakunlangan',
  cancelled: 'Bekor qilingan',
  no_show: 'Kelinmadi',
};

export default function Bookings() {
  const router = useRouter();
  const [items, setItems] = useState<Appointment[]>([]);
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
      onPress: () => act(() => api(`/appointments/${a.id}/cancel`, { method: 'POST', body: {} })),
    },
  ]);

  return (
    <View style={shared.screen}>
      <FlatList
        data={items}
        keyExtractor={(a) => String(a.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="Hali bronlaringiz yo'q" />}
        renderItem={({ item: a }) => {
          const open = (a.status === 'pending' || a.status === 'confirmed') && new Date(a.starts_at) > new Date();
          return (
            <Card>
              <View style={shared.row}>
                <Text style={shared.name}>{a.business_name ?? 'Salon'}</Text>
                <Text style={shared.name}>{dateTimeOf(a.starts_at)}</Text>
              </View>
              <Text style={shared.muted}>{a.services.join(', ')}{a.member_name ? ` · ${a.member_name}` : ''}</Text>
              <Text style={shared.muted}>{money(a.total_price)} · {STATUS[a.status]}</Text>
              {a.attendance === 'confirmed' && <Text style={{ color: colors.primary, marginTop: 2 }}>Borishingiz tasdiqlangan</Text>}
              {open && (
                <View style={[shared.gap, { marginTop: 10 }]}>
                  {a.attendance !== 'confirmed' && (
                    <Button title="Boraman" onPress={() => act(() => api(`/appointments/${a.id}/attend`, { method: 'POST' }))} />
                  )}
                  <Button
                    title="Vaqtni o'zgartirish"
                    kind="outline"
                    onPress={() => router.push({ pathname: '/book', params: { appointmentId: String(a.id), memberId: String(a.member_id) } })}
                  />
                  <Button title="Bekor qilish" kind="danger" onPress={() => cancel(a)} />
                </View>
              )}
            </Card>
          );
        }}
      />
    </View>
  );
}
