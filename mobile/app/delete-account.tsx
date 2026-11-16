// Hisobni o'chirish (Google Play talabi): nima o'chishi tushuntiriladi, tasdiq so'zi yoziladi.
import { useState } from 'react';
import { Linking, ScrollView, Text, TextInput, View } from 'react-native';

import { api, ApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { t } from '../src/i18n';
import { Button, ErrorText, Icon, makeStyles, useBottomSpace, useTheme, useType } from '../src/ui';

export const DELETE_INFO_URL = 'https://chronix.uz/hisobni-ochirish';

export default function DeleteAccount() {
  const { signOut } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const bottom = useBottomSpace(16);
  const word = t("O'CHIRISH");
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = typed.trim().toUpperCase() === word.toUpperCase();

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/me', { method: 'DELETE' });
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
      setBusy(false);
    }
  };

  const items: [string, string][] = [
    ['person-remove-outline', t("Ism, telefon raqam, tug'ilgan sana va boshqa profil ma'lumotlari")],
    ['heart-dislike-outline', t("Sevimlilar, bildirishnomalar va kirish sessiyalari")],
    ['calendar-clear-outline', t("Kelgusi bronlaringiz bekor qilinadi")],
    ['logo-google', t("Google va Telegram bilan bog'lanish")],
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 24, paddingBottom: bottom, gap: 18 }}
      keyboardShouldPersistTaps="handled">
      <View style={s.warn}>
        <Icon name="warning-outline" size={22} color={c.danger} />
        <Text style={[ty.body, { flex: 1, color: c.text }]}>
          {t("Hisob butunlay o'chiriladi. Bu amalni qaytarib bo'lmaydi.")}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <Text style={ty.h3}>{t("Nima o'chiriladi")}</Text>
        {items.map(([icon, text]) => (
          <View key={icon} style={s.item}>
            <Icon name={icon as never} size={19} color={c.muted} />
            <Text style={[ty.body, { flex: 1 }]}>{text}</Text>
          </View>
        ))}
        <Text style={ty.small}>
          {t("Salonlar o'tgan tashriflaringiz yozuvini o'z hisobida saqlab qolishi mumkin (to'lov va hisobot uchun). Qoldirgan sharhlaringiz ismingizsiz qoladi.")}
        </Text>
        <Text style={[ty.small, { color: c.accent }]} onPress={() => { Linking.openURL(DELETE_INFO_URL).catch(() => {}); }}
          accessibilityRole="link">{t("Batafsil: chronix.uz/hisobni-ochirish")}</Text>
      </View>

      <View style={{ gap: 10 }}>
        <Text style={ty.h3}>{t("Tasdiqlash uchun «{a}» deb yozing", { a: word })}</Text>
        <TextInput value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false}
          placeholder={word} placeholderTextColor={c.off} style={s.input} accessibilityLabel={t("Tasdiqlash so'zi")} />
        <ErrorText text={error} />
        <Button title={t("Hisobni butunlay o'chirish")} kind="danger" onPress={remove} busy={busy} disabled={!ok} />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  warn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, backgroundColor: c.dangerSoft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: {
    height: 54, borderRadius: 16, borderWidth: 1.5, borderColor: c.line, paddingHorizontal: 16, fontSize: 17, fontWeight: '700',
    color: c.text, letterSpacing: 1,
  },
}));
