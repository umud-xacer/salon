// Qidiruv (Figma 08): butun ekran xarita (reyting yorliqlari), tepada qidiruv paneli; pastda suriladigan oyna —
// uch holat: yig'ilgan (faqat yo'nalishlar va soni — xarita deyarli to'liq ko'rinadi), o'rta, to'liq ro'yxat.
// Xarita surilsa ro'yxat o'sha hududga moslanadi. Pin bosilsa (Fresha uslubi): oyna pastga yashirinadi va pastdan
// salon kartochkasi chiqadi. "X" yoki xaritaning bo'sh joyi — yopiladi.
// Tezlik (2026-11-24): xarita bir marta yuklanadi (Yandex kaliti telefonda saqlanadi — avval OSM, keyin Yandex
// bo'lib ikki marta yuklanmaydi), xarita balandligi animatsiya qilinmaydi (oyna native transform bilan suriladi).
// Joylashuv: ruxsat bo'lsa ochilganda jimgina aniqlanadi va xarita shu joyga markazlanadi; ruxsat yo'q — Toshkent.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, LayoutChangeEvent, PanResponder, Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard } from '../../src/api';
import { useAuth } from '../../src/auth';
import { pick, t } from '../../src/i18n';
import { locate, locateIfAllowed, Point, useMyLocation } from '../../src/location';
import { getItem, setItemAsync } from '../../src/secure';
import { useCategories } from '../../src/useCategories';
import { MapPreview } from '../../src/MapPreview';
import { Bounds, OsmMap } from '../../src/OsmMap';
import { SalonCardBig } from '../../src/SalonCard';
import { EmptyState, Icon, makeStyles, Pressy, useTheme } from '../../src/ui';

const MAX_BOUNDS_DEG = 1;          // backend chegarasi: bundan keng oynada so'rov rad etiladi
const YANDEX_KEY = 'chronix_yandex_key';
const PEEK = 124;                  // yig'ilgan oyna: tutqich + yo'nalishlar + soni

// Yandex kaliti: telefonda saqlangan bo'lsa xarita darhol shu bilan ochiladi; birinchi marta — serverdan
// (1,5 s kutiladi, kelmasa OSM). Fonda yangilanadi.
let savedKey: string | null | undefined;
function readSavedKey(): string | null | undefined {
  if (savedKey !== undefined) return savedKey;
  try {
    const v = getItem(YANDEX_KEY);
    savedKey = v === null ? undefined : v || null;
  } catch {
    savedKey = undefined;
  }
  return savedKey;
}

