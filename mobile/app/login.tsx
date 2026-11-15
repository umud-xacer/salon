// Xush kelibsiz + telefon raqam (prototip "A"). Kod olinadi va SMS kod ekraniga o'tiladi.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../src/api';
import { t } from '../src/i18n';
import { LangSwitch } from '../src/LangSwitch';
import { Button, ErrorText, formatPhone, Glass, Gradient, IconButton, makeStyles, useTheme, useType } from '../src/ui';

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, dark, setMode } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [digits, setDigits] = useState('');
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = digits.length === 9;

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const phone = `+998${digits}`;
      const r = await api<{ dev_code: string | null; expires_in: number }>('/auth/otp/request', { method: 'POST', body: { phone } });
      router.push({ pathname: '/otp', params: { phone, dev: r.dev_code ?? '' } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Gradient colors={c.hero} style={s.hero}>
        <View style={[s.blob, { left: -90, top: -40, backgroundColor: 'rgba(255,255,255,0.16)' }]} />
        <View style={[s.blob, { right: -110, top: 180, width: 300, height: 300, backgroundColor: 'rgba(120,200,255,0.22)' }]} />
      </Gradient>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }}
          keyboardShouldPersistTaps="handled">
          <View style={s.top}>
            <LangSwitch glass />
            <IconButton icon={dark ? 'sunny-outline' : 'moon-outline'} glass label={t("Rejimni almashtirish")}
              onPress={() => setMode(dark ? 'light' : 'dark')} />
          </View>

          <View style={s.brand}>
            <View style={s.logo}>
              <Image source={require('../assets/brand/ring.png')} style={{ width: 54, height: 54 }} resizeMode="contain" />
            </View>
            <Image source={require('../assets/brand/wordmark.png')} style={{ width: 200, height: 48 }} resizeMode="contain" />
            <Text style={s.tagline}>{t("Vaqtingiz — bizning ustuvorligimiz.")}{'\n'}{t("Salon, klinika va SPA — bir necha soniyada.")}</Text>
          </View>

          <Glass style={s.card} intensity={60} tint={c.glass}>
            <View style={{ gap: 4 }}>
              <Text style={ty.h2}>{t("Kirish yoki ro'yxatdan o'tish")}</Text>
              <Text style={ty.small}>{t("Raqamingizga 6 xonali kod yuboramiz")}</Text>
            </View>
            <View style={[s.phone, (focus || ready) && { borderColor: c.accent }]}>
              <View style={s.prefix}><Text style={s.prefixText}>UZ +998</Text></View>
              <TextInput value={formatPhone(digits)} onChangeText={(x) => setDigits(x.replace(/\D/g, '').slice(0, 9))}
                keyboardType="phone-pad" placeholder="90 123 45 67" placeholderTextColor={c.muted} autoFocus={false}
                onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} accessibilityLabel={t("Telefon raqam")}
                onSubmitEditing={() => ready && request()} style={s.phoneInput} maxLength={12} />
            </View>
            <ErrorText text={error} />
            <Button title={t("Kodni olish")} icon="arrow-forward" onPress={request} busy={busy} disabled={!ready} />
            <Pressable onPress={() => router.push('/password')} hitSlop={6} style={{ alignItems: 'center', paddingVertical: 4 }}
              accessibilityRole="button">
              <Text style={ty.link}>{t("Parol bilan kirish")}</Text>
            </Pressable>
            <Text style={[ty.small, { textAlign: 'center', fontSize: 12 }]}>
              {t("Davom etib, Foydalanish shartlari va Maxfiylik siyosatiga rozilik bildirasiz")}
            </Text>
          </Glass>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((c, dark) => ({
  hero: { position: 'absolute', left: 0, right: 0, top: 0, height: '62%', overflow: 'hidden' },
  blob: { position: 'absolute', width: 340, height: 340, borderRadius: 170 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 28, paddingVertical: 28 },
  logo: {
    width: 88, height: 88, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  tagline: { color: 'rgba(255,255,255,0.88)', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  card: { marginHorizontal: 16, borderRadius: 30, padding: 20, gap: 14, borderColor: dark ? 'rgba(255,255,255,0.12)' : c.line },
  phone: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 60, paddingLeft: 8, paddingRight: 14, borderRadius: 18,
    backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.line,
  },
  prefix: { paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: c.surface2 },
  prefixText: { fontSize: 15, fontWeight: '800', color: c.text },
  phoneInput: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '700', color: c.text, letterSpacing: 0.5 },
}));
