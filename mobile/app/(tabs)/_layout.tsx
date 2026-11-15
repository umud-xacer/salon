// Pastki menyu (Figma "Bottom nav"): Bosh sahifa, Qidiruv (xarita + ro'yxat), Bronlar, Profil
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { font, Icon, IconName, useTheme } from '../../src/ui';

const TABS: Record<string, { label: string; on: IconName; off: IconName }> = {
  index: { label: t("Bosh sahifa"), on: 'home', off: 'home-outline' },
  map: { label: t("Qidiruv"), on: 'search', off: 'search-outline' },
  bookings: { label: t("Bronlar"), on: 'calendar', off: 'calendar-outline' },
  profile: { label: t("Profil"), on: 'person', off: 'person-outline' },
};

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line,
      paddingTop: 10, paddingBottom: Math.max(bottom, 10) + 4 }}>
      {state.routes.map((route, i) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const on = state.index === i;
        const color = on ? c.accent : c.muted;
        return (
          <Pressable key={route.key} onPress={() => navigateToTab(route.key)} accessibilityRole="tab"
            accessibilityState={{ selected: on }} accessibilityLabel={tab.label}
            style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <Icon name={on ? tab.on : tab.off} size={24} color={color} />
            <Text style={{ fontSize: 12, color, letterSpacing: -0.3, ...font(on ? '600' : '500') }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'shift' }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
