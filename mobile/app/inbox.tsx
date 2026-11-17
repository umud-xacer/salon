import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';

import { api, Notification } from '../src/api';
import { Chip, dateTimeOf, EmptyState, Icon, IconName, makeStyles, Pressy, useShared, useTheme, useType } from '../src/ui';

import { notificationText, t } from "../src/i18n";
type Group = 'all' | 'booking' | 'promo' | 'system';

const GROUPS: { id: Group; label: string }[] = [
  { id: 'all', label: t("Hammasi") },
  { id: 'booking', label: t("Bron eslatmalari") },
  { id: 'promo', label: t("Aksiyalar") },
  { id: 'system', label: t("Tizim xabarlari") },
];

const groupOf = (type: string): Group => {
  if (type.startsWith('booking') || type.startsWith('appointment') || type.startsWith('attendance')
      || type === 'review_request') return 'booking';
  if (type.startsWith('promo')) return 'promo';
  return 'system';
};

const ICONS: Record<Exclude<Group, 'all'>, IconName> = {
  booking: 'calendar-outline',
  promo: 'pricetag-outline',
  system: 'information-circle-outline',
};

export default function Inbox() {
  const router = useRouter();
  const { c } = useTheme();
  const styles = useStyles();
  const shared = useShared();
  const type = useType();
  const [items, setItems] = useState<Notification[]>([]);
  const [group, setGroup] = useState<Group>('all');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api<Notification[]>('/notifications'));
    } catch {
      // Ro'yxat bo'sh qoladi, foydalanuvchi pastga tortib qayta urinadi
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const read = async (n: Notification) => {
    if (n.type === 'review_request' && n.data?.appointment_id) {
      router.push({ pathname: '/review', params: { appointmentId: String(n.data.appointment_id) } });
    }
    // Avtomatik xabarlar (tug'ilgan kun, qaytarish) va kutish ro'yxati taklifi — salon sahifasi
    if ((n.type === 'promo_birthday' || n.type === 'promo_winback') && typeof n.data?.slug === 'string') {
      router.push({ pathname: '/business/[slug]', params: { slug: n.data.slug } });
    }
    if (n.read_at) return;
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
  };

  const shown = items.filter((n) => group === 'all' || groupOf(n.type) === group);

  return (
    <View style={shared.screen}>
      <View style={{ marginBottom: 6 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {GROUPS.map((g) => <Chip key={g.id} label={g.label} active={group === g.id} onPress={() => setGroup(g.id)} />)}
        </ScrollView>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(n) => String(n.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : (
          <EmptyState icon="notifications-off-outline" title={t("Xabarlar yo'q")} text={t("Yangi xabarlar shu yerda ko'rinadi")} />
        )}
        renderItem={({ item: n }) => {
          const kind = groupOf(n.type) as Exclude<Group, 'all'>;
          return (
            <Pressy onPress={() => read(n)} style={[styles.item, !n.read_at && styles.itemNew]}>
              <View style={[styles.icon, !n.read_at && styles.iconNew]}>
                <Icon name={ICONS[kind]} size={20} color={n.read_at ? c.muted : c.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={shared.row}>
                  <Text style={[type.h3, { flex: 1, paddingRight: 8, fontSize: 15 }, !!n.read_at && { fontWeight: '500' }]} numberOfLines={1}>
                    {notificationText(n.title, n.body).title}
                  </Text>
                  {!n.read_at && <View style={styles.dot} accessibilityLabel={t("O'qilmagan")} />}
                </View>
                {n.body && <Text style={[type.small, { marginTop: 2 }]}>{notificationText(n.title, n.body).body}</Text>}
                <Text style={[type.small, { marginTop: 4, fontSize: 12 }]}>{dateTimeOf(n.created_at)}</Text>
              </View>
            </Pressy>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  item: {
    flexDirection: 'row', gap: 12, backgroundColor: c.surface, borderRadius: 20, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: c.line,
  },
  itemNew: { borderColor: c.accentSoft },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  iconNew: { backgroundColor: c.accentSoft },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.accent },
}));
