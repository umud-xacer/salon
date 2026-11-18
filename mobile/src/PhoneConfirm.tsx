// Bron oldidan: "Sizning raqamingiz +998 .. — to'g'rimi?" (7 kunda bir marta).
// Asosiy raqam kirish uchun tasdiqlangan, shu yerda o'zgarmaydi; hozir boshqa raqamdan foydalansa —
// uni zaxira (aloqa) raqami qilib yozadi, salon shunga qo'ng'iroq qiladi.
import { track } from './analytics';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Text, View } from 'react-native';

import { api, ApiError, User } from './api';
import { t } from './i18n';
import { Button, ErrorText, Field, formatPhone, prettyPhone, useTheme, useType } from './ui';

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Eski server maydonni yubormasa (undefined) — so'ramaymiz */
export const needsPhoneConfirm = (user: User | undefined) =>
  !!user && user.phone_confirmed_at !== undefined &&
  (!user.phone_confirmed_at || Date.now() - new Date(user.phone_confirmed_at).getTime() > WEEK_MS);

const pretty = (phone: string) => prettyPhone(phone);

export function PhoneConfirm({ user, visible, onDone, onClose }: {
  user: User; visible: boolean; onDone: () => void; onClose: () => void;
}) {
  const { c } = useTheme();
  const ty = useType();
  const [edit, setEdit] = useState(false);
  const [backup, setBackup] = useState((user.backup_phone ?? '').replace(/^\+998/, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (withBackup: boolean) => {
    if (withBackup && backup.length !== 9) return setError(t("Raqamni to'liq kiriting (9 ta raqam)"));
    setBusy(true);
    setError(null);
    try {
      await api<User>('/auth/me/confirm-phone', { method: 'POST', body: { backup_phone: withBackup ? `+998${backup}` : null } });
      track('phone_confirm', { changed: withBackup });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Saqlab bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: c.overlay }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: c.bg, borderRadius: 24, padding: 20, gap: 12 }}>
          <Text style={ty.h1}>{t("Telefon raqamingizni tasdiqlang")}</Text>
          <Text style={[ty.body, { color: c.muted }]}>
            {t("Salon siz bilan shu raqam orqali bog'lanadi:")}
          </Text>
          <Text style={[ty.h1, { fontSize: 22 }]}>{pretty(user.phone)}</Text>
          {user.backup_phone && !edit && (
            <Text style={ty.small}>{t("Zaxira raqam")}: {pretty(user.backup_phone)}</Text>
          )}
          {edit && (
            <>
              <Text style={ty.small}>
                {t("Hozir qaysi raqamdan foydalanyapsiz? Uni zaxira raqam qilib saqlaymiz — salon shunga qo'ng'iroq qiladi.")}
              </Text>
              <Field label={t("Joriy telefon raqam")} placeholder="90 123 45 67" keyboardType="phone-pad" maxLength={12}
                value={formatPhone(backup)} autoFocus
                onChangeText={(x) => setBackup(x.replace(/\D/g, '').replace(/^998/, '').slice(0, 9))} />
            </>
          )}
          <ErrorText text={error} />
          {edit ? (
            <>
              <Button title={t("Saqlash va davom etish")} onPress={() => save(true)} busy={busy} disabled={backup.length !== 9} />
              <Button title={t("Ortga")} kind="ghost" onPress={() => setEdit(false)} />
            </>
          ) : (
            <>
              <Button title={t("Ha, raqam to'g'ri")} onPress={() => save(false)} busy={busy} />
              <Button title={t("Boshqa raqamdan foydalanyapman")} kind="outline" onPress={() => setEdit(true)} />
              <Button title={t("Bekor qilish")} kind="ghost" onPress={onClose} />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
