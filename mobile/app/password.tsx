import { useState } from 'react';
import { Text, View } from 'react-native';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, ErrorText, Field, ScreenScroll, shared } from '../src/ui';

import { t } from "../src/i18n";
type Mode = 'login' | 'forgot' | 'reset';

export default function Password() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setBusy(false);
    }
  };

  const login = () => run(async () => {
    await signIn(await api<LoginOut>('/auth/login', { method: 'POST', body: { phone, password } }));
  });

  const forgot = () => run(async () => {
    const r = await api<{ dev_code: string | null }>('/auth/password/forgot', { method: 'POST', body: { phone } });
    if (r.dev_code) setCode(r.dev_code);
    setPassword('');
    setMode('reset');
    setInfo(t("Raqam ro'yxatda bo'lsa, SMS kod yuborildi"));
  });

  const reset = () => run(async () => {
    await api('/auth/password/reset', { method: 'POST', body: { phone, code, new_password: password } });
    setMode('login');
    setPassword('');
    setInfo(t("Parol o'zgardi. Yangi parol bilan kiring"));
  });

  return (
    <ScreenScroll>
      <Field label={t("Telefon raqam")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      {mode === 'reset' && <Field label={t("SMS kod")} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />}
      {mode !== 'forgot' && (
        <Field label={mode === 'reset' ? t("Yangi parol") : t("Parol")} value={password} onChangeText={setPassword} secureTextEntry />
      )}
      <ErrorText text={error} />
      {info && <Text style={[shared.muted, { marginBottom: 10 }]}>{info}</Text>}
      <View style={shared.gap}>
        {mode === 'login' && <Button title={t("Kirish")} onPress={login} busy={busy} />}
        {mode === 'forgot' && <Button title={t("Kod olish")} onPress={forgot} busy={busy} />}
        {mode === 'reset' && <Button title={t("Parolni o'zgartirish")} onPress={reset} busy={busy} />}
        <Button
          title={mode === 'login' ? t("Parolni unutdim") : t("Orqaga")}
          kind="outline"
          onPress={() => setMode(mode === 'login' ? 'forgot' : 'login')}
        />
      </View>
    </ScreenScroll>
  );
}
