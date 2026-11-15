// Xarita (prototip "7"): butun ekran xarita, ustida shisha qidiruv va yo'nalish chiplari, pastda tanlangan muassasa.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard, Category } from '../../src/api';
import { pick, t } from '../../src/i18n';
import { locate, useMyLocation } from '../../src/location';
import { Bounds, OsmMap } from '../../src/OsmMap';
import { distanceText } from '../../src/SalonCard';
import { Badge, FadeIn, Glass, Gradient, Icon, IconButton, makeStyles, money, Pressy, useTheme } from '../../src/ui';

const MAX_BOUNDS_DEG = 1;          // backend chegarasi: bundan keng oynada so'rov rad etiladi

export default function MapTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, dark, setMode } = useTheme();
  const s = useStyles();
  const { coords, me } = useMyLocation();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<BusinessCard | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // Yandex kaliti serverdan (almashtirish uchun yangi APK kerak emas). Yuklanmasa — OpenStreetMap
  const [yandexKey, setYandexKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api<Category[]>('/catalog/categories').then(setCategories).catch(() => {});
    api<{ yandex_maps_key: string | null }>('/catalog/app-info').then((r) => setYandexKey(r.yandex_maps_key)).catch(() => {});
  }, []);

  const onBounds = useCallback(({ sw, ne }: Bounds) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (ne[0] - sw[0] > MAX_BOUNDS_DEG || ne[1] - sw[1] > MAX_BOUNDS_DEG) {
        setHint(t("Muassasalarni ko'rish uchun xaritani yaqinlashtiring"));
        return;
      }
      setHint(null);
      try {
        const p = new URLSearchParams({ sw_lat: String(sw[0]), sw_lng: String(sw[1]), ne_lat: String(ne[0]), ne_lng: String(ne[1]) });
        setItems(await api<BusinessCard[]>(`/catalog/businesses/in-bounds?${p}`));
      } catch (e) {
        setHint(e instanceof ApiError ? e.message : t("Yuklab bo'lmadi"));
      }
    }, 400);
  }, []);

  // Yo'nalish tanlansa — xaritada faqat o'sha turdagi muassasalar
  const catName = categories.find((x) => x.slug === category)?.name_uz;
  const shown = useMemo(() => (catName ? items.filter((b) => b.category_name === catName) : items), [items, catName]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <OsmMap
        key={yandexKey ? 'yandex' : 'osm'}
        yandexKey={yandexKey}
        center={coords}
        me={me}
        onLocate={async () => {
          const p = await locate().catch(() => null);
          if (!p) setHint(t("Joylashuvga ruxsat berilmagan. Telefon sozlamalaridan yoqing"));
          return p;
        }}
        businesses={shown}
        onBounds={onBounds}
        onSelect={(id) => setSelected(shown.find((b) => b.id === id) ?? null)}
        onError={() => {
          // Yandex ishlamasa (kalit, limit, tarmoq) — jimgina OpenStreetMap ga o'tamiz
          if (yandexKey) setYandexKey(null);
          else setHint(t("Xaritani yuklab bo'lmadi. Internetni tekshiring"));
        }}
      />

      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressy onPress={() => router.push('/search')} style={{ flex: 1 }} accessibilityRole="search">
            <Glass style={s.search} intensity={50}>
              <Icon name="search-outline" size={20} color={c.muted} />
              <Text style={s.searchText}>{t("Salon, xizmat yoki manzil")}</Text>
            </Glass>
          </Pressy>
          <IconButton icon={dark ? 'sunny-outline' : 'moon-outline'} size={50} label={t("Rejimni almashtirish")}
            onPress={() => setMode(dark ? 'light' : 'dark')} />
        </View>
        {categories.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginTop: 10 }}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {[{ slug: null as string | null, label: t("Hammasi") }, ...categories.map((x) => ({ slug: x.slug as string | null, label: pick(x.name_uz, x.name_ru) }))]
              .map((x) => {
                const on = category === x.slug;
                return (
                  <Pressy key={x.slug ?? 'all'} onPress={() => { setCategory(x.slug); setSelected(null); }} scaleTo={0.94}
                    accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Glass style={[s.chip, on && { backgroundColor: c.cta }]} intensity={40} tint={on ? c.cta : c.glass}>
                      <Text style={[s.chipText, on && { color: c.ctaText }]}>{x.label}</Text>
                    </Glass>
                  </Pressy>
                );
              })}
          </ScrollView>
        )}
        {hint && <Glass style={s.hint} intensity={40}><Text style={s.hintText}>{hint}</Text></Glass>}
      </View>

      {selected && (
        <FadeIn key={selected.id} style={[s.cardWrap, { bottom: Math.max(insets.bottom, 12) + 92 }]}>
          <Pressy onPress={() => router.push({ pathname: '/business/[slug]', params: { slug: selected.slug } })} style={s.card}
            accessibilityRole="button">
            {selected.photos?.[0]
              ? <Image source={{ uri: selected.photos[0] }} style={s.photo} resizeMode="cover" />
              : <Gradient colors={c.avatar} style={s.photo} />}
            <View style={{ flex: 1, minWidth: 0, gap: 4, justifyContent: 'center' }}>
              <Text style={s.kind} numberOfLines={1}>
                {[pick(selected.category_name, selected.category_name_ru), distanceText(selected.distance_m)].filter(Boolean).join(' · ')}
              </Text>
              <Text style={s.name} numberOfLines={1}>{selected.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {selected.rating_count > 0 && <Text style={{ color: c.star, fontWeight: '800', fontSize: 13 }}>★ {selected.rating_avg.toFixed(1)}</Text>}
                <Badge label={selected.is_open_now ? t("Ochiq") : t("Yopiq")} tone={selected.is_open_now ? 'success' : 'danger'} />
              </View>
              {selected.min_price !== null && <Text style={s.price}>{t("{a}dan", { a: money(selected.min_price) })}</Text>}
            </View>
            <Icon name="chevron-forward" size={18} color={c.muted} />
          </Pressy>
        </FadeIn>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  top: { position: 'absolute', left: 16, right: 16, top: 0 },
  search: { height: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchText: { color: c.muted, fontSize: 15 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '700', color: c.text },
  hint: { marginTop: 10, borderRadius: 14, padding: 10, alignSelf: 'flex-start' },
  hintText: { color: c.text, fontSize: 13, fontWeight: '600' },
  cardWrap: { position: 'absolute', left: 16, right: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.line, shadowColor: c.shadow, shadowOpacity: 0.18, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  photo: { width: 84, height: 84, borderRadius: 16 },
  kind: { fontSize: 12, fontWeight: '600', color: c.muted },
  name: { fontSize: 17, fontWeight: '800', color: c.text },
  price: { fontSize: 13, fontWeight: '700', color: c.accent },
}));