export default function SearchTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { c } = useTheme();
  const s = useStyles();
  const { coords, me } = useMyLocation();
  const gender = useAuth().me?.user.gender ?? null;      // o'z joyidagi odamcha: o'g'il / qiz / neytral
  const [items, setItems] = useState<BusinessCard[]>([]);
  const { categories } = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [yandexKey, setYandexKey] = useState<string | null | undefined>(readSavedKey);
  const [focus, setFocus] = useState<Point | null>(null);
  const centered = useRef(me !== null);       // xarita bir marta foydalanuvchi joyiga markazlanadi
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const list = useRef<ScrollViewInstance>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const lastSel = useRef<BusinessCard | null>(null);

  // Oyna uch holatda (yuqoridan masofa): to'liq ro'yxat, o'rta, yig'ilgan. Ekran balandligi — onLayout'dan
  const [H, setH] = useState(height);
  const full = insets.top + 84;
  const mid = Math.round(H * 0.52);
  const peek = H - PEEK;
  const snaps = useRef({ full, mid, peek });
  snaps.current = { full, mid, peek };
  const y = useRef(new Animated.Value(mid)).current;
  const at = useRef(mid);
  const snap = useCallback((to: number) => {
    at.current = to;
    Animated.spring(y, { toValue: to, useNativeDriver: true, damping: 22, stiffness: 200 }).start();
  }, [y]);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (Math.abs(h - H) < 2) return;
    setH(h);
    if (selId === null) {
      const next = Math.round(h * 0.52);
      at.current = next;
      y.setValue(next);
    }
  };
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_, g) => {
      const { full: f, peek: p } = snaps.current;
      y.setValue(Math.min(p, Math.max(f, at.current + g.dy)));
    },
    onPanResponderRelease: (_, g) => {
      const { full: f, mid: m, peek: p } = snaps.current;
      const pos = at.current + g.dy;
      const order = [f, m, p];
      let to: number;
      if (g.vy < -0.5) to = [...order].reverse().find((v) => v < pos - 1) ?? f;      // tez yuqoriga — keyingi holat
      else if (g.vy > 0.5) to = order.find((v) => v > pos + 1) ?? p;                  // tez pastga
      else to = order.reduce((a, b) => (Math.abs(b - pos) < Math.abs(a - pos) ? b : a));
      snap(to);
    },
  })).current;
  const cycle = () => {
    const { full: f, mid: m, peek: p } = snaps.current;
    snap(at.current === p ? m : at.current === m ? f : m);
  };

  // Yandex kaliti: saqlangan bo'lsa — darhol; bo'lmasa 1,5 s kutib OSM bilan ochiladi
  useEffect(() => {
    let done = false;
    const fallback = setTimeout(() => {
      if (!done) setYandexKey((k) => (k === undefined ? null : k));
    }, 1500);
    api<{ yandex_maps_key: string | null }>('/catalog/app-info').then((r) => {
      const k = r.yandex_maps_key || null;
      setItemAsync(YANDEX_KEY, k ?? '').catch(() => {});
      savedKey = k;
      setYandexKey((cur) => (cur === undefined ? k : cur));    // ochilgan xarita qayta yuklanmaydi
    }).catch(() => {
      setYandexKey((cur) => (cur === undefined ? null : cur));
    }).finally(() => {
      done = true;
      clearTimeout(fallback);
    });
    return () => clearTimeout(fallback);
  }, []);

  // Ochilganda (va har safar qaytilganda) joylashuv jimgina yangilanadi — ruxsat so'ralmaydi
  useFocusEffect(useCallback(() => {
    void locateIfAllowed();
  }, []));
  useEffect(() => {
    if (me && !centered.current) {
      centered.current = true;
      setFocus(me);
    }
  }, [me]);

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
    }, 300);
  }, []);

  const shown = useMemo(() => {
    const cat = categories.find((x) => x.slug === category);
    const list = cat ? items.filter((b) => b.category === cat.slug || b.category_name === cat.name_uz) : items;
    return [...list].sort((a, z) => Number(z.is_open_now) - Number(a.is_open_now) || z.rating_avg - a.rating_avg);
  }, [items, category, categories]);

  // Tanlangan salon: xarita yangilansa ham kartochka yo'qolmaydi (oxirgi ma'lumot saqlanadi)
  const selected = selId === null ? null : (shown.find((b) => b.id === selId) ?? lastSel.current);
  lastSel.current = selected;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const select = useCallback((id: number) => {
    const b = shownRef.current.find((x) => x.id === id);
    if (!b) return;
    lastSel.current = b;
    setSelId(id);
    Animated.spring(y, { toValue: snaps.current.peek + PEEK + 40, useNativeDriver: true, damping: 22, stiffness: 200 }).start();
  }, [y]);
  const selRef = useRef(selId);
  selRef.current = selId;
  const closePreview = useCallback(() => {
    if (selRef.current === null) return;
    setSelId(null);
    snap(snaps.current.mid);
  }, [snap]);
  const onLocate = useCallback(async () => {
    const p = await locate().catch(() => null);
    if (!p) setHint(t("Joylashuvga ruxsat berilmagan. Telefon sozlamalaridan yoqing"));
    return p;
  }, []);
  const onMapError = useCallback(() => {
    if (yandexKey) setYandexKey(null);
    else setHint(t("Xaritani yuklab bo'lmadi. Internetni tekshiring"));
  }, [yandexKey]);

  const catLabel = category ? categories.find((x) => x.slug === category) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} onLayout={onLayout}>
      <View style={StyleSheet.absoluteFill}>
        {yandexKey !== undefined && (
          <OsmMap
            key={yandexKey ? 'yandex' : 'osm'}
            yandexKey={yandexKey}
            center={me ?? coords}
            me={me}
            gender={gender}
            focus={focus}
            controlsTop={insets.top + 84}
            onLocate={onLocate}
            businesses={shown}
            onBounds={onBounds}
            onSelect={select}
            selectedId={selId}
            onTapMap={closePreview}
            onError={onMapError}
          />
        )}
      </View>

      <View style={[s.searchWrap, { top: insets.top + 8 }]}>
        <Pressy onPress={() => router.push(category ? { pathname: '/search', params: { category } } : '/search')} style={s.search}
          accessibilityRole="search" scaleTo={0.99}>
          <Icon name="search-outline" size={22} color={c.text} />
          <View style={{ flex: 1 }}>
            <Text style={s.searchTitle} numberOfLines={1}>
              {catLabel ? pick(catLabel.name_uz, catLabel.name_ru) : t("Barcha xizmatlar")}
            </Text>
            <Text style={s.searchSub}>{t("Xarita hududi")}</Text>
          </View>
          <View style={s.searchIcon}><Icon name="options-outline" size={20} color={c.text} /></View>
        </Pressy>
      </View>

      <Animated.View style={[s.sheet, { top: full, height: H - full, transform: [{ translateY: Animated.subtract(y, full) }] }]}>
        <View {...drag.panHandlers} style={s.handleZone}>
          <Pressable onPress={cycle} hitSlop={10} accessibilityRole="button"
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
        <View {...drag.panHandlers}>
          <Pressable onPress={cycle} accessibilityRole="button" accessibilityLabel={t("Ro'yxatni ochish")}>
            <Text style={s.count}>{hint ?? t("Yaqin atrofda {a} ta muassasa", { a: shown.length })}</Text>
          </Pressable>
        </View>
        <ScrollView ref={list} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: mid - full + 40, gap: 26 }}
          showsVerticalScrollIndicator={false}>
          {shown.length === 0 && !hint ? (
            <EmptyState icon="search-outline" title={t("Hech narsa topilmadi")}
              text={t("Xaritani suring yoki boshqa yo'nalishni tanlang")} />
          ) : shown.map((b) => (
            <SalonCardBig key={b.id} item={b} onOpen={() => router.push({ pathname: '/business/[slug]', params: { slug: b.slug } })}
              badge={b.promo_percent ? t("Aksiya −{a}%", { a: b.promo_percent })
                : b.rating_count > 0 && b.rating_avg >= 4.8 ? t("Eng yaxshi") : null}
              badgeIcon={b.promo_percent ? 'pricetag' : undefined} />
          ))}
        </ScrollView>
      </Animated.View>

      <MapPreview item={selected} me={me} bottom={16} onClose={closePreview}
        onOpen={(b) => router.push({ pathname: '/business/[slug]', params: { slug: b.slug } })} />
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
    position: 'absolute', left: 0, right: 0, backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    shadowColor: c.shadow, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 10,
  },
  handleZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 14 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.line },
  chip: { height: 40, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: c.line, justifyContent: 'center' },
  chipOn: { backgroundColor: c.cta, borderColor: c.cta },
  chipText: { fontSize: 14, fontWeight: '600', color: c.text },
  count: { textAlign: 'center', fontSize: 13, color: c.muted, marginVertical: 14 },
}));
