// Pastki suzuvchi shisha menyu (prototip): Asosiy, Xarita, Bronlar, Profil
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { Glass, Icon, IconName, shadowOf, useTheme } from '../../src/ui';

const TABS: Record<string, { label: string; on: IconName; off: IconName }> = {
  index: { label: t("Asosiy"), on: 'home', off: 'home-outline' },
  map: { label: t("Xarita"), on: 'map', off: 'map-outline' },
  bookings: { label: t("Bronlar"), on: 'calendar', off: 'calendar-outline' },
  profile: { label: t("Profil"), on: 'person', off: 'person-outline' },
};

function TabItem({ name, focused, onPress }: { name: string; focused: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1.12 : 1, useNativeDriver: true, friction: 5 }).start();
  }, [focused, scale]);
  const tab = TABS[name];
  if (!tab) return null;
  const color = focused ? c.accent : c.muted;
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}
      accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={tab.label}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={focused ? tab.on : tab.off} size={23} color={color} />
      </Animated.View>
      <Text style={{ fontSize: 11, fontWeight: '700', color }}>{tab.label}</Text>
    </Pressable>
  );
}

function FloatingBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(bottom, 12) + 8 }}>
      <Glass intensity={50} style={[{ height: 68, borderRadius: 24, flexDirection: 'row' }, shadowOf(c, 2)]}>
        {state.routes.map((route, i) => (
          <TabItem key={route.key} name={route.name} focused={state.index === i} onPress={() => navigateToTab(route.key)} />
        ))}
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs tabBar={(props) => <FloatingBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.bg },
        animation: 'shift',
      }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
