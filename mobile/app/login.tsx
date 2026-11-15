// Kirish (Fresha/Figma uslubi): oq fon, logo, telefon raqam, qora "Davom etish". SMS kod ekraniga o'tiladi.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../src/api';
import { t } from '../src/i18n';
import { LangSwitch } from '../src/LangSwitch';
import { Button, ErrorText, formatPhone, makeStyles, useTheme, useType } from '../src/ui';

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
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
      const r = await api<{ dev_code: string | null }>('/auth/otp/request', { method: 'POST', body: { phone } });
      router.push({ pathname: '/otp', params: { phone, dev: r.dev_code ?? '' } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'flex-end' }}><LangSwitch /></View>

        <View style={s.brand}>
          <View style={s.logo}>
            <Image source={require('../assets/brand/ring.png')} style={{ width: 52, height: 52 }} resizeMode="contain" />
          </View>
          <Text style={ty.display}>{t("Chronix'ga xush kelibsiz")}</Text>
          <Text style={[ty.body, { color: c.muted }]}>
            {t("Salon, sartaroshxona, klinika va SPA'ga bir necha soniyada yoziling.")}
          </Text>
        </View>

        <View style={{ gap: 14 }}>
          <Text style={ty.h3}>{t("Telefon raqamingiz")}</Text>
          <View style={[s.phone, (focus || ready) && { borderColor: c.text }]}>
            <Text style={s.prefix}>+998</Text>
            <View style={s.divider} />
            <TextInput value={formatPhone(digits)} onChangeText={(x) => setDigits(x.replace(/\D/g, '').slice(0, 9))}
              keyboardType="phone-pad" placeholder="90 123 45 67" placeholderTextColor={c.muted}
              onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} accessibilityLabel={t("Telefon raqam")}
              onSubmitEditing={() => ready && request()} style={s.phoneInput} maxLength={12} />
          </View>
          <Text style={ty.small}>{t("Raqamingizga 6 xonali kod yuboramiz")}</Text>
          <ErrorText text={error} />
          <Button title={t("Davom etish")} onPress={request} busy={busy} disabled={!ready} />
          <Pressable onPress={() => router.push('/password')} hitSlop={6} style={{ alignItems: 'center', paddingVertical: 6 }}
            accessibilityRole="button">
            <Text style={[ty.link, { fontSize: 15 }]}>{t("Parol bilan kirish")}</Text>
          </Pressable>
        </View>

        <Text style={[ty.small, { textAlign: 'center', marginTop: 'auto', paddingTop: 24 }]}>
          {t("Davom etib, Foydalanish shartlari va Maxfiylik siyosatiga rozilik bildirasiz")}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  brand: { gap: 10, paddingTop: 36, paddingBottom: 36 },
  logo: { width: 76, height: 76, borderRadius: 24, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  phone: {
    flexDirection: 'row', alignItems: 'center', height: 58, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1.5,
    borderColor: c.line, backgroundColor: c.bg,
  },
  prefix: { fontSize: 17, fontWeight: '600', color: c.text },
  divider: { width: 1, height: 24, backgroundColor: c.line, marginHorizontal: 14 },
  phoneInput: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '600', color: c.text, letterSpacing: 0.3 },
}));
