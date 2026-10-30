import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuth } from '../../src/auth';
import { Button, Card, shared } from '../../src/ui';

export default function Profile() {
  const { me, signOut } = useAuth();
  const router = useRouter();

  return (
    <View style={shared.screen}>
      <Card>
        <Text style={shared.name}>{me?.user.full_name || 'Foydalanuvchi'}</Text>
        <Text style={shared.muted}>{me?.user.phone}</Text>
      </Card>
      <View style={shared.gap}>
        <Button
          title="Budilnikni sinash"
          kind="outline"
          onPress={() => router.push({ pathname: '/alarm', params: { type: 'test', appointmentId: '0', notificationId: '0' } })}
        />
        <Button title="Chiqish" kind="danger" onPress={signOut} />
      </View>
    </View>
  );
}
