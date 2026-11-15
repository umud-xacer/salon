// Bosh sahifa (prototip "Dynamic Home"): gradient sarlavha, shisha qidiruv, tezkor filtrlar, keyingi tashrif,
// yo'nalishlar, chegirmali bo'sh vaqtlar, bonuslar, "Yana bir bor", top va yaqin muassasalar.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, FlatList, Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, Appointment, BusinessCard, Category, Notification } from '../../src/api';
import { useAuth } from '../../src/auth';
import { categoryIcon, categoryTint } from '../../src/categories';
import { useFavorites } from '../../src/favorites';
import { pick, pickList, t } from '../../src/i18n';
import { getInterests } from '../../src/interests';
import { useMyLocation } from '../../src/location';
import { HotSlots, Perks } from '../../src/promos';
import { distanceText, SalonCard } from '../../src/SalonCard';
import {
  dayOf, Empty, EmptyState, ErrorText, FadeIn, Glass, Gradient, Icon, IconButton, makeStyles, Pressy, SectionHeader,
  timeOf, useTabSpace, useTheme,
} from '../../src/ui';

const BANNER = Math.round(Dimensions.get('window').width * 0.72);

type Quick = 'open' | 'rating' | 'price' | 'near';
const QUICK: { id: Quick; label: string }[] = [
  { id: 'open', label: t("Hozir ochiq") },
  { id: 'rating', label: t("★ Reyting") },
  { id: 'price', label: t("Arzon") },
  { id: 'near', label: t("1 km gacha") },
];

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];

