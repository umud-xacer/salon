import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import {
  Button, colors, ErrorText, Field, Icon, IconName, maskBirthDate, parseBirthDate, radius, shared, type,
} from '../src/ui';

const STEPS = ["Ma'lumotlar", 'Shaxsiy', 'Parol', 'Tasdiqlash'];
type Gender = 'male' | 'female';

const validPhone = (p: string) => /^\+998\d{9}$/.test(p.replace(/\s/g, ''));
// Backend qoidasi bilan bir xil bo'lishi shart
const validPassword = (p: string) => p.length >= 8 && /\d/.test(p) && /[A-Za-z]/.test(p);

function GenderCard({ label, icon, active, onPress }: { label: string; icon: IconName; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.gender, active && styles.genderOn]} accessibilityRole="radio"
      accessibilityState={{ selected: active }}>
      <Icon name={icon} size={30} color={active ? colors.primary : colors.muted} />
      <Text style={{ fontWeight: '700', marginTop: 6, color: active ? colors.primary : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export default function Register() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanPhone = phone.replace(/\s/g, '');
  const birthDate = parseBirthDate(birth);

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

  const next = () => {
    setError(null);
    if (step === 0) {
      if (name.trim().length < 2) return setError('Ism va familiyani kiriting');
      if (!validPhone(phone)) return setError('Telefon raqam +998 bilan 12 ta raqam bo\'lishi kerak');
    }
    if (step === 1) {
      if (!birthDate) return setError('Tug\'ilgan sanani 03.02.1995 ko\'rinishida kiriting');
      if (!gender) return setError('Jinsingizni tanlang');
    }
    if (step === 2) {
      if (!validPassword(password)) return setError('Parol kamida 8 belgi, harf va raqamdan iborat bo\'lsin');
      if (password !== repeat) return setError('Parollar bir xil emas');
      return run(async () => {
        const r = await api<{ dev_code: string | null }>('/auth/otp/request', { method: 'POST', body: { phone: cleanPhone } });
        if (r.dev_code) setCode(r.dev_code);          // faqat dev rejimda keladi
        setStep(3);
      });
    }
    setStep(step + 1);
  };

  const finish = () => run(async () => {
    await signIn(await api<LoginOut>('/auth/otp/verify', {
      method: 'POST',
      body: { phone: cleanPhone, code, full_name: name.trim(), birth_date: birthDate, gender, password },
    }));
  });

  return (
    <ScrollView style={shared.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.progress}>
        {STEPS.map((title, i) => <View key={title} style={[styles.bar, i <= step && styles.barOn]} />)}
      </View>
      <Text style={type.small}>{step + 1}-bosqich, {STEPS.length} tadan</Text>
      <Text style={[type.h1, { marginTop: 4, marginBottom: 20 }]}>{STEPS[step]}</Text>

      {step === 0 && (
        <>
          <Field label="Ism va familiya" value={name} onChangeText={setName} autoCapitalize="words" maxLength={120} />
          <Field label="Telefon raqam" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={17} />
        </>
      )}
      {step === 1 && (
        <>
          <Field label="Tug'ilgan sana" hint="Kun, oy, yil" placeholder="03.02.1995" keyboardType="number-pad" maxLength={10}
            value={birth} onChangeText={(t) => setBirth(maskBirthDate(t))} />
          <Text style={{ color: colors.muted, marginBottom: 8, fontSize: 14 }}>Jinsi</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
            <GenderCard label="Erkak" icon="man-outline" active={gender === 'male'} onPress={() => setGender('male')} />
            <GenderCard label="Ayol" icon="woman-outline" active={gender === 'female'} onPress={() => setGender('female')} />
          </View>
        </>
      )}
      {step === 2 && (
        <>
          <Field label="Parol" hint="Kamida 8 belgi, harf va raqam" value={password} onChangeText={setPassword} secureTextEntry />
          <Field label="Parolni takrorlang" value={repeat} onChangeText={setRepeat} secureTextEntry />
        </>
      )}
      {step === 3 && (
        <>
          <Text style={[type.body, { marginBottom: 14 }]}>{cleanPhone} raqamiga SMS kod yuborildi.</Text>
          <Field label="SMS kod" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
        </>
      )}

      <ErrorText text={error} />
      <View style={shared.gap}>
        {step === 3
          ? <Button title="Ro'yxatdan o'tish" onPress={finish} busy={busy} disabled={code.length !== 6} />
          : <Button title="Davom etish" onPress={next} busy={busy} />}
        <Button title="Orqaga" kind="outline" onPress={() => {
          setError(null);
          if (step === 0) router.back();
          else setStep(step - 1);
        }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.line },
  barOn: { backgroundColor: colors.primary },
  gender: {
    flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  genderOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
