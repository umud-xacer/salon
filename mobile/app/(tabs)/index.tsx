import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions, FlatList, Image, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard, Category, Notification } from '../../src/api';
import { useFavorites } from '../../src/favorites';
import { distanceText, SalonCard } from '../../src/SalonCard';
import {
  BottomSheet, Button, Card, Chip, colors, Empty, EmptyState, ErrorText, Icon, IconName, money, radius, shadow, shared, type,
} from '../../src/ui';
import { Bounds, OsmMap } from '../../src/OsmMap';

const TASHKENT = { latitude: 41.3111, longitude: 69.2797 };
const MAX_BOUNDS_DEG = 1;          // backend chegarasi: bundan keng oynada so'rov rad etiladi
// Keyingi banner chetdan ko'rinib tursin: ro'yxat davom etishi seziladi
const BANNER_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

const CATEGORY_ICONS: [RegExp, IconName][] = [
  [/barber/i, 'cut-outline'],
  [/pharm|dorixona|apteka/i, 'medical-outline'],
  [/clinic|klinika|stomat|dent/i, 'medkit-outline'],
  [/spa|massaj|massage/i, 'leaf-outline'],
  [/kosmet|cosmet/i, 'sparkles-outline'],
  [/nail|tirnoq|manik/i, 'hand-left-outline'],
  [/fitness|sport/i, 'barbell-outline'],
  [/salon|beauty|go'zal/i, 'color-wand-outline'],
];
const categoryIcon = (c: Category): IconName =>
  CATEGORY_ICONS.find(([re]) => re.test(c.slug) || re.test(c.name_uz))?.[1] ?? 'grid-outline';

type Sort = 'distance' | 'rating' | 'price';
type Filters = { sort: Sort; openNow: boolean; maxPrice: number | null };
const DEFAULT_FILTERS: Filters = { sort: 'distance', openNow: false, maxPrice: null };
const SORTS: { id: Sort; label: string; icon: IconName }[] = [
  { id: 'distance', label: 'Yaqin', icon: 'navigate-outline' },
  { id: 'rating', label: 'Reyting', icon: 'star-outline' },
  { id: 'price', label: 'Arzon', icon: 'pricetag-outline' },
];
const PRICES = [50_000, 100_000, 200_000, 500_000];

export default function Businesses() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const favorites = useFavorites();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [top, setTop] = useState<BusinessCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState(TASHKENT);
  const [myPoint, setMyPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [place, setPlace] = useState('Toshkent');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [draft, setDraft] = useState(DEFAULT_FILTERS);
  const [sheet, setSheet] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState(false);
  const [mapItems, setMapItems] = useState<BusinessCard[]>([]);
  const [selected, setSelected] = useState<BusinessCard | null>(null);
  const [mapHint, setMapHint] = useState<string | null>(null);
  // Yandex kaliti serverdan (almashtirish uchun yangi APK kerak emas). Yuklanmasa — OpenStreetMap
  const [yandexKey, setYandexKey] = useState<string | null>(null);
  const boundsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api<Category[]>('/catalog/categories').then(setCategories).catch(() => {});
    api<{ yandex_maps_key: string | null }>('/catalog/app-info')
      .then((r) => setYandexKey(r.yandex_maps_key)).catch(() => {});
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const { coords: c } = await Location.getCurrentPositionAsync({});
      setCoords({ latitude: c.latitude, longitude: c.longitude });
      setMyPoint({ latitude: c.latitude, longitude: c.longitude });
      const found = await api<{ address: string; district: string | null; region: string | null }>(
        `/geo/address?lat=${c.latitude}&lng=${c.longitude}`).catch(() => null);
      setPlace(found?.district ?? found?.region ?? 'Joylashuvingiz');
    })().catch(() => {});                       // joylashuv yo'q bo'lsa Toshkent markazidan qidiriladi
  }, []);

  // Xaritadagi "Mening joyim" tugmasi: har bosilganda joylashuv yangidan olinadi
  const locate = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setMapHint("Joylashuvga ruxsat berilmagan. Telefon sozlamalaridan yoqing");
      return null;
    }
    const { coords: c } = await Location.getCurrentPositionAsync({});
    const p = { latitude: c.latitude, longitude: c.longitude };
    setMyPoint(p);
    setMapHint(null);
    return p;
  };

  useFocusEffect(useCallback(() => {
    api<Notification[]>('/notifications?unread=true&limit=50')
      .then((list) => setUnread(list.length)).catch(() => {});
  }, []));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '50000', sort: filters.sort,
      });
      if (query.trim().length >= 2) params.set('q', query.trim());
      if (category) params.set('category', category);
      if (filters.openNow) params.set('open_now', 'true');
      if (filters.maxPrice) params.set('max_price', String(filters.maxPrice));
      const r = await api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${params}`);
      setItems(r.items);
      const best = new URLSearchParams({
        lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '50000', sort: 'rating', limit: '5',
      });
      const b = await api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${best}`);
      setTop(b.items.filter((x) => x.rating_count > 0));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  }, [coords, query, category, filters]);

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
  const activeFilters = (filters.sort !== 'distance' ? 1 : 0) + (filters.openNow ? 1 : 0) + (filters.maxPrice ? 1 : 0);

  const header = (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, backgroundColor: colors.background }}>
      <View style={shared.row}>
        <View style={{ flex: 1 }}>
          <Text style={type.small}>Sizning joylashuvingiz</Text>
          <View style={styles.place}>
            <Icon name="location" size={16} color={colors.primary} />
            <Text style={type.h3} numberOfLines={1}>{place}</Text>
          </View>
        </View>
        <Pressable onPress={() => setMapMode(!mapMode)} style={styles.round}
          accessibilityLabel={mapMode ? 'Ro\'yxat' : 'Xarita'}>
          <Icon name={mapMode ? 'list-outline' : 'map-outline'} size={21} />
        </Pressable>
        <Pressable onPress={() => router.push('/inbox')} style={[styles.round, { marginLeft: 8 }]} accessibilityLabel="Bildirishnomalar">
          <Icon name="notifications-outline" size={21} />
          {unread > 0 && (
            <View style={styles.unread}><Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text></View>
          )}
        </Pressable>
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Icon name="search-outline" size={19} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Salon yoki xizmat"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            maxLength={60}
          />
        </View>
        <Pressable onPress={() => { setDraft(filters); setSheet(true); }} style={styles.filter} accessibilityLabel="Filtrlar">
          <Icon name="options-outline" size={21} color="#fff" />
          {activeFilters > 0 && (
            <View style={styles.unread}><Text style={styles.unreadText}>{activeFilters}</Text></View>
          )}
        </Pressable>
      </View>
    </View>
  );

  const sheetView = (
    <BottomSheet visible={sheet} title="Filtrlar" onClose={() => setSheet(false)}>
      <Text style={styles.sheetLabel}>Saralash</Text>
      <View style={styles.wrap}>
        {SORTS.map((s) => (
          <Chip key={s.id} label={s.label} icon={s.icon} active={draft.sort === s.id}
            onPress={() => setDraft({ ...draft, sort: s.id })} />
        ))}
      </View>
      <Text style={styles.sheetLabel}>Ish vaqti</Text>
      <View style={styles.wrap}>
        <Chip label="Hozir ochiq" icon="time-outline" active={draft.openNow}
          onPress={() => setDraft({ ...draft, openNow: !draft.openNow })} />
      </View>
      <Text style={styles.sheetLabel}>Xizmat narxi</Text>
      <View style={styles.wrap}>
        {PRICES.map((p) => (
          <Chip key={p} label={`${money(p)}gacha`} active={draft.maxPrice === p}
            onPress={() => setDraft({ ...draft, maxPrice: draft.maxPrice === p ? null : p })} />
        ))}
      </View>
      <View style={[shared.gap, { marginTop: 10 }]}>
        <Button title="Qo'llash" onPress={() => { setFilters(draft); setSheet(false); }} />
        <Button title="Tozalash" kind="outline" onPress={() => { setFilters(DEFAULT_FILTERS); setSheet(false); }} />
      </View>
    </BottomSheet>
  );

  if (mapMode) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar barStyle="dark-content" />
        {header}
        <View style={{ flex: 1, padding: 16, paddingTop: 0 }}>
          <View style={{ flex: 1, borderRadius: radius.lg, overflow: 'hidden' }}>
            <OsmMap
              key={yandexKey ? 'yandex' : 'osm'}
              yandexKey={yandexKey}
              center={coords}
              me={myPoint}
              onLocate={locate}
              businesses={mapItems}
              onBounds={onBounds}
              onSelect={(id) => setSelected(mapItems.find((b) => b.id === id) ?? null)}
              onError={() => {
                // Yandex ishlamasa (kalit, limit, tarmoq) — jimgina OpenStreetMap ga o'tamiz
                if (yandexKey) setYandexKey(null);
                else setMapHint("Xaritani yuklab bo'lmadi. Internetni tekshiring");
              }}
            />
          </View>
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
        {sheetView}
      </View>
    );
  }

  const listHeader = (
    <View>
      {top.length > 0 && !query && (
        <>
          <Text style={[type.h2, styles.section]}>Top salonlar</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={BANNER_WIDTH + 10} decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
            {top.map((b) => (
              <Pressable key={b.id} onPress={() => openBusiness(b.slug)} style={styles.banner}>
                {b.photos?.[0] && <Image source={{ uri: b.photos[0] }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
                <View style={styles.bannerShade} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="star" size={15} color={colors.star} />
                  <Text style={styles.bannerSmall}>{b.rating_avg.toFixed(1)} ({b.rating_count})</Text>
                </View>
                <Text style={styles.bannerTitle} numberOfLines={1}>{b.name}</Text>
                <Text style={styles.bannerSmall} numberOfLines={1}>
                  {[b.category_name, distanceText(b.distance_m)].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 }}>
          <Chip label="Hammasi" icon="apps-outline" active={category === null} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip key={c.id} label={c.name_uz} icon={categoryIcon(c)} active={category === c.slug}
              onPress={() => setCategory(category === c.slug ? null : c.slug)} />
          ))}
        </ScrollView>
      )}
      <View style={{ paddingHorizontal: 16, marginTop: 6 }}><ErrorText text={error} /></View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" />
      {header}
      <FlatList
        data={items}
        keyExtractor={(b) => String(b.id)}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : (
          activeFilters > 0 || category || query
            ? <Empty text="Bu shartlarga mos salon topilmadi" />
            : <EmptyState icon="storefront-outline" title="Yaqin atrofda salon yo'q" text="Hududingizdagi salonlar tez orada qo'shiladi" />
        )}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16 }}>
            <SalonCard item={item} favorite={favorites.has(item.id)} onToggleFavorite={() => favorites.toggle(item.id)}
              onOpen={() => openBusiness(item.slug)} />
          </View>
        )}
      />
      {sheetView}
    </View>
  );
}

const styles = StyleSheet.create({
  place: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  round: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  unread: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 10 },
  search: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.md,
    paddingHorizontal: 12, ...shadow,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15, color: colors.text },
  filter: {
    width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  section: { paddingHorizontal: 16, marginTop: 4, marginBottom: 8, fontSize: 17 },
  banner: {
    width: BANNER_WIDTH, height: 104, borderRadius: radius.md, padding: 12, justifyContent: 'flex-end', overflow: 'hidden',
    backgroundColor: colors.navy,
  },
  bannerShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(1,13,73,0.45)' },
  bannerTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2 },
  bannerSmall: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  sheetLabel: { fontWeight: '700', color: colors.text, marginBottom: 8, marginTop: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
