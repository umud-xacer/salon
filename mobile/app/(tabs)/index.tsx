import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { api, ApiError, BusinessCard } from '../../src/api';
import { Card, colors, Empty, ErrorText, Field, money, shared } from '../../src/ui';

const TASHKENT = { latitude: 41.3111, longitude: 69.2797 };

export default function Businesses() {
  const router = useRouter();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState(TASHKENT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const { coords: c } = await Location.getCurrentPositionAsync({});
        setCoords({ latitude: c.latitude, longitude: c.longitude });
      }
    })().catch(() => {});                       // joylashuv yo'q bo'lsa Toshkent markazidan qidiriladi
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: String(coords.latitude),
        lng: String(coords.longitude),
        radius_m: '50000',
      });
      if (query.trim()) params.set('q', query.trim());
      const r = await api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${params}`);
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  }, [coords, query]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <View style={shared.screen}>
      <Field label="Qidirish" value={query} onChangeText={setQuery} placeholder="Salon yoki klinika nomi" />
      <ErrorText text={error} />
      <FlatList
        data={items}
        keyExtractor={(b) => String(b.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="Yaqin atrofda hech narsa topilmadi" />}
        renderItem={({ item: b }) => (
          <Card onPress={() => router.push({ pathname: '/business/[slug]', params: { slug: b.slug } })}>
            <View style={shared.row}>
              <Text style={shared.name}>{b.name}</Text>
              <Text style={{ color: b.is_open_now ? colors.primary : colors.muted }}>
                {b.is_open_now ? 'Ochiq' : 'Yopiq'}
              </Text>
            </View>
            <Text style={shared.muted}>
              {b.category_name}
              {b.distance_m !== null ? ` · ${(b.distance_m / 1000).toFixed(1)} km` : ''}
              {b.rating_count > 0 ? ` · ★ ${b.rating_avg.toFixed(1)}` : ''}
            </Text>
            {b.address && <Text style={shared.muted}>{b.address}</Text>}
            {b.min_price !== null && <Text style={shared.muted}>{money(b.min_price)} dan</Text>}
          </Card>
        )}
      />
    </View>
  );
}
