// Bosh sahifa — Fresha ko'rinishi (loyxalar/fresha1-3.jpg) va Figma 01–02: joylashuv, qidiruv, yo'nalishlar setkasi,
// "Tavsiya etilganlar", "Yaqinda ko'rilganlar", "Chronix'da yangi" (yonma-yon katta kartalar),
// "Yaqin atrofdagi muassasalar" (3 ta qator + Hammasini ko'rish).
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard } from '../../src/api';
import { categoryIcon, categoryShort } from '../../src/categories';
import { getLang, pick, t } from '../../src/i18n';
import { getInterests } from '../../src/interests';
import { getRecent } from '../../src/recent';
import { useMyLocation } from '../../src/location';
import { useCategories } from '../../src/useCategories';
import { SalonCard, SalonCardBig } from '../../src/SalonCard';
import { EmptyState, ErrorText, Icon, IconName, makeStyles, Pressy, useTabSpace, useTheme } from '../../src/ui';

const NEARBY_ON_HOME = 3;

function Carousel({ items, onOpen, badge }: {
  items: BusinessCard[]; onOpen: (slug: string) => void; badge: (b: BusinessCard) => [string, IconName?] | null;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={300} decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
      {items.map((b) => {
        const bd = badge(b);
        return <SalonCardBig key={b.id} item={b} width={286} onOpen={() => onOpen(b.slug)} badge={bd?.[0]} badgeIcon={bd?.[1]} />;
      })}
    </ScrollView>
  );
}

