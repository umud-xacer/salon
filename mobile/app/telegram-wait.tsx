// Telegram orqali kirish: bot havolasini ochadi va foydalanuvchi botga raqamini yuborguncha kutadi.
// Ilova har 2 soniyada va Telegram'dan qaytganda so'raydi; tasdiqlangach avtomatik kiradi.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, LoginOut } from '../src/api';
import { useAuth } from '../src/auth';
import { t } from '../src/i18n';
import { getPendingLink, setPendingLink } from '../src/socialAuth';
import { Button, ErrorText, Icon, IconButton, makeStyles, useTheme, useTopInset, useType } from '../src/ui';

type Start = { nonce: string; url: string; expires_in: number };

export default function TelegramWait() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const top = useTopInset(12);
  const { signIn } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [req, setReq] = useState<Start | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const busy = useRef(false);
  const done = useRef(false);

  const open = (url: string) => { Linking.openURL(url).catch(() => setError(t("Telegram ochilmadi. Telegram ilovasi o'rnatilganini tekshiring"))); };

  const begin = useCallback(async () => {
    setError(null);
    setExpired(false);
    try {
      const r = await api<Start>('/auth/telegram/start', { method: 'POST', body: { link_token: getPendingLink() ?? undefined } });
      setReq(r);
      open(r.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    }
  }, []);

  const poll = useCallback(async () => {
    if (!req || busy.current || done.current) return;
    busy.current = true;
    try {
      const r = await api<{ status: 'pending' | 'ok'; login: LoginOut | null }>('/auth/telegram/poll', {
        method: 'POST', body: { nonce: req.nonce } });
      if (r.status === 'ok' && r.login) {
        done.current = true;
        setPendingLink(null);
        await signIn(r.login);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setExpired(true); setReq(null); }
    } finally {
      busy.current = false;
    }
  }, [req, signIn]);

  useEffect(() => { void begin(); }, [begin]);

  useEffect(() => {
    if (!req) return;
    const timer = setInterval(() => { void poll(); }, 2000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void poll(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [req, poll]);

  return (
    <View style={[s.screen, { paddingTop: top, paddingBottom: insets.bottom + 20 }]}>
      <IconButton icon="chevron-back" label={t("Orqaga")} onPress={() => router.back()} />
      <View style={s.body}>
        <View style={s.badge}><Icon name="paper-plane" size={34} color="#FFFFFF" /></View>
        <Text style={[ty.display, { textAlign: 'center' }]}>{t("Telegram orqali kirish")}</Text>
        {!expired ? (
          <>
            <Text style={[ty.body, { color: c.muted, textAlign: 'center', lineHeight: 22 }]}>
              {t("Telegram'da Chronix botini oching va «Raqamni yuborish» tugmasini bosing. Keyin shu yerga qayting — kirish avtomatik bo'ladi.")}
            </Text>
            <View style={s.steps}>
              {[t("«Start» ni bosing"), t("«📱 Raqamni yuborish» ni bosing"), t("Chronix'ga qayting")].map((x, i) => (
                <View key={i} style={s.step}>
                  <View style={s.num}><Text style={s.numText}>{i + 1}</Text></View>
                  <Text style={[ty.body, { flex: 1 }]}>{x}</Text>
                </View>
              ))}
            </View>
            {req && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <ActivityIndicator color={c.accent} />
                <Text style={ty.small}>{t("Tasdiqlash kutilmoqda…")}</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={[ty.body, { color: c.muted, textAlign: 'center' }]}>{t("Kirish so'rovi eskirgan. Qaytadan urinib ko'ring.")}</Text>
        )}
        <ErrorText text={error} />
      </View>
      <View style={{ gap: 10 }}>
        {req && !expired
          ? <Button title={t("Telegram'ni qayta ochish")} onPress={() => open(req.url)} />
          : <Button title={t("Qaytadan boshlash")} onPress={() => { void begin(); }} />}
        <Button title={t("SMS orqali kirish")} kind="soft" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 24 },
  body: { flex: 1, justifyContent: 'center', gap: 16 },
  badge: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: '#229ED9', alignItems: 'center', justifyContent: 'center' },
  steps: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: c.surface2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  numText: { fontWeight: '800', color: c.text },
}));
