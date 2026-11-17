// Yangi mijoz: ism, (ixtiyoriy) tug'ilgan sana va jins, qiziqishlar (prototip "C").
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, Category, User } from '../src/api';
import { useAuth } from '../src/auth';
import { bioAsked, bioKind } from '../src/biometric';
import { categoryIcon } from '../src/categories';
import { pick, t } from '../src/i18n';
import { setInterests } from '../src/interests';
import {
  Avatar, Button, Chip, ErrorText, Field, formatPhone, Icon, makeStyles, maskBirthDate, parseBirthDate, Pressy, Steps, useTheme, useType,
} from '../src/ui';

export default function Onboarding() {
  const { me, refresh, setSetup } = useAuth();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [name, setName] = useState(me?.user.full_name ?? '');
  const [birth, setBirth] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  // Zaxira raqam: asosiy raqam o'chib qolsa salon shunga qo'ng'iroq qiladi (9 raqam, +998 siz)
  const [backup, setBackup] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Category[]>('/catalog/categories').then(setCategories).catch(() => {});
  }, []);

  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));

  const save = async () => {
    const birthDate = birth ? parseBirthDate(birth) : null;
    if (name.trim().length < 2) return setError(t("Ismingizni kiriting"));
    if (birth && !birthDate) return setError(t("Tug'ilgan sanani 03.02.1995 ko'rinishida kiriting"));
    if (backup && backup.length !== 9) return setError(t("Zaxira raqamni to'liq kiriting (9 ta raqam)"));
    setBusy(true);
    setError(null);
    try {
      await api<User>('/auth/me', { method: 'PATCH', body: { full_name: name.trim(), birth_date: birthDate, gender } });
      // Asosiy raqam hozirgina tasdiqlandi — keyingi tekshiruv 7 kundan keyin (bron oldidan)
      await api<User>('/auth/me/confirm-phone', { method: 'POST', body: { backup_phone: backup ? `+998${backup}` : null } });
      await setInterests(picked);
      await refresh();
      setSetup(!bioAsked() && (await bioKind()) ? 'biometric' : null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Saqlab bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.blob, { backgroundColor: c.accentSoft }]} />
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 44 }}><Steps step={2} total={3} /></View>
        <Text style={[ty.display, { marginTop: 22 }]}>{t("Tanishaylik")}</Text>
        <Text style={[ty.body, { color: c.muted, marginTop: 6, marginBottom: 20 }]}>{t("Ismingizni ustalar va klinikalar ko'radi")}</Text>

        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Avatar name={name || '?'} size={76} />
          <View style={{ flex: 1 }}>
            <Field label={t("Ism va familiya")} value={name} onChangeText={setName} autoCapitalize="words" maxLength={120} />
          </View>
        </View>
        <Field label={t("Tug'ilgan sana (ixtiyoriy)")} placeholder="03.02.1995" keyboardType="number-pad" maxLength={10}
          value={birth} onChangeText={(x) => setBirth(maskBirthDate(x))} />
        {me?.user.phone && (
          <Text style={[ty.small, { marginBottom: 8 }]}>
            {t("Asosiy raqam")}: <Text style={{ color: c.text, fontWeight: '700' }}>{me.user.phone}</Text>
          </Text>
        )}
        <Field label={t("Zaxira telefon raqam")} placeholder="90 123 45 67" keyboardType="phone-pad" maxLength={12}
          value={formatPhone(backup)} onChangeText={(x) => setBackup(x.replace(/\D/g, '').replace(/^998/, '').slice(0, 9))} />
        <Text style={[ty.small, { marginTop: -6, marginBottom: 12 }]}>
          {t("Asosiy raqamingiz javob bermasa, salon shu raqamga qo'ng'iroq qiladi. Kirish uchun ishlatilmaydi.")}
        </Text>
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          <Chip label={t("Erkak")} icon="man-outline" active={gender === 'male'} onPress={() => setGender(gender === 'male' ? null : 'male')} />
          <Chip label={t("Ayol")} icon="woman-outline" active={gender === 'female'} onPress={() => setGender(gender === 'female' ? null : 'female')} />
        </View>

        {categories.length > 0 && (
          <>
            <Text style={[ty.caps, { marginTop: 18 }]}>{t("Sizni nima qiziqtiradi?")}</Text>
            <Text style={[ty.small, { marginTop: 4, marginBottom: 12 }]}>{t("Bosh sahifada shu yo'nalishlarni birinchi ko'rsatamiz")}</Text>
            <View style={s.grid}>
              {categories.map((cat) => {
                const on = picked.includes(cat.slug);
                return (
                  <Pressy key={cat.id} onPress={() => toggle(cat.slug)} style={[s.tile, on && s.tileOn]} scaleTo={0.95}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <View style={[s.tileIcon, on && { backgroundColor: c.accent }]}>
                      <Icon name={categoryIcon(cat)} size={20} color={on ? c.onAccent : c.text} />
                    </View>
                    <Text style={s.tileText} numberOfLines={2}>{pick(cat.name_uz, cat.name_ru)}</Text>
                  </Pressy>
                );
              })}
            </View>
          </>
        )}

        <View style={{ marginTop: 22 }}>
          <ErrorText text={error} />
          <Button title={t("Davom etish")} onPress={save} busy={busy} disabled={name.trim().length < 2} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c) => ({
  blob: { position: 'absolute', width: 360, height: 360, borderRadius: 180, left: -170, top: -110 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18,
    backgroundColor: c.surface, borderWidth: 2, borderColor: c.line,
  },
  tileOn: { borderColor: c.accent, backgroundColor: c.accentSoft },
  tileIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  tileText: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text },
}));
