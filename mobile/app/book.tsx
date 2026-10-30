import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import { api, ApiError, Appointment, Slot } from '../src/api';
import { Button, Chip, Empty, ErrorText, nextDays, shared } from '../src/ui';

const DAYS = nextDays(14);

// Yangi bron ham, ko'chirish ham: appointmentId bo'lsa ko'chiriladi
export default function Book() {
  const { memberId, serviceId, appointmentId } =
    useLocalSearchParams<{ memberId: string; serviceId?: string; appointmentId?: string }>();
  const router = useRouter();
  const [service, setService] = useState(serviceId ?? null);
  const [day, setDay] = useState(DAYS[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (service || !appointmentId) return;
    api<Appointment>(`/appointments/${appointmentId}`)
      .then((a) => setService(String(a.service_ids[0])))
      .catch(() => setError("Bronni o'qib bo'lmadi"));
  }, [service, appointmentId]);

  const load = useCallback(async () => {
    if (!service) return;
    setSlots(null);
    setSelected(null);
    setError(null);
    try {
      const params = new URLSearchParams({ member_id: memberId, service_id: service, date: day });
      setSlots((await api<{ slots: Slot[] }>(`/catalog/slots?${params}`)).slots);
    } catch (e) {
      setSlots([]);
      setError(e instanceof ApiError ? e.message : 'Yuklab bo\'lmadi');
    }
  }, [memberId, service, day]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (appointmentId) {
        await api(`/appointments/${appointmentId}/reschedule`, { method: 'POST', body: { starts_at: selected.starts_at } });
      } else {
        await api('/appointments', {
          method: 'POST',
          body: { member_id: Number(memberId), service_id: Number(service), starts_at: selected.starts_at },
        });
      }
      Alert.alert(appointmentId ? 'Vaqt o\'zgartirildi' : 'Bron qilindi', `${day} ${selected.time}`);
      router.replace('/bookings');
    } catch (e) {
      // Vaqtni shu orada boshqa mijoz olgan bo'lishi mumkin: ro'yxat yangilanadi
      if (e instanceof ApiError && e.code === 'time_conflict') await load();
      setError(e instanceof ApiError ? e.message : 'Bajarib bo\'lmadi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={shared.heading}>Kun</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {DAYS.map((d) => (
          <Chip key={d} label={d.slice(8) + '.' + d.slice(5, 7)} active={d === day} onPress={() => setDay(d)} />
        ))}
      </ScrollView>

      <Text style={shared.heading}>Bo'sh vaqtlar</Text>
      {slots === null ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : slots.length === 0 ? (
        <Empty text="Bu kunda bo'sh vaqt yo'q" />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {slots.map((s) => (
            <Chip key={s.starts_at} label={s.time} active={selected?.starts_at === s.starts_at} onPress={() => setSelected(s)} />
          ))}
        </View>
      )}

      <ErrorText text={error} />
      <View style={{ marginTop: 12 }}>
        <Button
          title={appointmentId ? 'Vaqtni o\'zgartirish' : 'Bron qilish'}
          onPress={submit}
          busy={busy}
          disabled={!selected}
        />
      </View>
    </ScrollView>
  );
}
