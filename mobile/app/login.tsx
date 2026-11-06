import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, colors, ErrorText, Field, radius, shared, type } from '../src/ui';

import { t } from "../src/i18n";
import { LangSwitch } from "../src/LangSwitch";
export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('+998');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setBusy(false);
    }
  };

  const request = () => run(async () => {
    const r = await api<{ dev_code: string | null }>('/auth/otp/request', { method: 'POST', body: { phone } });
    if (r.dev_code) setCode(r.dev_code);          // faqat dev rejimda keladi
    setSent(true);
  });

  const verify = () => run(async () => {
    await signIn(await api<LoginOut>('/auth/otp/verify', { method: 'POST', body: { phone, code } }));
  });

  return (
    <ScrollView style={shared.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ marginBottom: 12 }}><LangSwitch /></View>
      <View style={{ backgroundColor: colors.navy, borderRadius: radius.xl, padding: 26, marginBottom: 24, alignItems: 'center' }}>
        <Image source={require('../assets/brand/wordmark.png')} style={{ width: 190, height: 46 }} resizeMode="contain" />
        <Image source={require('../assets/brand/tagline.png')} style={{ width: 220, height: 20, marginTop: 8 }} resizeMode="contain" />
      </View>
      <Text style={[type.h1, { marginBottom: 4 }]}>{t("Xush kelibsiz")}</Text>
      <Text style={[type.small, { marginBottom: 18 }]}>{t("Hisobingizga kiring yoki ro'yxatdan o'ting")}</Text>
      <Field label={t("Telefon raqam")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!sent} />
      {sent && <Field label={t("SMS kod")} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />}
      <ErrorText text={error} />
      <View style={shared.gap}>
        {sent ? (
          <>
            <Button title={t("Kirish")} onPress={verify} busy={busy} disabled={code.length !== 6} />
            <Button title={t("Raqamni o'zgartirish")} kind="outline" onPress={() => setSent(false)} />
          </>
        ) : (
          <>
            <Button title={t("Parol bilan kirish")} onPress={() => router.push('/password')} />
            <Button title={t("SMS kod bilan kirish")} kind="outline" onPress={request} busy={busy} />
          </>
        )}
      </View>
      <Pressable onPress={() => router.push('/register')} style={{ paddingVertical: 20, alignItems: 'center' }}>
        <Text style={type.body}>
          {t("Hisobingiz yo'qmi?")}{" "}<Text style={{ color: colors.primary, fontWeight: '700' }}>{t("Ro'yxatdan o'ting")}</Text>
        </Text>
      </Pressable>
    </ScrollView>
  );
}
