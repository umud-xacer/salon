import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, Icon, IconName } from '../../src/ui';

import { t } from "../../src/i18n";
function TabIcon({ name, focused, color }: { name: IconName; focused: boolean; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1.16 : 1, useNativeDriver: true, friction: 4 }).start();
  }, [focused, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon name={name} size={24} color={color} />
    </Animated.View>
  );
}

const icon = (on: IconName, off: IconName) => ({
  tabBarIcon: ({ focused, color }: { focused: boolean; color: ColorValue }) => (
    <TabIcon name={focused ? on : off} focused={focused} color={String(color)} />
  ),
});

export default function TabsLayout() {
  const { bottom } = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { borderTopColor: colors.line, backgroundColor: colors.card, height: 62 + bottom, paddingTop: 6, paddingBottom: bottom + 6 },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700', color: colors.text },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("Salonlar"), headerShown: false, ...icon('storefront', 'storefront-outline') }} />
      <Tabs.Screen name="bookings" options={{ title: t("Bronlarim"), ...icon('calendar', 'calendar-outline') }} />
      <Tabs.Screen name="inbox" options={{ title: t("Xabarlar"), ...icon('notifications', 'notifications-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t("Profil"), ...icon('person', 'person-outline') }} />
    </Tabs>
  );
}
