import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, ErrorText, Field, shared } from '../src/ui';

export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('+998');
  const [name, setName] = useState('');
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
      setError(e instanceof ApiError ? e.message : 'Xatolik yuz berdi');
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
    const login = await api<LoginOut>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, code, full_name: name.trim() || undefined },
    });
    await signIn(login);
  });

  return (
    <ScrollView style={shared.screen} keyboardShouldPersistTaps="handled">
      <Field label="Telefon raqam" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!sent} />
      {sent && (
        <>
          <Field label="Ismingiz (yangi foydalanuvchi uchun)" value={name} onChangeText={setName} />
          <Field label="SMS kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
        </>
      )}
      <ErrorText text={error} />
      <View style={shared.gap}>
        {sent ? (
          <>
            <Button title="Kirish" onPress={verify} busy={busy} disabled={code.length !== 6} />
            <Button title="Raqamni o'zgartirish" kind="outline" onPress={() => setSent(false)} />
          </>
        ) : (
          <Button title="SMS kod olish" onPress={request} busy={busy} />
        )}
        <Button title="Parol bilan kirish" kind="outline" onPress={() => router.push('/password')} />
      </View>
    </ScrollView>
  );
}
