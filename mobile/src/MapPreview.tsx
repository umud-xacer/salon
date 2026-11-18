// Xaritada pin bosilganda pastdan chiqadigan salon kartochkasi (Fresha uslubida):
// rasmlar (suriladi), nomi, ★ reyting (sharhlar soni), masofa · manzil, yo'nalish · ochiq/yopiq, "Aksiya" nishoni.
// Kartochka bosilsa — salon sahifasi; "X" — yopiladi.
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { BusinessCard } from './api';
import { pick, t } from './i18n';
import { distanceText } from './SalonCard';
import { Icon, makeStyles, Pressy, useTheme } from './ui';

type Point = { latitude: number; longitude: number };

/** Ikki nuqta orasidagi masofa (metr) — xarita oynasidagi salonlar uchun server masofa bermaydi */
export function metersBetween(a: Point, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.latitude);
  const dLng = rad(b.lng - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function MapPreview({ item, me, onOpen, onClose, bottom }: {
  item: BusinessCard | null; me?: Point | null; onOpen: (b: BusinessCard) => void; onClose: () => void; bottom: number;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const cardW = Math.min(width - 32, 520);
  const y = useRef(new Animated.Value(400)).current;
  // Yopilish animatsiyasi tugaguncha oxirgi salon ko'rinib turadi
  const [shown, setShown] = useState<BusinessCard | null>(item);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (item) {
      setShown(item);
      setPage(0);
      y.setValue(400);
      Animated.spring(y, { toValue: 0, useNativeDriver: Platform.OS !== 'web', damping: 20, stiffness: 190, mass: 0.9 }).start();
    } else {
      Animated.timing(y, { toValue: 400, duration: 180, useNativeDriver: Platform.OS !== 'web' })
        .start(() => setShown(null));
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const b = shown;
  const dist = b.distance_m ?? (me ? metersBetween(me, b) : null);
  const meta = [distanceText(dist), b.address ?? b.city].filter(Boolean).join(' · ');
  const photos = b.photos?.length ? b.photos : [];

  return (
    <Animated.View style={[s.wrap, { bottom, width: cardW, transform: [{ translateY: y }] }]} pointerEvents="box-none">
      <Pressy onPress={() => onOpen(b)} style={s.card} scaleTo={0.985} accessibilityRole="button"
        accessibilityLabel={[b.name, b.rating_count > 0 ? `${b.rating_avg.toFixed(1)} (${b.rating_count})` : t("Yangi"), meta].join(', ')}>
        <View>
          {photos.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width: cardW }}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / cardW))}>
              {photos.map((u) => <Image key={u} source={{ uri: u }} style={[s.photo, { width: cardW }]} resizeMode="cover" />)}
            </ScrollView>
          ) : (
            <View style={[s.photo, { width: cardW, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }]}>
              <Icon name="storefront-outline" size={40} color={c.off} />
            </View>
          )}
          {photos.length > 1 && (
            <View style={s.dots} pointerEvents="none">
              {photos.map((u, i) => <View key={u} style={[s.dot, i === page && s.dotOn]} />)}
            </View>
          )}
          {!!b.promo_percent && (
            <View style={s.promo} pointerEvents="none">
              <Icon name="pricetag" size={13} color="#FFFFFF" />
              <Text style={s.promoText}>{t("Aksiya −{a}%", { a: b.promo_percent })}</Text>
            </View>
          )}
          <Pressable onPress={onClose} hitSlop={10} style={s.close} accessibilityRole="button" accessibilityLabel={t("Yopish")}>
            <Icon name="close" size={20} color="#111114" />
          </Pressable>
        </View>
        <View style={s.body}>
          <View style={s.row}>
            <Text style={s.name} numberOfLines={1}>{b.name}{b.branch_name ? ` · ${b.branch_name}` : ''}</Text>
            {b.rating_count > 0 ? (
              <View style={s.rating}>
                <Icon name="star" size={16} color={c.star} />
                <Text style={s.ratingText}>{b.rating_avg.toFixed(1).replace('.', ',')}</Text>
                <Text style={s.count}>({b.rating_count})</Text>
              </View>
            ) : <Text style={s.newText}>{t("Yangi")}</Text>}
          </View>
          {!!meta && (
            <View style={s.metaRow}>
              <Icon name="location-outline" size={15} color={c.muted} />
              <Text style={s.meta} numberOfLines={1}>{meta}</Text>
            </View>
          )}
          <View style={s.metaRow}>
            <Text style={s.meta} numberOfLines={1}>{pick(b.category_name, b.category_name_ru)}</Text>
            <View style={[s.open, { backgroundColor: b.is_open_now ? c.successSoft : c.surface2 }]}>
              <Text style={[s.openText, { color: b.is_open_now ? c.success : c.muted }]}>
                {b.is_open_now ? t("Hozir ochiq") : t("Yopiq")}
              </Text>
            </View>
          </View>
        </View>
      </Pressy>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: 'absolute', alignSelf: 'center' },
  card: {
    borderRadius: 22, backgroundColor: c.bg, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  photo: { height: 150 },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: '#FFFFFF', width: 16 },
  promo: {
    position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FF3D71', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  promoText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  close: {
    position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: c.text, letterSpacing: -0.3 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 15, fontWeight: '700', color: c.text },
  count: { fontSize: 14, color: c.muted },
  newText: { fontSize: 13, fontWeight: '600', color: c.accent },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { flexShrink: 1, fontSize: 14, color: c.muted },
  open: { marginLeft: 'auto', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  openText: { fontSize: 12, fontWeight: '600' },
}));
