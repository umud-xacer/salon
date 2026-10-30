import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { api, ApiError, BusinessCard } from '../../src/api';
import { Button, Card, Chip, colors, Empty, ErrorText, Field, money, shared } from '../../src/ui';
import { Bounds, hasMapKey, YandexMap } from '../../src/YandexMap';

const TASHKENT = { latitude: 41.3111, longitude: 69.2797 };
const MAX_BOUNDS_DEG = 1;          // backend chegarasi: bundan keng oynada so'rov rad etiladi

export default function Businesses() {
  const router = useRouter();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState(TASHKENT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState(false);
  const [mapItems, setMapItems] = useState<BusinessCard[]>([]);
  const [selected, setSelected] = useState<BusinessCard | null>(null);
  const [mapHint, setMapHint] = useState<string | null>(null);
  const boundsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // Xarita surilganda: oxirgi to'xtagan joy uchun bitta so'rov
  const onBounds = useCallback(({ sw, ne }: Bounds) => {
    clearTimeout(boundsTimer.current);
    boundsTimer.current = setTimeout(async () => {
      if (ne[0] - sw[0] > MAX_BOUNDS_DEG || ne[1] - sw[1] > MAX_BOUNDS_DEG) {
        setMapHint('Salonlarni ko\'rish uchun xaritani yaqinlashtiring');
        return;
      }
      setMapHint(null);
      try {
        const params = new URLSearchParams({
          sw_lat: String(sw[0]), sw_lng: String(sw[1]), ne_lat: String(ne[0]), ne_lng: String(ne[1]),
        });
        setMapItems(await api<BusinessCard[]>(`/catalog/businesses/in-bounds?${params}`));
      } catch (e) {
        setMapHint(e instanceof ApiError ? e.message : 'Yuklab bo\'lmadi');
      }
    }, 400);
  }, []);

  const openBusiness = (slug: string) => router.push({ pathname: '/business/[slug]', params: { slug } });

  const modes = (
    <View style={{ flexDirection: 'row' }}>
      <Chip label="Ro'yxat" active={!mapMode} onPress={() => setMapMode(false)} />
      <Chip label="Xarita" active={mapMode} onPress={() => setMapMode(true)} />
    </View>
  );

  if (mapMode) {
    return (
      <View style={shared.screen}>
        {modes}
        {!hasMapKey ? (
          <Empty text="Xarita kaliti sozlanmagan (EXPO_PUBLIC_YANDEX_MAPS_KEY)" />
        ) : (
          <View style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
            <YandexMap
              center={coords}
              businesses={mapItems}
              onBounds={onBounds}
              onSelect={(id) => setSelected(mapItems.find((b) => b.id === id) ?? null)}
              onError={() => setMapHint('Xaritani yuklab bo\'lmadi')}
            />
          </View>
        )}
        <ErrorText text={mapHint} />
        {selected && (
          <View style={{ marginTop: 10 }}>
            <Card>
              <Text style={shared.name}>{selected.name}</Text>
              <Text style={[shared.muted, { marginBottom: 10 }]}>
                {selected.category_name} · {selected.is_open_now ? 'Ochiq' : 'Yopiq'}
              </Text>
              <Button title="Ochish" onPress={() => openBusiness(selected.slug)} />
            </Card>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={shared.screen}>
      {modes}
      <Field label="Qidirish" value={query} onChangeText={setQuery} placeholder="Salon yoki klinika nomi" />
      <ErrorText text={error} />
      <FlatList
        data={items}
        keyExtractor={(b) => String(b.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Empty text="Yaqin atrofda hech narsa topilmadi" />}
        renderItem={({ item: b }) => (
          <Card onPress={() => openBusiness(b.slug)}>
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
