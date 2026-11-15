// Qidiruv (Figma 08): tepada xarita (reyting yorliqlari), qidiruv paneli; pastda suriladigan oyna —
// yo'nalishlar, "Yaqin atrofda N ta salon" va katta kartalar. Xarita surilsa ro'yxat o'sha hududga moslanadi.
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, ScrollViewInstance, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard, Category } from '../../src/api';
import { pick, t } from '../../src/i18n';
import { locate, useMyLocation } from '../../src/location';
import { Bounds, OsmMap } from '../../src/OsmMap';
import { SalonCardBig } from '../../src/SalonCard';
import { EmptyState, Icon, makeStyles, Pressy, useTheme } from '../../src/ui';

const MAX_BOUNDS_DEG = 1;          // backend chegarasi: bundan keng oynada so'rov rad etiladi

export default function SearchTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { c } = useTheme();
  const s = useStyles();
  const { coords, me } = useMyLocation();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [yandexKey, setYandexKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const list = useRef<ScrollViewInstance>(null);

  // Oyna ikki holatda: pastda (xarita ko'rinadi) va tepada (ro'yxat to'liq)
  const low = Math.round(height * 0.36);
  const high = insets.top + 128;
  const top = useRef(new Animated.Value(low)).current;
  const at = useRef(low);
  const snap = (to: number) => {
    at.current = to;
    Animated.spring(top, { toValue: to, useNativeDriver: false, damping: 22, stiffness: 200 }).start();
  };
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_, g) => top.setValue(Math.min(low, Math.max(high, at.current + g.dy))),
    onPanResponderRelease: (_, g) => snap(at.current + g.dy < (low + high) / 2 || g.vy < -0.5 ? high : low),
  })).current;

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

  const shown = useMemo(() => {
    const cat = categories.find((x) => x.slug === category);
    const list = cat ? items.filter((b) => b.category === cat.slug || b.category_name === cat.name_uz) : items;
    return [...list].sort((a, z) => Number(z.is_open_now) - Number(a.is_open_now) || z.rating_avg - a.rating_avg);
  }, [items, category, categories]);

  const select = (id: number) => {
    const i = shown.findIndex((b) => b.id === id);
    if (i < 0) return;
    snap(low);
    list.current?.scrollTo({ y: i * 330, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ height: low + 40 }}>
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
          onSelect={select}
          onError={() => {
            if (yandexKey) setYandexKey(null);
            else setHint(t("Xaritani yuklab bo'lmadi. Internetni tekshiring"));
          }}
        />
      </View>

      <View style={[s.searchWrap, { top: insets.top + 8 }]}>
        <Pressy onPress={() => router.push(category ? { pathname: '/search', params: { category } } : '/search')} style={s.search}
          accessibilityRole="search" scaleTo={0.99}>
          <Icon name="search-outline" size={22} color={c.text} />
          <View style={{ flex: 1 }}>
            <Text style={s.searchTitle} numberOfLines={1}>
              {category ? pick(categories.find((x) => x.slug === category)?.name_uz ?? '', categories.find((x) => x.slug === category)?.name_ru) : t("Barcha xizmatlar")}
            </Text>
            <Text style={s.searchSub}>{t("Xarita hududi")}</Text>
          </View>
          <View style={s.searchIcon}><Icon name="options-outline" size={20} color={c.text} /></View>
        </Pressy>
      </View>

      <Animated.View style={[s.sheet, { top }]}>
        <View {...drag.panHandlers} style={s.handleZone}>
          <Pressable onPress={() => snap(at.current === low ? high : low)} hitSlop={10} accessibilityRole="button"
            accessibilityLabel={t("Ro'yxatni ochish")}>
            <View style={s.handle} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, gap: 8, alignItems: 'center' }} style={{ flexGrow: 0, flexShrink: 0, height: 44 }}>
          {[{ slug: null as string | null, label: t("Hammasi") }, ...categories.map((x) => ({ slug: x.slug as string | null, label: pick(x.name_uz, x.name_ru) }))]
            .map((x) => {
              const on = category === x.slug;
              return (
                <Pressy key={x.slug ?? 'all'} onPress={() => setCategory(x.slug)} scaleTo={0.95} style={[s.chip, on && s.chipOn]}
                  accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[s.chipText, on && { color: c.ctaText }]}>{x.label}</Text>
                </Pressy>
              );
            })}
        </ScrollView>
        <Text style={s.count}>{hint ?? t("Yaqin atrofda {a} ta muassasa", { a: shown.length })}</Text>
        <ScrollView ref={list} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 26 }}
          showsVerticalScrollIndicator={false}>
          {shown.length === 0 && !hint ? (
            <EmptyState icon="search-outline" title={t("Hech narsa topilmadi")}
              text={t("Xaritani suring yoki boshqa yo'nalishni tanlang")} />
          ) : shown.map((b) => (
            <SalonCardBig key={b.id} item={b} onOpen={() => router.push({ pathname: '/business/[slug]', params: { slug: b.slug } })}
              badge={b.rating_count > 0 && b.rating_avg >= 4.8 ? t("Eng yaxshi") : null} />
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  searchWrap: { position: 'absolute', left: 24, right: 24 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 64, paddingLeft: 18, paddingRight: 8, borderRadius: 999,
    backgroundColor: c.bg, shadowColor: c.shadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  searchTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  searchSub: { fontSize: 13, color: c.muted },
  searchIcon: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    shadowColor: c.shadow, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 10,
  },
  handleZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 14 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.line },
  chip: { height: 40, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: c.line, justifyContent: 'center' },
  chipOn: { backgroundColor: c.cta, borderColor: c.cta },
  chipText: { fontSize: 14, fontWeight: '600', color: c.text },
  count: { textAlign: 'center', fontSize: 13, color: c.muted, marginVertical: 14 },
}));
