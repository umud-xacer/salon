import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { ChronixAlarmModule } from '../modules/chronix-alarm';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { Button, Card, colors, shared, type } from '../src/ui';

export default function Settings() {
  const [fullScreen, setFullScreen] = useState(true);
  const [support, setSupport] = useState<{ support_phone: string | null; support_telegram: string | null } | null>(null);
  const { me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    ChronixAlarmModule?.canUseFullScreen().then(setFullScreen).catch(() => {});
  }, []);

  useEffect(() => {
    api<{ support_phone: string | null; support_telegram: string | null }>('/catalog/app-info')
      .then(setSupport).catch(() => {});
  }, []);

  const phone = support?.support_phone;
  const telegram = support?.support_telegram?.replace(/^@/, '');

  return (
    <ScrollView style={shared.screen}>
      <Card>
        <Text style={type.h3}>Bron eslatmalari</Text>
        <Text style={[type.small, { marginTop: 4 }]}>
          Bron vaqti yaqinlashganda ilova budilnik kabi eslatadi.
        </Text>
        {!fullScreen && (
          <View style={{ marginTop: 12 }}>
            <Button title="To'liq ekranli eslatmaga ruxsat berish" kind="soft" compact
              onPress={() => ChronixAlarmModule?.openFullScreenSettings()} />
          </View>
        )}
      </Card>
      <Card>
        <Text style={type.h3}>Qo'llab-quvvatlash</Text>
        <Text style={[type.small, { marginTop: 4 }]}>
          Bron bo'yicha savol bo'lsa, salon sahifasidagi telefon orqali bog'laning. Ilova bo'yicha muammo bo'lsa — bizga yozing.
        </Text>
        {(phone || telegram) && (
          <View style={[shared.gap, { marginTop: 12 }]}>
            {phone && <Button title={`Qo'ng'iroq: ${phone}`} kind="soft" compact icon="call-outline"
              onPress={() => { Linking.openURL(`tel:${phone.replace(/[^+\d]/g, '')}`).catch(() => {}); }} />}
            {telegram && <Button title={`Telegram: @${telegram}`} kind="soft" compact icon="paper-plane-outline"
              onPress={() => { Linking.openURL(`https://t.me/${encodeURIComponent(telegram)}`).catch(() => {}); }} />}
          </View>
        )}
      </Card>
      {me && (
        <Card>
          <Text style={type.h3}>Xavfsizlik</Text>
          {me.workspace === 'business' ? (
            <Text style={[type.small, { marginTop: 4 }]}>
              Siz salon xodimisiz: parolingizni faqat rahbaringiz beradi va o'zgartiradi.
            </Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              <Button title="Parolni almashtirish" kind="soft" compact icon="lock-closed-outline"
                onPress={() => router.push('/change-password')} />
            </View>
          )}
        </Card>
      )}
      <Card>
        <Text style={type.h3}>Ilova haqida</Text>
        <Text style={[type.small, { marginTop: 4, color: colors.muted }]}>
          Versiya {Constants.expoConfig?.version ?? '1.0.0'}
          {Updates.updateId ? ` · ${Updates.updateId.slice(0, 8)}` : ''}
        </Text>
      </Card>
    </ScrollView>
  );
}
