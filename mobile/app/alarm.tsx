import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, Vibration, View } from 'react-native';

import { api, ApiError, Appointment } from '../src/api';
import { openedAlarms } from '../src/notifications';
import { Button, dateTimeOf, ErrorText } from '../src/ui';

const PATTERN = [0, 800, 400];

// Budilnik ekrani: bir tugma bosilmaguncha ovoz va tebranish to'xtamaydi
export default function Alarm() {
  const { type, appointmentId, notificationId } =
    useLocalSearchParams<{ type: string; appointmentId: string; notificationId: string }>();
  const router = useRouter();
  const player = useAudioPlayer(require('../assets/sounds/alarm.wav'));
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isClient = type === 'appointment_reminder';
  const isTest = type === 'test';
  useKeepAwake();
  openedAlarms.add(notificationId);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    player.loop = true;
    player.play();
    Vibration.vibrate(PATTERN, true);
    return () => Vibration.cancel();
  }, [player]);

  useEffect(() => {
    if (isTest) return;
    api<Appointment>(`/appointments/${appointmentId}`).then(setAppointment).catch(() => {});
    api(`/notifications/${notificationId}/read`, { method: 'POST' }).catch(() => {});
  }, [appointmentId, notificationId, isTest]);

  const stop = useCallback(() => {
    player.pause();
    Vibration.cancel();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [player, router]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      stop();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Xatolik yuz berdi');
      setBusy(false);
    }
  };

  const attend = () => run(() => api(`/appointments/${appointmentId}/attend`, { method: 'POST' }));
  const cancel = () => run(() => api(`/appointments/${appointmentId}/cancel`, { method: 'POST', body: { reason: 'Budilnik ekranidan' } }));
  const call = () => run(async () => {
    const { tel_url } = await api<{ tel_url: string }>(`/appointments/${appointmentId}/client-contact`);
    await Linking.openURL(tel_url);
  });

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.time}>{appointment ? dateTimeOf(appointment.starts_at) : ''}</Text>
        <Text style={styles.title}>
          {isTest ? 'Budilnik sinovi' : isClient ? 'Broningiz yaqinlashmoqda' : 'Mijoz javob bermayapti'}
        </Text>
        <Text style={styles.body}>
          {isTest
            ? 'Ovoz va tebranish ishlayapti'
            : isClient
            ? `${appointment?.business_name ?? ''}\n${appointment?.services.join(', ') ?? ''}`
            : "Mijoz bronni tasdiqlamadi, iltimos bog'laning"}
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <ErrorText text={error} />
        {isClient ? (
          <>
            <Button title="Boraman" onPress={attend} busy={busy} />
            <Button title="Bekor qilish" kind="danger" onPress={cancel} disabled={busy} />
          </>
        ) : !isTest && (
          <Button title="Qo'ng'iroq qilish" onPress={call} busy={busy} />
        )}
        <Button title="Ovozni o'chirish" kind="outline" onPress={stop} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', padding: 24, paddingBottom: 40, justifyContent: 'space-between' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  time: { fontSize: 44, fontWeight: '700', color: '#1c1c1e', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', color: '#1c1c1e', marginBottom: 10 },
  body: { fontSize: 17, textAlign: 'center', color: '#6b6b70', lineHeight: 24 },
});
