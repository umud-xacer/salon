// "Lazy auth": ilovani kirmasdan ko'rish mumkin. Bron, sevimlilar, bonuslar kabi shaxsiy amal bosilganda
// pastdan oyna chiqadi: telefon / Telegram / Google orqali kirish. Kirgach foydalanuvchi o'sha joyiga qaytadi
// (kirish ekranlarini Navigator yopadi — app/_layout.tsx).
import { track } from './analytics';
import { useRouter } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { ApiError } from './api';
import { useAuth } from './auth';
import { t } from './i18n';
import { loadLoginMethods, LoginMethods, signInWithGoogle } from './socialAuth';
import { BottomSheet, Button, ErrorText, Icon, makeStyles, Pressy, useTheme, useType } from './ui';

type Gate = {
  /** Kirgan bo'lsa true. Aks holda kirish oynasini ochadi va false qaytaradi. */
  requireAuth: (reason?: string) => boolean;
};

const GateContext = createContext<Gate>({ requireAuth: () => true });
export const useAuthGate = () => useContext(GateContext);

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { me, signIn } = useAuth();
  const router = useRouter();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState('');
  // Serverdan kelguncha telefon tugmasi ko'rinmaydi: SMS o'chiq bo'lsa bir lahza chiqib yo'qolmasin
  const [methods, setMethods] = useState<LoginMethods>({ sms: false, telegram: false, google: false });
  const [googleId, setGoogleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requireAuth = useCallback((why?: string) => {
    if (me) return true;
    setReason(why ?? t("Davom etish uchun profilingizga kiring yoki ro'yxatdan o'ting"));
    setError(null);
    setVisible(true);
    track('login_open');
    loadLoginMethods().then(({ methods: m, googleClientId }) => { setMethods(m); setGoogleId(googleClientId); });
    return false;
  }, [me]);

  const go = (path: '/login' | '/telegram-wait' | '/password') => {
    setVisible(false);
    track('login_method', { method: path.slice(1) });
    router.push(path);
  };

  const google = async () => {
    if (!googleId) return;
    track('login_method', { method: 'google' });
    setBusy(true);
    setError(null);
    try {
      const r = await signInWithGoogle(googleId);
      if (r.kind === 'login') {
        setVisible(false);
        await signIn(r.login);
      } else if (r.kind === 'link') {
        go('/login');                         // raqam bir marta tasdiqlanadi, so'ng Google bog'lanadi
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Google orqali kirib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => ({ requireAuth }), [requireAuth]);

  return (
    <GateContext.Provider value={value}>
      {children}
      <BottomSheet visible={visible && !me} title="" onClose={() => setVisible(false)}
        header={(
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <View style={s.badge}><Icon name="person-circle-outline" size={34} color={c.accent} /></View>
            <Text style={[ty.h2, { textAlign: 'center' }]}>{t("Profilingizga kiring")}</Text>
            <Text style={[ty.body, { color: c.muted, textAlign: 'center' }]}>{reason}</Text>
          </View>
        )}>
        <View style={{ gap: 10 }}>
          {methods.sms && <Button title={t("Telefon raqam bilan kirish")} icon="call-outline" onPress={() => go('/login')} />}
          {methods.telegram && (
            <Pressy onPress={() => go('/telegram-wait')} style={[s.social, { backgroundColor: '#229ED9', borderColor: '#229ED9' }]}
              accessibilityRole="button">
              <Icon name="paper-plane" size={20} color="#FFFFFF" />
              <Text style={[s.socialText, { color: '#FFFFFF' }]}>{t("Telegram orqali kirish")}</Text>
            </Pressy>
          )}
          {methods.google && (
            <Pressy onPress={google} disabled={busy} style={[s.social, busy && { opacity: 0.6 }]} accessibilityRole="button">
              <Icon name="logo-google" size={20} color={c.text} />
              <Text style={s.socialText}>{t("Google orqali kirish")}</Text>
            </Pressy>
          )}
          {/* SMS o'chiq paytda ham parolli hisoblar (masalan, Google Play tekshiruvchisi) kira olsin */}
          {!methods.sms && (methods.telegram || methods.google) && (
            <Button title={t("Parol bilan kirish")} kind="ghost" onPress={() => go('/password')} />
          )}
          <ErrorText text={error} />
          <Button title={t("Keyinroq")} kind="ghost" onPress={() => setVisible(false)} />
        </View>
      </BottomSheet>
    </GateContext.Provider>
  );
}

const useStyles = makeStyles((c) => ({
  badge: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  social: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 999,
    borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg,
  },
  socialText: { fontSize: 16, fontWeight: '700', color: c.text },
}));
