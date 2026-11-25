// Kirish (Fresha/Figma uslubi): oq fon, logo, telefon raqam, qora "Davom etish". SMS kod ekraniga o'tiladi.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { getPendingLink, loadLoginMethods, LoginMethods, setPendingLink, signInWithGoogle } from '../src/socialAuth';
import { t } from '../src/i18n';
import { LangSwitch } from '../src/LangSwitch';
import { Button, ErrorText, formatPhone, phoneReady, Icon, IconButton, makeStyles, Pressy, useTheme, useTopInset, useType } from '../src/ui';

export const PRIVACY_URL = 'https://chronix.uz/privacy';

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const top = useTopInset(16);
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [digits, setDigits] = useState('');
  const [cc, setCc] = useState('998');                  // mamlakat kodi: 998 — O'zbekiston, 7 — Rossiya/Qozog'iston ...
  const uz = cc === '998';
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<LoginMethods | null>(null);   // null — serverdan hali kelmadi
  const [googleId, setGoogleId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [linking, setLinking] = useState(!!getPendingLink());
  const { signIn } = useAuth();
  const ready = phoneReady(cc, digits);

  useEffect(() => {
    loadLoginMethods().then(({ methods: m, googleClientId }) => { setMethods(m); setGoogleId(googleClientId); });
  }, []);
  useFocusEffect(useCallback(() => { setLinking(!!getPendingLink()); }, []));

  const google = async () => {
    if (!googleId) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const r = await signInWithGoogle(googleId);
      if (r.kind === 'login') await signIn(r.login);
      else if (r.kind === 'link') setLinking(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Google orqali kirib bo'lmadi"));
    } finally {
      setGoogleBusy(false);
    }
  };

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const phone = `+${cc}${digits}`;
      const r = await api<{ dev_code: string | null; channel?: 'sms' | 'telegram' }>('/auth/otp/request', { method: 'POST', body: { phone } });
      router.push({ pathname: '/otp', params: { phone, dev: r.dev_code ?? '', channel: r.channel ?? 'sms' } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sms_unavailable' && methods?.telegram) {
        setError(t("SMS xizmati vaqtincha band. Kodni olish uchun quyidagi «Telegram orqali kirish» tugmasini bosing"));
      } else {
        setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: top, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {router.canGoBack()
            ? <IconButton icon="close" label={t("Yopish")} onPress={() => router.back()} />
            : <View />}
          <LangSwitch />
        </View>

        <View style={s.brand}>
          <View style={s.logo}>
            <Image source={require('../assets/brand/ring.png')} style={{ width: 52, height: 52 }} resizeMode="contain" />
          </View>
          <Text style={ty.display}>{t("Chronix'ga xush kelibsiz")}</Text>
          <Text style={[ty.body, { color: c.muted }]}>
            {t("Salon, sartaroshxona va SPA'ga bir necha soniyada yoziling.")}
          </Text>
        </View>

        <View style={{ gap: 14 }}>
          {linking && (
            <View style={s.linkNote}>
              <Icon name="logo-google" size={18} color={c.accent} />
              <Text style={[ty.small, { flex: 1, color: c.text }]}>
                {t("Google hisobingizni bog'lash uchun telefon raqamingizni bir marta tasdiqlang. Keyingi safar Google bilan bir bosishda kirasiz.")}
              </Text>
              <Pressable onPress={() => { setPendingLink(null); setLinking(false); }} hitSlop={8} accessibilityRole="button"
                accessibilityLabel={t("Bekor qilish")}>
                <Icon name="close" size={18} color={c.muted} />
              </Pressable>
            </View>
          )}
          {!methods && <ActivityIndicator color={c.muted} style={{ paddingVertical: 24 }} />}
          {methods?.sms && (
            <>
              <Text style={ty.h3}>{t("Telefon raqamingiz")}</Text>
              <View style={[s.phone, (focus || ready) && { borderColor: c.text }]}>
                <Text style={s.prefix}>+</Text>
                <TextInput value={cc} onChangeText={(x) => { setCc(x.replace(/\D/g, '').slice(0, 3)); setDigits(''); }}
                  keyboardType="number-pad" maxLength={3} accessibilityLabel={t("Mamlakat kodi")}
                  style={[s.prefix, { minWidth: 34, paddingVertical: 0 }]} />
                <View style={s.divider} />
                <TextInput value={uz ? formatPhone(digits) : digits}
                  onChangeText={(x) => setDigits(x.replace(/\D/g, '').slice(0, uz ? 9 : 13))}
                  keyboardType="phone-pad" placeholder={uz ? '90 123 45 67' : '916 123 45 67'} placeholderTextColor={c.muted}
                  onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} accessibilityLabel={t("Telefon raqam")}
                  onSubmitEditing={() => ready && request()} style={s.phoneInput} maxLength={12} />
              </View>
              <Text style={ty.small}>{t("Raqamingizga 6 xonali kod yuboramiz")}</Text>
            </>
          )}
          {methods && !methods.sms && (
            <Text style={[ty.body, { color: c.muted }]}>
              {linking
                ? t("Raqamingizni Telegram orqali tasdiqlang — Google hisobingiz unga bog'lanadi.")
                : t("Telegram yoki Google orqali bir bosishda kiring.")}
            </Text>
          )}
          <ErrorText text={error} />
          {methods?.sms && <Button title={t("Davom etish")} onPress={request} busy={busy} disabled={!ready} />}
          {methods && (
            <Pressable onPress={() => router.push('/password')} hitSlop={6} style={{ alignItems: 'center', paddingVertical: 6 }}
              accessibilityRole="button">
              <Text style={[ty.link, { fontSize: 15 }]}>{t("Parol bilan kirish")}</Text>
            </Pressable>
          )}

          {methods && (methods.telegram || (methods.google && !linking)) && (
            <View style={s.or}>
              <View style={s.orLine} /><Text style={ty.small}>{t("yoki")}</Text><View style={s.orLine} />
            </View>
          )}
          {methods?.telegram && (
            <Pressy onPress={() => router.push('/telegram-wait')} style={[s.social, { backgroundColor: '#229ED9', borderColor: '#229ED9' }]}
              accessibilityRole="button">
              <Icon name="paper-plane" size={20} color="#FFFFFF" />
              <Text style={[s.socialText, { color: '#FFFFFF' }]}>{t("Telegram orqali kirish")}</Text>
            </Pressy>
          )}
          {methods?.google && !linking && (
            <Pressy onPress={google} disabled={googleBusy} style={[s.social, googleBusy && { opacity: 0.6 }]} accessibilityRole="button">
              <Icon name="logo-google" size={20} color={c.text} />
              <Text style={s.socialText}>{t("Google orqali kirish")}</Text>
            </Pressy>
          )}
        </View>

        <Text style={[ty.small, { textAlign: 'center', marginTop: 'auto', paddingTop: 24 }]}>
          {t("Davom etib, Foydalanish shartlari va")}{' '}
          <Text style={{ color: c.accent, fontWeight: '600' }} onPress={() => { Linking.openURL(PRIVACY_URL).catch(() => {}); }}
            accessibilityRole="link">{t("Maxfiylik siyosati")}</Text>
          {t("ga rozilik bildirasiz")}
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
  or: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  orLine: { flex: 1, height: 1, backgroundColor: c.line },
  social: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 999,
    borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg,
  },
  socialText: { fontSize: 16, fontWeight: '700', color: c.text },
  linkNote: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.accentSoft },
}));
