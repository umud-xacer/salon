import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, ErrorText, Field, shared } from '../src/ui';

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
      setError(e instanceof ApiError ? e.message : 'Xatolik yuz berdi');
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
    setInfo("Raqam ro'yxatda bo'lsa, SMS kod yuborildi");
  });

  const reset = () => run(async () => {
    await api('/auth/password/reset', { method: 'POST', body: { phone, code, new_password: password } });
    setMode('login');
    setPassword('');
    setInfo("Parol o'zgardi. Yangi parol bilan kiring");
  });

  return (
    <ScrollView style={shared.screen} keyboardShouldPersistTaps="handled">
      <Field label="Telefon raqam" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      {mode === 'reset' && <Field label="SMS kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />}
      {mode !== 'forgot' && (
        <Field label={mode === 'reset' ? 'Yangi parol' : 'Parol'} value={password} onChangeText={setPassword} secureTextEntry />
      )}
      <ErrorText text={error} />
      {info && <Text style={[shared.muted, { marginBottom: 10 }]}>{info}</Text>}
      <View style={shared.gap}>
        {mode === 'login' && <Button title="Kirish" onPress={login} busy={busy} />}
        {mode === 'forgot' && <Button title="Kod olish" onPress={forgot} busy={busy} />}
        {mode === 'reset' && <Button title="Parolni o'zgartirish" onPress={reset} busy={busy} />}
        <Button
          title={mode === 'login' ? 'Parolni unutdim' : 'Orqaga'}
          kind="outline"
          onPress={() => setMode(mode === 'login' ? 'forgot' : 'login')}
        />
      </View>
    </ScrollView>
  );
}
