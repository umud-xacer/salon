import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ChronixAlarmModule } from '../modules/chronix-alarm';
import { Button, Card, colors, shared, type } from '../src/ui';

export default function Settings() {
  const [fullScreen, setFullScreen] = useState(true);

  useEffect(() => {
    ChronixAlarmModule?.canUseFullScreen().then(setFullScreen).catch(() => {});
  }, []);

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
          Bron bo'yicha savol bo'lsa, salon sahifasidagi telefon orqali bog'laning.
        </Text>
      </Card>
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