function whenText(iso: string) {
  const day = dayOf(iso);
  const today = dayOf(new Date().toISOString());
  const tomorrow = dayOf(new Date(Date.now() + 86400000).toISOString());
  const label = day === today ? t("bugun") : day === tomorrow ? t("ertaga") : `${+day.slice(8)}-${t(MONTHS[+day.slice(5, 7) - 1])}`;
  return `${label} ${timeOf(iso)}`;
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabSpace();
  const { me } = useAuth();
  const { c, dark, setMode } = useTheme();
  const s = useStyles();
  const favorites = useFavorites();
  const { coords, place } = useMyLocation();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [top, setTop] = useState<BusinessCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [mine, setMine] = useState<Appointment[]>([]);
  const [quick, setQuick] = useState<Quick[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);              // pastga tortilganda Hot Slots/bonuslar ham yangilanadi

  useEffect(() => {
    api<Category[]>('/catalog/categories').then((list) => {
      const liked = getInterests();
      setCategories([...list].sort((a, b) => Number(liked.includes(b.slug)) - Number(liked.includes(a.slug))));
    }).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    api<Notification[]>('/notifications?unread=true&limit=50').then((l) => setUnread(l.length)).catch(() => {});
    api<Appointment[]>('/appointments/mine?upcoming=false').then(setMine).catch(() => {});
  }, []));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = { lat: String(coords.latitude), lng: String(coords.longitude) };
      const sort = quick.includes('price') ? 'price' : quick.includes('rating') ? 'rating' : 'distance';
      const params = new URLSearchParams({ ...base, radius_m: quick.includes('near') ? '1000' : '50000', sort });
      if (quick.includes('open')) params.set('open_now', 'true');
      const best = new URLSearchParams({ ...base, radius_m: '50000', sort: 'rating', limit: '6' });
      const [near, b] = await Promise.all([
        api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${params}`),
        api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${best}`),
      ]);
      setItems(near.items);
      setTop(b.items.filter((x) => x.rating_count > 0));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setLoading(false);
    }
  }, [coords, quick]);

  useEffect(() => {
    void load();
  }, [load]);

  const next = useMemo(() => mine
    .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && new Date(a.ends_at).getTime() > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0], [mine]);

  // "Yana bir bor": yakunlangan tashriflardan har muassasa bir marta, eng yangisi
  const again = useMemo(() => {
    const seen = new Set<string>();
    return mine
      .filter((a) => a.status === 'completed' && a.business_slug)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
      .filter((a) => (seen.has(a.business_slug!) ? false : (seen.add(a.business_slug!), true)))
      .slice(0, 6);
  }, [mine]);

  const openBusiness = (slug: string) => router.push({ pathname: '/business/[slug]', params: { slug } });
  const firstName = me?.user.full_name?.split(/\s+/)[0];
  const toggleQuick = (q: Quick) => setQuick((list) => {
    const rest = list.filter((x) => x !== q && !((q === 'rating' && x === 'price') || (q === 'price' && x === 'rating')));
    return list.includes(q) ? rest : [...rest, q];
  });

  const header = (
    <View>
      <Gradient colors={c.hero} style={[s.hero, { paddingTop: insets.top + 10 }]}>
        <View style={[s.blob, { right: -80, top: -60, backgroundColor: dark ? 'rgba(123,75,255,0.35)' : 'rgba(255,255,255,0.18)' }]} />
        <View style={[s.blob, { left: -70, bottom: -110, backgroundColor: dark ? 'rgba(53,102,255,0.3)' : 'rgba(120,200,255,0.3)' }]} />
        <View style={s.topRow}>
          <Pressy onPress={() => router.navigate('/map')} style={{ flex: 1 }} accessibilityRole="button"
            accessibilityLabel={t("Joylashuv: {a}", { a: place })}>
            <Text style={s.placeLabel}>{t("Joylashuv")}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="location" size={15} color="#FFFFFF" />
              <Text style={s.place} numberOfLines={1}>{place}</Text>
              <Icon name="chevron-down" size={14} color="#FFFFFF" />
            </View>
          </Pressy>
          <IconButton icon="notifications-outline" glass label={t("Bildirishnomalar")} badge={unread || undefined}
            onPress={() => router.push('/inbox')} />
          <IconButton icon={dark ? 'sunny-outline' : 'moon-outline'} glass label={t("Rejimni almashtirish")}
            onPress={() => setMode(dark ? 'light' : 'dark')} />
        </View>
        <Text style={s.hello}>{firstName ? t("Salom, {a}", { a: firstName }) : t("Salom!")}</Text>
        <Text style={s.helloSub}>{t("Bugun o'zingizga vaqt ajrating")}</Text>

        <Pressy onPress={() => router.push('/search')} accessibilityRole="search" accessibilityLabel={t("Qidiruv")}>
          <Glass style={s.search} intensity={30} tint="rgba(255,255,255,0.16)">
            <Icon name="search-outline" size={20} color="rgba(255,255,255,0.9)" />
            <Text style={s.searchText}>{t("Xizmat, salon yoki usta")}</Text>
            <View style={s.filterBtn}><Icon name="options-outline" size={19} color={c.hero[1]} /></View>
          </Glass>
        </Pressy>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginTop: 12 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {QUICK.map((q) => {
            const on = quick.includes(q.id);
            return (
              <Pressy key={q.id} onPress={() => toggleQuick(q.id)} scaleTo={0.94} accessibilityRole="button"
                accessibilityState={{ selected: on }} style={[s.quick, on && s.quickOn]}>
                <Text style={[s.quickText, on && { color: c.hero[1] }]}>{q.label}</Text>
              </Pressy>
            );
          })}
        </ScrollView>
      </Gradient>

      {next ? (
        <FadeIn>
          <Pressy onPress={() => router.navigate('/bookings')} style={s.nextCard} accessibilityRole="button">
            <View style={s.dateBox}>
              <Text style={s.dateMonth}>{t(MONTHS[+dayOf(next.starts_at).slice(5, 7) - 1])}</Text>
              <Text style={s.dateDay}>{+dayOf(next.starts_at).slice(8)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={s.live} />
                <Text style={s.nextLabel}>{t("Keyingi tashrif · {a}", { a: whenText(next.starts_at) })}</Text>
              </View>
              <Text style={s.nextTitle} numberOfLines={1}>
                {pickList(next.services, next.services_ru)[0]} — {next.business_name}
              </Text>
              <Text style={s.muted} numberOfLines={1}>{[next.member_name, next.status === 'pending' ? t("Tasdiq kutilmoqda") : null].filter(Boolean).join(' · ')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={c.muted} />
          </Pressy>
        </FadeIn>
      ) : <View style={{ height: 14 }} />}

      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cats}>
          {categories.map((cat) => {
            const tint = categoryTint(cat, dark);
            return (
              <Pressy key={cat.id} onPress={() => router.push({ pathname: '/search', params: { category: cat.slug } })}
                style={s.cat} scaleTo={0.93} accessibilityRole="button">
                <View style={[s.catIcon, { backgroundColor: tint.bg }]}>
                  <Icon name={categoryIcon(cat)} size={26} color={tint.fg} />
                </View>
                <Text style={s.catText} numberOfLines={1}>{pick(cat.name_uz, cat.name_ru)}</Text>
              </Pressy>
            );
          })}
        </ScrollView>
      )}

      <HotSlots refreshKey={tick} />
      <Perks refreshKey={tick} />

      {again.length > 0 && (
        <View style={{ marginTop: 26 }}>
          <SectionHeader title={t("Yana bir bor")} action={t("Tarix")} onAction={() => router.navigate('/bookings')} style={s.pad} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingTop: 12 }}>
            {again.map((a) => (
              <Pressy key={a.id} onPress={() => openBusiness(a.business_slug!)} style={s.again} accessibilityRole="button">
                <View style={s.againIcon}><Icon name="refresh" size={18} color={c.accent} /></View>
                <View>
                  <Text style={s.againTitle} numberOfLines={1}>{pickList(a.services, a.services_ru)[0]}</Text>
                  <Text style={s.muted} numberOfLines={1}>{[a.business_name, a.member_name].filter(Boolean).join(' · ')}</Text>
                </View>
              </Pressy>
            ))}
          </ScrollView>
        </View>
      )}

      {top.length > 0 && (
        <View style={{ marginTop: 26 }}>
          <SectionHeader title={t("Top muassasalar")} sub={t("Mijozlar eng yuqori baholagan")} style={s.pad} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={BANNER + 10} decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingTop: 12 }}>
            {top.map((b) => (
              <Pressy key={b.id} onPress={() => openBusiness(b.slug)} style={s.banner} accessibilityRole="button">
                {b.photos?.[0]
                  ? <Image source={{ uri: b.photos[0] }} style={s.bannerImg} resizeMode="cover" />
                  : <Gradient colors={c.avatar} style={s.bannerImg} />}
                <Gradient colors={['transparent', 'rgba(0,0,0,0.65)']} diagonal={false} style={s.bannerImg} />
                <View style={s.bannerBody}>
                  <Text style={s.bannerSmall}>★ {b.rating_avg.toFixed(1)} ({b.rating_count}) · {distanceText(b.distance_m) ?? b.city}</Text>
                  <Text style={s.bannerTitle} numberOfLines={1}>{b.name}</Text>
                  <Text style={s.bannerSmall} numberOfLines={1}>{pick(b.category_name, b.category_name_ru)}</Text>
                </View>
              </Pressy>
            ))}
          </ScrollView>
        </View>
      )}

      <SectionHeader title={t("Yaqin atrofda")} action={t("Xaritada")} onAction={() => router.navigate('/map')}
        style={[s.pad, { marginTop: 26, marginBottom: 12 }]} />
      <View style={s.pad}><ErrorText text={error} /></View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={items}
        keyExtractor={(b) => String(b.id)}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: tabSpace }}
        refreshControl={<RefreshControl refreshing={loading} tintColor={c.accent} onRefresh={() => { setTick((x) => x + 1); void load(); }} />}
        ListEmptyComponent={loading ? undefined : (
          quick.length > 0
            ? <Empty text={t("Bu shartlarga mos muassasa topilmadi")} />
            : <EmptyState icon="storefront-outline" title={t("Yaqin atrofda muassasa yo'q")} text={t("Hududingizdagi muassasalar tez orada qo'shiladi")} />
        )}
        renderItem={({ item, index }) => (
          <FadeIn delay={Math.min(index, 6) * 40} style={s.pad}>
            <SalonCard item={item} favorite={favorites.has(item.id)} onToggleFavorite={() => favorites.toggle(item.id)}
              onOpen={() => openBusiness(item.slug)} />
          </FadeIn>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  pad: { paddingHorizontal: 16 },
  hero: { paddingHorizontal: 16, paddingBottom: 60, overflow: 'hidden' },
  blob: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  placeLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  place: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', flexShrink: 1 },
  hello: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 22 },
  helloSub: { color: 'rgba(255,255,255,0.82)', fontSize: 15, marginTop: 4 },
  search: {
    marginTop: 18, height: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16,
    paddingRight: 7, borderColor: 'rgba(255,255,255,0.35)',
  },
  searchText: { flex: 1, color: 'rgba(255,255,255,0.88)', fontSize: 15 },
  filterBtn: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  quick: {
    height: 34, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)',
    backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center',
  },
  quickOn: { backgroundColor: '#FFFFFF' },
  quickText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  nextCard: {
    marginTop: -44, marginHorizontal: 16, padding: 14, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1,
    borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: c.shadow, shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6,
  },
  dateBox: { width: 54, height: 60, borderRadius: 16, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  dateMonth: { fontSize: 11, fontWeight: '800', color: c.accent, textTransform: 'uppercase' },
  dateDay: { fontSize: 22, fontWeight: '800', color: c.accent },
  live: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.success },
  nextLabel: { fontSize: 12, fontWeight: '700', color: c.success },
  nextTitle: { fontSize: 16, fontWeight: '800', color: c.text },
  muted: { fontSize: 13, color: c.muted },
  cats: { paddingHorizontal: 16, gap: 8, paddingTop: 20 },
  cat: { width: 70, alignItems: 'center', gap: 7 },
  catIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  catText: { fontSize: 11.5, fontWeight: '700', color: c.text, textAlign: 'center' },
  again: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingRight: 16, borderRadius: 20,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, maxWidth: 280,
  },
  againIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  againTitle: { fontSize: 14, fontWeight: '800', color: c.text },
  banner: { width: BANNER, height: 150, borderRadius: 22, overflow: 'hidden', backgroundColor: c.line },
  bannerImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bannerBody: { flex: 1, justifyContent: 'flex-end', padding: 14, gap: 2 },
  bannerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  bannerSmall: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
}));
