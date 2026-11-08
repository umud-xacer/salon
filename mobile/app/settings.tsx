import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform, ScrollView, Text, View } from 'react-native';

import { ChronixAlarmModule } from '../modules/chronix-alarm';
import { api } from '../src/api';
import { scheduleTestAlarm } from '../src/localReminders';
import { ensureNotificationPermission, pushStatus } from '../src/notifications';
import { useAuth } from '../src/auth';
import { Button, Card, colors, shared, type } from '../src/ui';

import { t } from "../src/i18n";
import { LangSwitch } from "../src/LangSwitch";
export default function Settings() {
  const [fullScreen, setFullScreen] = useState(true);
  const [support, setSupport] = useState<{ support_phone: string | null; support_telegram: string | null } | null>(null);
  const { me } = useAuth();
  const router = useRouter();

  const [exact, setExact] = useState(true);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    ChronixAlarmModule?.canUseFullScreen().then(setFullScreen).catch(() => {});
    if (Platform.OS === 'android') {
      Notifications.getExactAlarmPermissionsAsync().then((r) => setExact(r.granted || !r.canAskAgain)).catch(() => {});
    }
  }, []);

  const testAlarm = async () => {
    if (!(await ensureNotificationPermission())) {
      Alert.alert(t("Ruxsat kerak"), t("Telefon sozlamalarida Chronix uchun bildirishnomalarni yoqing."));
      return;
    }
    setTestSent(true);
    await scheduleTestAlarm(10).catch(() => {});
    setTimeout(() => setTestSent(false), 12_000);
  };

  useEffect(() => {
    api<{ support_phone: string | null; support_telegram: string | null }>('/catalog/app-info')
      .then(setSupport).catch(() => {});
  }, []);

  const phone = support?.support_phone;
  const telegram = support?.support_telegram?.replace(/^@/, '');

  return (
    <ScrollView style={shared.screen}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={type.h3}>{t("Ilova tili")}</Text>
            <Text style={[type.small, { marginTop: 4 }]}>{t("Tanlangan til qurilmada saqlanadi")}</Text>
          </View>
          <LangSwitch />
        </View>
      </Card>
      <Card>
        <Text style={type.h3}>{t("Bron eslatmalari")}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>
          {t("Bron vaqti yaqinlashganda ilova budilnik kabi eslatadi.")}
        </Text>
        <Text style={[type.small, { marginTop: 4 }]}>
          {me?.workspace === 'business'
            ? t("Mijoz 20 daqiqa qolganda javob bermasa, ilova ovoz bilan ogohlantiradi va qo'ng'iroq tugmasini beradi.")
            : t("30 daqiqa qolganda telefoningizda budilnik chalinadi: \"Boraman\" yoki \"Bormayman\" ni tanlang.")}
        </Text>
        <View style={[shared.gap, { marginTop: 12 }]}>
          <Button title={testSent ? t("Budilnik 10 soniyada chalinadi…") : t("Budilnikni sinash (10 soniya)")} kind="soft" compact
            icon="alarm-outline" disabled={testSent} onPress={testAlarm} />
          {!fullScreen && (
            <Button title={t("To'liq ekranli eslatmaga ruxsat berish")} kind="soft" compact
              onPress={() => ChronixAlarmModule?.openFullScreenSettings()} />
          )}
          {!exact && (
            <Button title={t("Aniq vaqtda chalinishiga ruxsat berish")} kind="soft" compact
              onPress={() => { Notifications.requestExactAlarmPermissionsAsync().then((r) => setExact(r.granted)).catch(() => {}); }} />
          )}
        </View>
        <Text style={[type.small, { marginTop: 10, color: colors.muted }]}>
          {pushStatus === 'ok'
            ? t("Server xabarlari ulangan: ilova yopiq bo'lsa ham ogohlantirish keladi.")
            : t("Server xabarlari (push) hali ulanmagan: budilnik telefonning o'zida ishlaydi, salon ogohlantirishlari esa ilova ochiq bo'lganda keladi.")}
        </Text>
      </Card>
      <Card>
        <Text style={type.h3}>{t("Qo'llab-quvvatlash")}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>
          {t("Bron bo'yicha savol bo'lsa, salon sahifasidagi telefon orqali bog'laning. Ilova bo'yicha muammo bo'lsa — bizga yozing.")}
        </Text>
        {(phone || telegram) && (
          <View style={[shared.gap, { marginTop: 12 }]}>
            {phone && <Button title={t("Qo'ng'iroq: {a}", { a: phone })} kind="soft" compact icon="call-outline"
              onPress={() => { Linking.openURL(`tel:${phone.replace(/[^+\d]/g, '')}`).catch(() => {}); }} />}
            {telegram && <Button title={t("Telegram: @{a}", { a: telegram })} kind="soft" compact icon="paper-plane-outline"
              onPress={() => { Linking.openURL(`https://t.me/${encodeURIComponent(telegram)}`).catch(() => {}); }} />}
          </View>
        )}
      </Card>
      {me && (
        <Card>
          <Text style={type.h3}>{t("Xavfsizlik")}</Text>
          {me.workspace === 'business' ? (
            <Text style={[type.small, { marginTop: 4 }]}>
              {t("Siz salon xodimisiz: parolingizni faqat rahbaringiz beradi va o'zgartiradi.")}
            </Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              <Button title={t("Parolni almashtirish")} kind="soft" compact icon="lock-closed-outline"
                onPress={() => router.push('/change-password')} />
            </View>
          )}
        </Card>
      )}
      <Card>
        <Text style={type.h3}>{t("Ilova haqida")}</Text>
        <Text style={[type.small, { marginTop: 4, color: colors.muted }]}>
          {t("Versiya {a} {b}", { a: Constants.expoConfig?.version ?? '1.0.0', b: Updates.updateId ? ` · ${Updates.updateId.slice(0, 8)}` : '' })}
        </Text>
      </Card>
    </ScrollView>
  );
}
