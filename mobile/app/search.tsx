// Qidiruv va filtrlar (prototip "6"): matn, tezkor filtrlar, yo'nalish, narx, natijalar jonli yangilanadi.
import { track } from '../src/analytics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard } from '../src/api';
import { categoryIcon } from '../src/categories';
import { useFavorites } from '../src/favorites';
import { pick, t } from '../src/i18n';
import { distanceM } from '../src/lastLocation';
import { TASHKENT, useMyLocation } from '../src/location';
import { useCategories } from '../src/useCategories';
import { SalonCard } from '../src/SalonCard';
import { Button, Chip, EmptyState, ErrorText, FadeIn, Icon, IconButton, makeStyles, money, useBottomSpace, useTheme, useType } from '../src/ui';

type Sort = 'distance' | 'rating' | 'price';
const POPULAR = [t("Soch turmagi"), t("Manikyur"), t("Tish oqartirish"), t("Massaj"), t("Soqol"), t("Kosmetolog")];
const PRICES = [50_000, 100_000, 200_000, 500_000];

export default function Search() {
  const params = useLocalSearchParams<{ category?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottom = useBottomSpace(16);
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const favorites = useFavorites();
  const { coords: myCoords } = useMyLocation();
  // Muassasa hali yo'q hududda: "Toshkentdagi natijalar" — qidiruv markazi vaqtincha Toshkent
  const [elsewhere, setElsewhere] = useState(false);
  const coords = elsewhere ? TASHKENT : myCoords;
  const farFromTashkent = distanceM(myCoords, TASHKENT.latitude, TASHKENT.longitude) > 50_000;
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const { categories } = useCategories();
  const [sort, setSort] = useState<Sort>('distance');
  const [openNow, setOpenNow] = useState(false);
  const [near, setNear] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [items, setItems] = useState<BusinessCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setError(null);
      try {
        const p = new URLSearchParams({
          lat: String(coords.latitude), lng: String(coords.longitude), radius_m: near ? '2000' : '50000', sort,
        });
        if (q.trim().length >= 2) p.set('q', q.trim());
        if (category) p.set('category', category);
        if (openNow) p.set('open_now', 'true');
        if (maxPrice) p.set('max_price', String(maxPrice));
        const r = await api<{ items: BusinessCard[]; total: number }>(`/catalog/businesses/nearby?${p}`);
        setItems(r.items);
        setTotal(r.total);
      } catch (e) {
        setItems([]);
        setError(e instanceof ApiError ? e.message : t("Xatolik yuz berdi"));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [coords, q, category, sort, openNow, near, maxPrice]);

  // Analitika: yozib bo'lingan qidiruv (1,5 soniya to'xtagach) va tanlangan yo'nalish
  useEffect(() => {
    const word = q.trim();
    if (word.length < 2) return;
    const timer = setTimeout(() => track('search', { q: word, results: total, category: category ?? null }), 1500);
    return () => clearTimeout(timer);
  }, [q, total, category]);
  useEffect(() => {
    if (category) track('category_open', { category });
  }, [category]);

  const reset = () => {
    setQ(''); setCategory(null); setSort('distance'); setOpenNow(false); setNear(false); setMaxPrice(null); setElsewhere(false);
  };

  const header = (
    <View style={{ gap: 18, paddingBottom: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
        <Chip label={t("Hozir ochiq")} icon="time-outline" active={openNow} onPress={() => setOpenNow(!openNow)} />
        <Chip label={t("Reyting")} icon="star-outline" active={sort === 'rating'} onPress={() => setSort(sort === 'rating' ? 'distance' : 'rating')} />
        <Chip label={t("Arzon")} icon="pricetag-outline" active={sort === 'price'} onPress={() => setSort(sort === 'price' ? 'distance' : 'price')} />
        <Chip label={t("2 km gacha")} icon="navigate-outline" active={near} onPress={() => setNear(!near)} />
      </ScrollView>

      {categories.length > 0 && (
        <View>
          <Text style={[ty.caps, { marginBottom: 10 }]}>{t("Yo'nalish")}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {categories.map((x) => (
              <Chip key={x.id} label={pick(x.name_uz, x.name_ru)} icon={categoryIcon(x)} active={category === x.slug}
                onPress={() => setCategory(category === x.slug ? null : x.slug)} />
            ))}
          </View>
        </View>
      )}

      <View style={s.priceCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={ty.h3}>{t("Narx")}</Text>
          <Text style={[ty.link, { fontSize: 14 }]}>{maxPrice ? t("{a}gacha", { a: money(maxPrice) }) : t("Har qanday")}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
          {PRICES.map((p) => (
            <Chip key={p} label={t("{a}gacha", { a: money(p) })} active={maxPrice === p} onPress={() => setMaxPrice(maxPrice === p ? null : p)} />
          ))}
        </View>
      </View>

      {!q && (
        <View>
          <Text style={[ty.caps, { marginBottom: 10 }]}>{t("Ko'p qidiriladi")}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {POPULAR.map((p) => <Chip key={p} label={p} active={false} onPress={() => setQ(p)} />)}
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={ty.caps}>{t("Natijalar · {a}", { a: items ? total : '…' })}</Text>
        <Text style={ty.small}>{sort === 'rating' ? t("Reyting bo'yicha") : sort === 'price' ? t("Arzonroq birinchi") : t("Yaqinroq birinchi")}</Text>
      </View>
      {elsewhere && (
        <View style={s.elsewhere}>
          <Icon name="location-outline" size={18} color={c.accent} />
          <Text style={[ty.small, { flex: 1 }]}>{t("Toshkentdagi natijalar ko'rsatilmoqda")}</Text>
          <Chip label={t("Mening hududim")} icon="navigate-outline" active={false} onPress={() => setElsewhere(false)} />
        </View>
      )}
      <ErrorText text={error} />
    </View>
  );

  // Hududda hech narsa yo'q (faqat yo'nalish tanlangan, boshqa filtr yo'q) — bo'sh ekranda qolib ketmasin
  const onlyRegionEmpty = !q.trim() && !openNow && !near && !maxPrice && !elsewhere;
  const catName = categories.find((x) => x.slug === category);
  const empty = onlyRegionEmpty ? (
    <View>
      <EmptyState icon="storefront-outline"
        title={catName ? t("Bu hududda hali «{a}» yo'q", { a: pick(catName.name_uz, catName.name_ru) }) : t("Bu hududda hali muassasa yo'q")}
        text={t("Muassasalar tez orada qo'shiladi. Boshqa hududni tanlang yoki boshqa shahardagi natijalarni ko'ring.")} />
      <View style={{ gap: 10, marginTop: 4 }}>
        {farFromTashkent && <Button title={t("Toshkentdagi natijalar")} icon="business-outline" onPress={() => setElsewhere(true)} />}
        <Button title={t("Xaritada hududni tanlash")} icon="map-outline" kind="outline" onPress={() => router.navigate('/map')} />
      </View>
    </View>
  ) : (
    <EmptyState icon="search-outline" title={t("Hech narsa topilmadi")} text={t("Filtrlarni yumshatib ko'ring")}
      action={t("Filtrlarni tozalash")} onAction={reset} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="chevron-back" label={t("Orqaga")} onPress={() => router.back()} />
        <View style={s.input}>
          <Icon name="search-outline" size={20} color={c.muted} />
          <TextInput value={q} onChangeText={setQ} autoFocus={!params.category} placeholder={t("Salon, xizmat yoki manzil")}
            placeholderTextColor={c.muted} style={s.inputText} maxLength={60} returnKeyType="search"
            accessibilityLabel={t("Qidiruv")} />
          {!!q && <Icon name="close-circle" size={18} color={c.muted} />}
        </View>
      </View>
      <FlatList
        data={items ?? []}
        keyExtractor={(b) => String(b.id)}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: bottom + 80 }}
        ListEmptyComponent={items === null
          ? <ActivityIndicator style={{ marginTop: 24 }} color={c.accent} />
          : empty}
        renderItem={({ item, index }) => (
          <FadeIn delay={Math.min(index, 6) * 35}>
            <SalonCard item={item} favorite={favorites.has(item.id)} onToggleFavorite={() => favorites.toggle(item.id)}
              onOpen={() => router.push({ pathname: '/business/[slug]', params: { slug: item.slug } })} />
          </FadeIn>
        )}
      />
      <View style={[s.footer, { paddingBottom: bottom }]}>
        <View style={{ width: 120 }}><Button title={t("Tozalash")} kind="outline" onPress={reset} /></View>
        <View style={{ flex: 1 }}>
          <Button title={t("Xaritada ko'rish")} icon="map-outline" onPress={() => router.navigate('/map')} />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.bg },
  input: {
    flex: 1, height: 50, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.accent,
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14,
  },
  inputText: { flex: 1, fontSize: 16, color: c.text, fontWeight: '500' },
  elsewhere: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 12, borderRadius: 16,
    backgroundColor: c.accentSoft,
  },
  priceCard: { padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line,
  },
}));
