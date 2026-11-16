// SMS kodni tasdiqlash (prototip "B"): 6 katak, 59 soniyalik taymer, kod to'lishi bilan avtomatik tekshiriladi.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { t } from '../src/i18n';
import { getPendingLink, setPendingLink } from '../src/socialAuth';
import { ErrorText, formatPhone, IconButton, makeStyles, useTheme, useTopInset, useType } from '../src/ui';

const WAIT = 59;

export default function Otp() {
  const params = useLocalSearchParams<{ phone: string; dev?: string; channel?: string }>();
  const { phone, dev } = params;
  const [channel, setChannel] = useState(params.channel === 'telegram' ? 'telegram' : 'sms');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const top = useTopInset(12);
  const { signIn } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const input = useRef<TextInputInstance>(null);
  const [code, setCode] = useState(dev ?? '');
  const [left, setLeft] = useState(WAIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const link_token = getPendingLink() ?? undefined;
      const login = await api<LoginOut>('/auth/otp/verify', { method: 'POST', body: { phone, code: value, link_token } });
      setPendingLink(null);
      await signIn(login);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
      setCode('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  // Dev rejimida kod javobda keladi — darhol tekshiriladi (prod'da dev bo'sh)
  useEffect(() => {
    if (dev && dev.length === 6) void verify(dev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dev]);

  const onChange = (x: string) => {
    const v = x.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    setError(null);
    if (v.length === 6 && !busy) void verify(v);
  };

  const resend = async () => {
    setError(null);
    try {
      const r = await api<{ dev_code: string | null; channel?: 'sms' | 'telegram' }>('/auth/otp/request', { method: 'POST', body: { phone } });
      if (r.dev_code) setCode(r.dev_code);
      setChannel(r.channel === 'telegram' ? 'telegram' : 'sms');
      setLeft(WAIT);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    }
  };

  return (
    <View style={[s.screen, { paddingTop: top, paddingBottom: insets.bottom + 20 }]}>
      <View style={[s.blob, { backgroundColor: c.accentSoft }]} />
      <IconButton icon="chevron-back" label={t("Orqaga")} onPress={() => router.back()} />
      <View style={{ marginTop: 28, gap: 10 }}>
        <Text style={ty.display}>{t("Kodni kiriting")}</Text>
        <Text style={[ty.body, { color: c.muted, lineHeight: 22 }]}>
          {channel === 'telegram' ? t("6 xonali kod Telegramingizga (@ChronixUzBot) yuborildi:") : t("6 xonali kod yuborildi:")}{'\n'}
          <Text style={{ color: c.text, fontWeight: '800' }}>+998 {formatPhone((phone ?? '').replace(/^\+998/, ''))}</Text>
          {'  ·  '}
          <Text style={{ color: c.accent, fontWeight: '700' }} onPress={() => router.back()}>{t("O'zgartirish")}</Text>
        </Text>
      </View>

      <Pressable onPress={() => input.current?.focus()} style={s.boxes} accessibilityLabel={t("SMS kod")}>
        {Array.from({ length: 6 }, (_, i) => {
          const active = i === code.length && !busy;
          return (
            <View key={i} style={[s.box, code[i] && { borderColor: c.text }, active && s.boxActive]}>
              <Text style={s.digit}>{code[i] ?? ''}</Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput ref={input} value={code} onChangeText={onChange} keyboardType="number-pad" maxLength={6} autoFocus
        textContentType="oneTimeCode" autoComplete="sms-otp" style={s.hidden} accessibilityLabel={t("SMS kod")} />

      <View style={{ marginTop: 18, alignItems: 'center' }}>
        <ErrorText text={error} />
        {busy ? (
          <Text style={ty.small}>{t("Tekshirilmoqda…")}</Text>
        ) : left > 0 ? (
          <Text style={ty.small}>
            <Text style={{ color: c.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>00:{String(left).padStart(2, '0')}</Text>
            {' '}{t("dan keyin kodni qayta yuborish")}
          </Text>
        ) : (
          <Pressable onPress={resend} hitSlop={8} accessibilityRole="button">
            <Text style={ty.link}>{t("Kodni qayta yuborish")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 22, overflow: 'hidden' },
  blob: { position: 'absolute', width: 380, height: 380, borderRadius: 190, right: -170, top: -140 },
  boxes: { flexDirection: 'row', gap: 9, marginTop: 30 },
  box: {
    flex: 1, height: 62, borderRadius: 18, backgroundColor: c.surface, borderWidth: 2, borderColor: c.line,
    alignItems: 'center', justifyContent: 'center',
  },
  boxActive: { borderColor: c.accent, shadowColor: c.accent, shadowOpacity: 0.3, shadowRadius: 8, elevation: 2 },
  digit: { fontSize: 26, fontWeight: '800', color: c.text },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
}));