function Title({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  const s = useStyles();
  return (
    <View style={s.titleRow}>
      <Text style={s.title} numberOfLines={1} accessibilityRole="header">{text}</Text>
      {action && onAction && <Pressy onPress={onAction} accessibilityRole="button"><Text style={s.titleAction}>{action}</Text></Pressy>}
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabSpace();
  const { c } = useTheme();
  const s = useStyles();
  const { coords, place } = useMyLocation();
  const [near, setNear] = useState<BusinessCard[]>([]);
  const [top, setTop] = useState<BusinessCard[]>([]);
  const { categories: allCategories, reload: reloadCategories } = useCategories();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<BusinessCard[]>([]);

  useFocusEffect(useCallback(() => {
    setRecent(getRecent());
  }, []));

  // Yo'nalishlar hududga bog'liq emas: muassasa yo'q viloyatda ham hammasi ko'rinadi (qiziqishlar birinchi)
  const categories = useMemo(() => {
    const liked = getInterests();
    return [...allCategories].sort((a, b) => Number(liked.includes(b.slug)) - Number(liked.includes(a.slug)));
  }, [allCategories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = { lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '50000' };
      const [n, b] = await Promise.all([
        api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${new URLSearchParams({ ...base, sort: 'distance', limit: '30' })}`),
        api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${new URLSearchParams({ ...base, sort: 'rating', limit: '8' })}`),
      ]);
      setNear(n.items);
      setTop(b.items.filter((x) => x.rating_count > 0));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
    } finally {
      setLoading(false);
    }
  }, [coords]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Yangi": hali baholanmagan (yangi qo'shilgan) muassasalar, yaqinidan
  const fresh = useMemo(() => near.filter((b) => b.rating_count === 0).slice(0, 8), [near]);
  // Tavsiya: baholanganlar bo'lmasa — eng yaqinlari
  const recommended = top.length ? top : near.slice(0, 8);

  const open = (slug: string) => router.push({ pathname: '/business/[slug]', params: { slug } });
  const tiles = [{ slug: null as string | null, label: t("Barchasi"), icon: 'grid-outline' as const },
    ...categories.map((x) => ({ slug: x.slug as string | null, label: categoryShort(x, getLang()) ?? pick(x.name_uz, x.name_ru), icon: categoryIcon(x) }))];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: tabSpace }}
      refreshControl={<RefreshControl refreshing={loading} tintColor={c.accent} onRefresh={() => { void load(); void reloadCategories(); }} />}>
      <Pressy onPress={() => router.navigate('/map')} style={s.loc} accessibilityRole="button"
        accessibilityLabel={t("Joylashuv: {a}", { a: place })}>
        <Icon name="location" size={20} color={c.accent} />
        <Text style={s.locText} numberOfLines={1}>
          {place === t("Toshkent") || place === t("Joylashuvingiz") ? t("Mening joylashuvim") : place}
        </Text>
        <Icon name="chevron-down" size={18} color={c.text} />
      </Pressy>

      <View style={s.pad}>
        <Pressy onPress={() => router.push('/search')} style={s.search} accessibilityRole="search" scaleTo={0.99}>
          <Icon name="search-outline" size={22} color={c.text} />
          <Text style={s.searchText} numberOfLines={2}>{t("Barcha xizmatlarni ko'rish")}</Text>
          <View style={s.searchBtn}><Text style={s.searchBtnText}>{t("Qidirish")}</Text></View>
        </Pressy>
      </View>

      <View style={s.grid}>
        {tiles.map((x) => (
          <Pressy key={x.slug ?? 'all'} style={s.tile} scaleTo={0.94} accessibilityRole="button"
            onPress={() => (x.slug ? router.push({ pathname: '/search', params: { category: x.slug } }) : router.push('/search'))}>
            <View style={s.tileBox}><Icon name={x.icon} size={28} color={c.text} /></View>
            <Text style={s.tileText} numberOfLines={2}>{x.label}</Text>
          </Pressy>
        ))}
      </View>

      <View style={s.pad}><ErrorText text={error} /></View>

      {recommended.length > 0 && (
        <>
          <Title text={t("Tavsiya etilganlar")} />
          <Carousel items={recommended} onOpen={open}
            badge={(b) => (b.rating_count > 0 && b.rating_avg >= 4.8 ? [t("Eng yaxshi"), 'trophy'] : null)} />
        </>
      )}

      {recent.length > 0 && (
        <>
          <Title text={t("Yaqinda ko'rilganlar")} />
          <Carousel items={recent} onOpen={open}
            badge={(b) => (b.rating_count > 0 && b.rating_avg >= 4.8 ? [t("Eng yaxshi"), 'trophy'] : null)} />
        </>
      )}

      {fresh.length > 0 && (
        <>
          <Title text={t("Chronix'da yangi")} />
          <Carousel items={fresh} onOpen={open} badge={() => [t("Yangi")]} />
        </>
      )}

      {near.length > 0 ? (
        <>
          <Title text={t("Yaqin atrofdagi muassasalar")} action={t("Hammasini ko'rish")} onAction={() => router.navigate('/map')} />
          <View style={s.pad}>
            {near.slice(0, NEARBY_ON_HOME).map((b) => <SalonCard key={b.id} item={b} onOpen={() => open(b.slug)} />)}
          </View>
        </>
      ) : !loading && (
        <EmptyState icon="storefront-outline" title={t("Yaqin atrofda muassasa yo'q")} text={t("Hududingizdagi muassasalar tez orada qo'shiladi")}
          action={t("Boshqa hududdagi muassasalar")} onAction={() => router.push('/search')} />
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  pad: { paddingHorizontal: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginTop: 40, marginBottom: 16 },
  title: { flex: 1, fontSize: 24, fontWeight: '700', color: c.text, letterSpacing: -0.6 },
  titleAction: { fontSize: 15, fontWeight: '500', color: c.text },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, alignSelf: 'flex-start' },
  locText: { fontSize: 17, fontWeight: '500', color: c.text, flexShrink: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 12, height: 66, paddingLeft: 18, paddingRight: 9, marginTop: 4,
    borderRadius: 999, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line,
    shadowColor: c.shadow, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  searchText: { flex: 1, fontSize: 15, color: c.muted, lineHeight: 20 },
  searchBtn: { height: 48, paddingHorizontal: 22, borderRadius: 999, backgroundColor: c.cta, justifyContent: 'center' },
  searchBtnText: { color: c.ctaText, fontSize: 15, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, marginTop: 28, rowGap: 22 },
  tile: { width: '25%', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  tileBox: {
    width: '100%', aspectRatio: 1, maxWidth: 82, borderRadius: 22, backgroundColor: c.surface2, borderWidth: 1,
    borderColor: c.line, alignItems: 'center', justifyContent: 'center',
  },
  tileText: { fontSize: 14, color: c.text, textAlign: 'center', lineHeight: 19 },
}));
