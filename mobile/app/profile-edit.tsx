import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api, ApiError, User } from '../src/api';
import { useAuth } from '../src/auth';
import { backupPhone, Button, Chip, ErrorText, Field, maskBirthDate, parseBirthDate, ScreenScroll, showBirthDate, useTheme, useType } from '../src/ui';

import { t } from "../src/i18n";
export default function ProfileEdit() {
  const { me, refresh } = useAuth();
  const { c } = useTheme();
  const type = useType();
  const router = useRouter();
  const user = me?.user;
  const [name, setName] = useState(user?.full_name ?? '');
  const [birth, setBirth] = useState(user?.birth_date ? showBirthDate(user.birth_date) : '');
  const [gender, setGender] = useState(user?.gender ?? null);
  const [backup, setBackup] = useState(backupPhone.init(user?.backup_phone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const birthDate = birth ? parseBirthDate(birth) : null;
    if (name.trim().length < 2) return setError(t("Ism va familiyani kiriting"));
    if (birth && !birthDate) return setError(t("Tug'ilgan sanani 03.02.1995 ko'rinishida kiriting"));
    if (backup && !backupPhone.valid(backup)) return setError(t("Zaxira raqamni to'liq kiriting (9 ta raqam yoki + bilan xorijiy raqam)"));
    setBusy(true);
    setError(null);
    try {
      await api<User>('/auth/me', {
        method: 'PATCH',
        body: { full_name: name.trim(), birth_date: birthDate, gender,
          // eski server maydonni bilmasa — yubormaymiz
          ...(user?.backup_phone !== undefined ? { backup_phone: backup ? backupPhone.full(backup) : null } : {}) },
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
    <ScreenScroll>
      <Field label={t("Ism va familiya")} value={name} onChangeText={setName} autoCapitalize="words" maxLength={120} />
      <Field label={t("Telefon raqam")} value={user?.phone} editable={false}
        hint={t("Telefon kirish uchun tasdiqlangan, uni bu yerda o'zgartirib bo'lmaydi")} />
      <Field label={t("Zaxira telefon raqam")} placeholder="90 123 45 67" keyboardType="phone-pad" maxLength={16}
        value={backupPhone.show(backup)} onChangeText={(x) => setBackup(backupPhone.change(x))}
        hint={t("Asosiy raqamingiz javob bermasa, salon shu raqamga qo'ng'iroq qiladi. Kirish uchun ishlatilmaydi.") + ' ' + t("Xorijiy raqam bo'lsa, + bilan yozing: +79161234567")} />
      <Field label={t("Tug'ilgan sana")} placeholder="03.02.1995" keyboardType="number-pad" maxLength={10} value={birth}
        onChangeText={(tx) => setBirth(maskBirthDate(tx))} />
      <Text style={[type.caps, { marginBottom: 8 }]}>{t("Jinsi")}</Text>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <Chip label={t("Erkak")} icon="man-outline" active={gender === 'male'} onPress={() => setGender('male')} />
        <Chip label={t("Ayol")} icon="woman-outline" active={gender === 'female'} onPress={() => setGender('female')} />
      </View>
      <ErrorText text={error} />
      <Button title={t("Saqlash")} onPress={save} busy={busy} />
      <Pressable onPress={() => router.push('/password')} style={{ paddingVertical: 16, alignItems: 'center' }}>
        <Text style={[type.body, { color: c.accent, fontWeight: '700' }]}>{t("Parolni tiklash")}</Text>
      </Pressable>
    </ScreenScroll>
  );
}
