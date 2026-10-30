import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { api, Notification } from '../../src/api';
import { Card, colors, dateTimeOf, Empty, shared } from '../../src/ui';

export default function Inbox() {
  const [items, setItems] = useState<Notification[]>([]);
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
    if (n.read_at) return;
    await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    load();
  };

  return (
    <View style={shared.screen}>
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="Xabarlar yo'q" />}
        renderItem={({ item: n }) => (
          <Card onPress={() => read(n)}>
            <View style={shared.row}>
              <Text style={[shared.name, { color: n.read_at ? colors.muted : colors.text }]}>{n.title}</Text>
              <Text style={shared.muted}>{dateTimeOf(n.created_at)}</Text>
            </View>
            {n.body && <Text style={shared.muted}>{n.body}</Text>}
          </Card>
        )}
      />
    </View>
  );
}
