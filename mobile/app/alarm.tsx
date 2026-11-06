import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, Vibration, View } from 'react-native';

import { api, ApiError, Appointment } from '../src/api';
import { alarmKey, openedAlarms } from '../src/notifications';
import { Button, dateTimeOf, ErrorText } from '../src/ui';
import { cancelBookingReminder } from '../src/localReminders';

import { t } from "../src/i18n";
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
  // To'liq ekran havolasi bilan to'g'ridan-to'g'ri ochilgan bo'lsa ham, shu bron uchun qayta ochilmasin
  if (!isTest) openedAlarms.add(alarmKey(type, appointmentId));

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
    // Telefondagi (mahalliy) budilnikda server bildirishnomasi raqami yo'q
    if (/^\d+$/.test(notificationId ?? '')) {
      api(`/notifications/${notificationId}/read`, { method: 'POST' }).catch(() => {});
    }
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
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
      setBusy(false);
    }
  };

  const attend = () => run(() => api(`/appointments/${appointmentId}/attend`, { method: 'POST' }));
  const cancel = () => run(async () => {
    await api(`/appointments/${appointmentId}/cancel`, { method: 'POST', body: { reason: t("Mijoz budilnikda \"Bormayman\" dedi") } });
    await cancelBookingReminder(Number(appointmentId));
  });
  const call = () => run(async () => {
    const { tel_url } = await api<{ tel_url: string }>(`/appointments/${appointmentId}/client-contact`);
    await Linking.openURL(tel_url);
  });

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Text style={styles.time}>{appointment ? dateTimeOf(appointment.starts_at) : ''}</Text>
        <Text style={styles.title}>
          {isTest ? t("Budilnik sinovi") : isClient ? t("Broningiz yaqinlashmoqda") : t("Mijoz javob bermayapti")}
        </Text>
        <Text style={styles.body}>
          {isTest
            ? t("Ovoz va tebranish ishlayapti")
            : isClient
            ? `${appointment?.business_name ?? ''}\n${appointment?.services.join(', ') ?? ''}`
            : t("Mijoz bronni tasdiqlamadi, iltimos bog'laning")}
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <ErrorText text={error} />
        {isClient ? (
          <>
            <Button title={t("Tasdiqlayman, boraman")} onPress={attend} busy={busy} />
            <Button title={t("Bormayman (bronni bekor qilish)")} kind="danger" onPress={cancel} disabled={busy} />
          </>
        ) : !isTest && (
          <Button title={t("Qo'ng'iroq qilish")} onPress={call} busy={busy} />
        )}
        <Button title={t("Ovozni o'chirish")} kind="outline" onPress={stop} disabled={busy} />
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
