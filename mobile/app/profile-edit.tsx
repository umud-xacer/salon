import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError, User } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, Chip, colors, ErrorText, Field, maskBirthDate, parseBirthDate, shared, showBirthDate, type } from '../src/ui';

import { t } from "../src/i18n";
export default function ProfileEdit() {
  const { me, refresh } = useAuth();
  const router = useRouter();
  const user = me?.user;
  const [name, setName] = useState(user?.full_name ?? '');
  const [birth, setBirth] = useState(user?.birth_date ? showBirthDate(user.birth_date) : '');
  const [gender, setGender] = useState(user?.gender ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const birthDate = birth ? parseBirthDate(birth) : null;
    if (name.trim().length < 2) return setError(t("Ism va familiyani kiriting"));
    if (birth && !birthDate) return setError(t("Tug'ilgan sanani 03.02.1995 ko'rinishida kiriting"));
    setBusy(true);
    setError(null);
    try {
      await api<User>('/auth/me', {
        method: 'PATCH',
        body: { full_name: name.trim(), birth_date: birthDate, gender },
      });
      await refresh();
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Saqlab bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={shared.screen} keyboardShouldPersistTaps="handled">
      <Field label={t("Ism va familiya")} value={name} onChangeText={setName} autoCapitalize="words" maxLength={120} />
      <Field label={t("Telefon raqam")} value={user?.phone} editable={false}
        hint={t("Telefon kirish uchun tasdiqlangan, uni bu yerda o'zgartirib bo'lmaydi")} />
      <Field label={t("Tug'ilgan sana")} placeholder="03.02.1995" keyboardType="number-pad" maxLength={10} value={birth}
        onChangeText={(tx) => setBirth(maskBirthDate(tx))} />
      <Text style={{ color: colors.muted, marginBottom: 8, fontSize: 14 }}>{t("Jinsi")}</Text>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <Chip label={t("Erkak")} icon="man-outline" active={gender === 'male'} onPress={() => setGender('male')} />
        <Chip label={t("Ayol")} icon="woman-outline" active={gender === 'female'} onPress={() => setGender('female')} />
      </View>
      <ErrorText text={error} />
      <Button title={t("Saqlash")} onPress={save} busy={busy} />
      <Pressable onPress={() => router.push('/password')} style={{ paddingVertical: 16, alignItems: 'center' }}>
        <Text style={[type.body, { color: colors.primary, fontWeight: '600' }]}>{t("Parolni tiklash")}</Text>
      </Pressable>
    </ScrollView>
  );
}
