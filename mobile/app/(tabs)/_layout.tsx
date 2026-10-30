import { Tabs } from 'expo-router';

import { colors } from '../../src/ui';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen name="index" options={{ title: 'Salonlar' }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bronlarim' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Xabarlar' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
