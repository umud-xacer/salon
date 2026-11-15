// Bosh sahifa (Figma 01–02): joylashuv, qidiruv, yo'nalishlar, keyingi tashrif, chegirmali vaqtlar,
// tavsiya etilganlar (katta kartalar), sovg'alar, yaqin atrofda.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, Appointment, BusinessCard, Category, Notification } from '../../src/api';
import { categoryIcon, categoryShort } from '../../src/categories';
import { getLang, pick, pickList, t } from '../../src/i18n';
import { getInterests } from '../../src/interests';
import { useMyLocation } from '../../src/location';
import { HotSlots, Perks } from '../../src/promos';
import { SalonCard, SalonCardBig } from '../../src/SalonCard';
import {
  dayOf, EmptyState, ErrorText, FadeIn, Icon, IconButton, makeStyles, Pressy, SectionHeader, timeOf, useTabSpace, useTheme,
} from '../../src/ui';

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
  const { c } = useTheme();
  const s = useStyles();
  const { coords, place } = useMyLocation();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [top, setTop] = useState<BusinessCard[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [mine, setMine] = useState<Appointment[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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
      const base = { lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '50000' };
      const [near, best] = await Promise.all([
        api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${new URLSearchParams({ ...base, sort: 'distance', limit: '10' })}`),
        api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${new URLSearchParams({ ...base, sort: 'rating', limit: '8' })}`),
      ]);
      setItems(near.items);
      setTop(best.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setLoading(false);
    }
  }, [coords]);

  useEffect(() => {
    void load();
  }, [load]);

  const next = useMemo(() => mine
    .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && new Date(a.ends_at).getTime() > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0], [mine]);

  const open = (slug: string) => router.push({ pathname: '/business/[slug]', params: { slug } });
  const tiles = [{ slug: null as string | null, label: t("Barchasi"), icon: 'grid-outline' as const },
    ...categories.map((x) => ({ slug: x.slug as string | null, label: categoryShort(x, getLang()) ?? pick(x.name_uz, x.name_ru), icon: categoryIcon(x) }))];

  const header = (
    <View style={{ paddingTop: insets.top + 6 }}>
      <View style={s.locRow}>
        <Pressy onPress={() => router.navigate('/map')} style={s.loc} accessibilityRole="button"
          accessibilityLabel={t("Joylashuv: {a}", { a: place })}>
          <Icon name="location-outline" size={20} color={c.accent} />
          <Text style={s.locText} numberOfLines={1}>{place}</Text>
          <Icon name="chevron-down" size={18} color={c.text} />
        </Pressy>
        <IconButton icon="notifications-outline" label={t("Bildirishnomalar")} badge={unread || undefined}
          onPress={() => router.push('/inbox')} size={42} />
      </View>

      <View style={s.pad}>
        <Pressy onPress={() => router.push('/search')} style={s.search} accessibilityRole="search" scaleTo={0.99}>
          <Icon name="search-outline" size={22} color={c.text} />
          <Text style={s.searchText} numberOfLines={2}>{t("Xizmat yoki salon qidiring")}</Text>
          <View style={s.searchBtn}><Text style={s.searchBtnText}>{t("Qidirish")}</Text></View>
        </Pressy>
      </View>

      <View style={s.grid}>
        {tiles.map((x) => (
          <Pressy key={x.slug ?? 'all'} style={s.tile} scaleTo={0.94} accessibilityRole="button"
            onPress={() => (x.slug ? router.push({ pathname: '/search', params: { category: x.slug } }) : router.push('/search'))}>
            <View style={s.tileBox}><Icon name={x.icon} size={24} color={c.text} /></View>
            <Text style={s.tileText} numberOfLines={2}>{x.label}</Text>
          </Pressy>
        ))}
      </View>

      {next && (
        <FadeIn style={s.pad}>
          <Pressy onPress={() => router.navigate('/bookings')} style={s.next} accessibilityRole="button">
            <View style={s.nextDate}>
              <Text style={s.nextMonth}>{t(MONTHS[+dayOf(next.starts_at).slice(5, 7) - 1])}</Text>
              <Text style={s.nextDay}>{+dayOf(next.starts_at).slice(8)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={s.nextLabel}>{t("Keyingi tashrif · {a}", { a: whenText(next.starts_at) })}</Text>
              <Text style={s.nextTitle} numberOfLines={1}>{next.business_name}</Text>
              <Text style={s.muted} numberOfLines={1}>{[pickList(next.services, next.services_ru)[0], next.member_name].filter(Boolean).join(' · ')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={c.muted} />
          </Pressy>
        </FadeIn>
      )}

      <HotSlots refreshKey={tick} />

      {top.length > 0 && (
        <View style={{ marginTop: 28 }}>
          <SectionHeader title={t("Tavsiya etilganlar")} action={t("Barchasi")} onAction={() => router.navigate('/map')} style={s.pad} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={324} decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 24, gap: 14, paddingTop: 16 }}>
            {top.map((b) => (
              <SalonCardBig key={b.id} item={b} width={310} onOpen={() => open(b.slug)}
                badge={b.rating_count > 0 && b.rating_avg >= 4.8 ? t("Eng yaxshi") : null} />
            ))}
          </ScrollView>
        </View>
      )}

      <Perks refreshKey={tick} />

      <SectionHeader title={t("Yaqin atrofda")} action={t("Barchasi")} onAction={() => router.navigate('/map')}
        style={[s.pad, { marginTop: 28, marginBottom: 16 }]} />
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
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} tintColor={c.accent} onRefresh={() => { setTick((x) => x + 1); void load(); }} />}
        ListEmptyComponent={loading ? undefined : (
          <EmptyState icon="storefront-outline" title={t("Yaqin atrofda muassasa yo'q")} text={t("Hududingizdagi muassasalar tez orada qo'shiladi")} />
        )}
        renderItem={({ item, index }) => (
          <FadeIn delay={Math.min(index, 6) * 40} style={s.pad}>
            <SalonCard item={item} onOpen={() => open(item.slug)} />
          </FadeIn>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  pad: { paddingHorizontal: 24 },
  locRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 8, gap: 12 },
  loc: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  locText: { fontSize: 16, fontWeight: '700', color: c.text, flexShrink: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 66, paddingLeft: 18, paddingRight: 9, marginTop: 8,
    borderRadius: 999, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line,
    shadowColor: c.shadow, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  searchText: { flex: 1, fontSize: 15, color: c.muted, lineHeight: 20 },
  searchBtn: { height: 48, paddingHorizontal: 22, borderRadius: 999, backgroundColor: c.cta, justifyContent: 'center' },
  searchBtnText: { color: c.ctaText, fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, marginTop: 24, rowGap: 16, columnGap: 10 },
  tile: { width: '22.5%', alignItems: 'center', gap: 8 },
  tileBox: {
    width: '100%', aspectRatio: 1, maxWidth: 78, borderRadius: 20, backgroundColor: c.surface2, borderWidth: 1,
    borderColor: c.line, alignItems: 'center', justifyContent: 'center',
  },
  tileText: { fontSize: 13, color: c.text, textAlign: 'center', lineHeight: 18 },
  next: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 24, borderRadius: 20, borderWidth: 1,
    borderColor: c.line, backgroundColor: c.bg,
  },
  nextDate: { width: 52, height: 56, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  nextMonth: { fontSize: 11, fontWeight: '700', color: c.accent, textTransform: 'uppercase' },
  nextDay: { fontSize: 20, fontWeight: '800', color: c.accent },
  nextLabel: { fontSize: 12, fontWeight: '600', color: c.accent },
  nextTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  muted: { fontSize: 13, color: c.muted },
}));
