// Parolni almashtirish. Server parol o'zgarganda barcha sessiyalarni yopadi,
// shuning uchun shu qurilmada yangi parol bilan darhol qayta kiramiz.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, Card, ErrorText, Field, shared, type } from '../src/ui';

import { t } from "../src/i18n";
export default function ChangePassword() {
  const { me, signIn, signOut } = useAuth();
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (newPassword !== repeat) {
      setError(t("Yangi parollar bir xil emas"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { old_password: oldPassword || null, new_password: newPassword },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
      setBusy(false);
      return;
    }
    try {
      const phone = me?.user.phone ?? '';
      await signIn(await api<LoginOut>('/auth/login', { method: 'POST', body: { phone, password: newPassword } }));
      Alert.alert(t("Parol o'zgardi"), t("Boshqa qurilmalardagi kirishlar yopildi."));
      router.back();
    } catch {
      // Parol o'zgargan, lekin qayta kirib bo'lmadi — foydalanuvchi o'zi kiradi
      Alert.alert(t("Parol o'zgardi"), t("Yangi parol bilan qayta kiring."));
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={shared.screen} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={[type.small, { marginBottom: 12 }]}>
          {t("Kamida 8 belgi, harf va raqam bo'lsin. SMS orqali ro'yxatdan o'tgan bo'lsangiz va parol qo'ymagan bo'lsangiz, joriy parolni bo'sh qoldiring.")}
        </Text>
        <Field label={t("Joriy parol")} value={oldPassword} onChangeText={setOldPassword} secureTextEntry
          autoComplete="current-password" />
        <Field label={t("Yangi parol")} value={newPassword} onChangeText={setNewPassword} secureTextEntry
          autoComplete="new-password" />
        <Field label={t("Yangi parolni takrorlang")} value={repeat} onChangeText={setRepeat} secureTextEntry
          autoComplete="new-password" />
        <ErrorText text={error} />
        <View style={shared.gap}>
          <Button title={t("Parolni o'zgartirish")} onPress={submit} busy={busy} disabled={!newPassword || !repeat} />
        </View>
      </Card>
    </ScrollView>
  );
}
