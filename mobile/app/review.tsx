// Xizmatdan keyingi baho: muassasaga (umumiy, tozalik, qabul va xizmat) va xizmat ko'rsatgan ustaga / shifokorga.
// Usta bronning o'zidan olinadi — mijoz boshqa ustani tanlay olmaydi (soxta baholardan himoya).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import { api, ApiError, Appointment } from '../src/api';
import { StarsInput } from '../src/Reviews';
import { Button, Card, ErrorText, Field, shared, type, dateTimeOf } from '../src/ui';

import { pickList, t } from "../src/i18n";
export default function Review() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const router = useRouter();
  const [a, setA] = useState<Appointment | null>(null);
  const [rating, setRating] = useState(0);
  const [cleanliness, setCleanliness] = useState(0);
  const [quality, setQuality] = useState(0);
  const [comment, setComment] = useState('');
  const [staffRating, setStaffRating] = useState(0);
  const [staffComment, setStaffComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Appointment>(`/appointments/${appointmentId}`)
      .then(setA)
      .catch((e) => setError(e instanceof ApiError ? e.message : t("Bronni yuklab bo'lmadi")));
  }, [appointmentId]);

  const ready = rating > 0 && cleanliness > 0 && quality > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/appointments/${appointmentId}/review`, {
        method: 'POST',
        body: {
          rating, cleanliness, service_quality: quality, comment: comment.trim() || null,
          staff_rating: staffRating || null, staff_comment: staffRating ? staffComment.trim() || null : null,
        },
      });
      Alert.alert(t("Rahmat!"), t("Bahoyingiz boshqa mijozlarga yaxshi joy tanlashda yordam beradi."));
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Yuborib bo'lmadi, qayta urinib ko'ring"));
      setBusy(false);
    }
  };

  if (!a) {
    return error ? <ScrollView style={shared.screen}><ErrorText text={error} /></ScrollView>
      : <ActivityIndicator style={{ marginTop: 40 }} size="large" />;
  }
  if (!a.can_review) {
    return (
      <ScrollView style={shared.screen}>
        <Card>
          <Text style={type.h3}>{a.review_rating ? t("Siz bu tashrifni baholagansiz") : t("Bu tashrifni baholab bo'lmaydi")}</Text>
          <Text style={[shared.muted, { marginTop: 6 }]}>
            {a.review_rating
              ? t("Bahoyingiz: {a}", { a: '★'.repeat(a.review_rating) })
              : t("Baho faqat yakunlangan tashrifdan keyin, 30 kun ichida qo'yiladi.")}
          </Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Text style={type.h2}>{a.business_name ?? t("Muassasa")}</Text>
      <Text style={shared.muted}>{dateTimeOf(a.starts_at)} · {pickList(a.services, a.services_ru).join(', ')}</Text>

      <Card>
        <Text style={shared.name}>{t("Muassasaga baho")}</Text>
        <StarsInput label={t("Umumiy taassurot")} value={rating} onChange={setRating} />
        <StarsInput label={t("Tozalik")} value={cleanliness} onChange={setCleanliness} />
        <StarsInput label={t("Qabul va xizmat sifati")} value={quality} onChange={setQuality} />
        <View style={{ marginTop: 14 }}>
          <Field label={t("Izoh (ixtiyoriy)")} value={comment} onChangeText={setComment} multiline maxLength={2000}
            placeholder={t("Nima yoqdi, nimani yaxshilash kerak?")} style={{ minHeight: 80, textAlignVertical: 'top' }} />
        </View>
      </Card>

      {a.member_name && (
        <Card>
          <Text style={shared.name}>{t("Sizga xizmat ko'rsatgan mutaxassis")}</Text>
          <Text style={[type.h3, { marginTop: 4 }]}>{a.member_name}</Text>
          <StarsInput label={t("Mutaxassis ishiga baho")} value={staffRating} onChange={setStaffRating} />
          {staffRating > 0 && (
            <View style={{ marginTop: 14 }}>
              <Field label={t("Mutaxassis haqida (ixtiyoriy)")} value={staffComment} onChangeText={setStaffComment} multiline
                maxLength={1000} style={{ minHeight: 70, textAlignVertical: 'top' }} />
            </View>
          )}
        </Card>
      )}

      <ErrorText text={error} />
      {!ready && <Text style={[shared.muted, { marginBottom: 8 }]}>{t("Muassasaga uchala bahoni qo'ying")}</Text>}
      <Button title={t("Bahoni yuborish")} onPress={submit} busy={busy} disabled={!ready} />
    </ScrollView>
  );
}
