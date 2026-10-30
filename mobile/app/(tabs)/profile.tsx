import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ChronixAlarmModule } from '../../modules/chronix-alarm';

import { useAuth } from '../../src/auth';
import { Button, Card, shared } from '../../src/ui';

export default function Profile() {
  const { me, signOut } = useAuth();
  const router = useRouter();
  const [fullScreen, setFullScreen] = useState(true);

  useEffect(() => {
    ChronixAlarmModule?.canUseFullScreen().then(setFullScreen).catch(() => {});
  }, []);

  return (
    <View style={shared.screen}>
      <Card>
        <Text style={shared.name}>{me?.user.full_name || 'Foydalanuvchi'}</Text>
        <Text style={shared.muted}>{me?.user.phone}</Text>
      </Card>
      <View style={shared.gap}>
        {!fullScreen && (
          <Button title="To'liq ekranli budilnikka ruxsat bering" onPress={() => ChronixAlarmModule?.openFullScreenSettings()} />
        )}
        <Button
          title="Budilnikni sinash"
          kind="outline"
          onPress={() => router.push({ pathname: '/alarm', params: { type: 'test', appointmentId: '0', notificationId: '0' } })}
        />
        <Button title="Chiqish" kind="danger" onPress={signOut} />
      </View>
      <Text style={[shared.muted, { textAlign: 'center', marginTop: 24 }]}>Chronix · Vaqtingiz – bizning ustuvorligimiz</Text>
    </View>
  );
}
