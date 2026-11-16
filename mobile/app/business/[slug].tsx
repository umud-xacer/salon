// Salon sahifasi (Figma 03–07): rasm, ma'lumot, yopishqoq tablar (Xizmatlar / Jamoa / Sharhlar / Ma'lumot),
// pastda "O'xshash salonlar" (yoqmasa — shunga o'xshashlari) va doim ko'rinadigan "Band qilish" paneli.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, Linking, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, ScrollViewInstance, Share, Text,
  useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessCard, BusinessDetail, Service } from '../../src/api';
import { useFavorites } from '../../src/favorites';
import { pick, t } from '../../src/i18n';
import { distanceM, getLastLocation } from '../../src/lastLocation';
import { useMyLocation } from '../../src/location';
import { PharmacyCatalog } from '../../src/PharmacyCatalog';
import { BusinessDeals } from '../../src/promos';
import { addRecent } from '../../src/recent';
import { BusinessReviews } from '../../src/Reviews';
import { distanceText, SalonCardBig } from '../../src/SalonCard';
import {
  Avatar, Button, ErrorText, Gradient, Icon, IconName, makeStyles, money, Pressy, ScreenScroll, UnderlineTabs, useBottomSpace,
  useTheme, useType,
} from '../../src/ui';

type Tab = 'services' | 'team' | 'reviews' | 'info';
const WEEK = [t("Dushanba"), t("Seshanba"), t("Chorshanba"), t("Payshanba"), t("Juma"), t("Shanba"), t("Yakshanba")];
/** Toshkent vaqtida bugungi hafta kuni: 1 — dushanba ... 7 — yakshanba */
const todayWeekday = () => ((new Date(Date.now() + 5 * 3600 * 1000).getUTCDay() + 6) % 7) + 1;
const durationText = (min: number) => (min >= 60
  ? (min % 60 ? t("{a} soat {b} daq", { a: Math.floor(min / 60), b: min % 60 }) : t("{a} soat", { a: min / 60 }))
  : t("{a} daq", { a: min }));

function RoundButton({ icon, label, onPress, color }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.9}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
      <Icon name={icon} size={20} color={color ?? '#111114'} />
    </Pressy>
  );
}

export default function Business() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottom = useBottomSpace(12);
  const { width } = useWindowDimensions();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const favorites = useFavorites();
  const { coords } = useMyLocation();
  const [b, setB] = useState<BusinessDetail | null>(null);
  const [similar, setSimilar] = useState<BusinessCard[]>([]);
  const [group, setGroup] = useState<number | null | 'all'>('all');
  const [photo, setPhoto] = useState(0);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<Tab>('services');
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const y = useRef(new Animated.Value(0)).current;
  const sections = useRef<Record<Tab, number>>({ services: 0, team: 0, reviews: 0, info: 0 });
  const jumping = useRef(false);
  const [tabsY, setTabsY] = useState(10000);

  useEffect(() => {
    setB(null);
    api<BusinessDetail>(`/catalog/businesses/${slug}`)
      .then((d) => {
        setB(d);
        const here = getLastLocation();
        addRecent(d, here && d.lat != null && d.lng != null ? distanceM(here, d.lat, d.lng) : null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("Yuklab bo'lmadi")));
  }, [slug]);

  // O'xshash salonlar: shu yo'nalishda, yaqin atrofda, reyting bo'yicha (o'zi va o'z filiallarisiz)
  useEffect(() => {
    if (!b?.category) return;
    const p = new URLSearchParams({
      lat: String(b.lat ?? coords.latitude), lng: String(b.lng ?? coords.longitude), radius_m: '30000', sort: 'rating',
      category: b.category, limit: '10',
    });
    const own = new Set([b.id, ...(b.branches ?? []).map((x) => x.id)]);
    api<{ items: BusinessCard[] }>(`/catalog/businesses/nearby?${p}`)
      .then((r) => setSimilar(r.items.filter((x) => !own.has(x.id)).slice(0, 8)))
      .catch(() => setSimilar([]));
  }, [b, coords]);

  const kind = b?.kind ?? 'salon';
  const staffWord = kind === 'clinic' ? t("Shifokorlar") : kind === 'pharmacy' ? t("Farmatsevtlar") : t("Jamoa");
  const allServices = useMemo(() => b?.service_groups.flatMap((g) => g.services) ?? [], [b]);
  const shownGroups = (b?.service_groups ?? []).filter((g) => group === 'all' || g.category_id === group);
  const today = todayWeekday();
  const todayHours = b?.hours?.find((h) => h.weekday === today);
  const here = getLastLocation();
  const branches = (b?.branches ?? [])
    .map((br) => ({ ...br, distance: here ? distanceM(here, br.lat, br.lng) : null }))
    .sort((x, z) => (x.distance ?? 0) - (z.distance ?? 0));
  const myDistance = b && here && b.lat != null && b.lng != null ? distanceText(distanceM(here, b.lat, b.lng)) : null;

  if (error) return <ScreenScroll><View style={{ height: insets.top }} /><ErrorText text={error} /></ScreenScroll>;
  if (!b) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}><ActivityIndicator size="large" color={c.accent} /></View>;

  const fav = favorites.has(b.id);
  const canBook = kind !== 'pharmacy' && allServices.length > 0 && b.staff.length > 0;
  const book = (service?: Service, memberId?: number) => router.push({ pathname: '/book', params: {
    slug: b.slug, ...(service ? { serviceId: String(service.id) } : {}), ...(memberId ? { memberId: String(memberId) } : {}),
  } });
  const share = () => { void Share.share({ message: `${b.name}${b.address ? `, ${b.address}` : ''} — Chronix: https://chronix.uz` }); };
  const heroH = Math.min(330, Math.round(width * 0.85));
  const barTop = insets.top + 56;

  const jump = (to: Tab) => {
    setTab(to);
    jumping.current = true;
    scroll.current?.scrollTo({ y: Math.max(0, sections.current[to] - barTop - 50), animated: true });
    setTimeout(() => { jumping.current = false; }, 500);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (jumping.current) return;
    const pos = e.nativeEvent.contentOffset.y + barTop + 60;
    const current = (['info', 'reviews', 'team', 'services'] as Tab[]).find((k) => pos >= sections.current[k]) ?? 'services';
    if (current !== tab) setTab(current);
  };
  const mark = (k: Tab) => (e: { nativeEvent: { layout: { y: number } } }) => { sections.current[k] = e.nativeEvent.layout.y; };

  const tabsView = (
    <UnderlineTabs value={tab} onChange={jump} options={[
      { id: 'services', label: kind === 'pharmacy' ? t("Katalog") : t("Xizmatlar") },
      { id: 'team', label: staffWord },
      { id: 'reviews', label: t("Sharhlar") },
      { id: 'info', label: t("Ma'lumot") },
    ]} />
  );
  const stuck = y.interpolate({ inputRange: [tabsY - barTop + 3, tabsY - barTop + 4], outputRange: [0, 1], extrapolate: 'clamp' });
  const barOpacity = y.interpolate({ inputRange: [heroH - barTop - 40, heroH - barTop], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Animated.ScrollView ref={scroll} showsVerticalScrollIndicator={false} scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: bottom + 100 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: false, listener: onScroll })}>
        {/* 0 — rasm */}
        <View style={{ height: heroH }}>
          {b.photos.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))}>
              {b.photos.map((url) => <Image key={url} source={{ uri: url }} style={{ width, height: heroH }} resizeMode="cover" />)}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="storefront-outline" size={56} color={c.off} />
            </View>
          )}
          {b.photos.length > 1 && (
            <View style={s.counter}><Text style={s.counterText}>{photo + 1}/{b.photos.length}</Text></View>
          )}
        </View>

        {/* 1 — ma'lumot */}
        <View style={s.sheet}>
          <Text style={s.name}>{b.name}</Text>
          <Text style={s.kind}>{pick(b.category_name, b.category_name_ru)}{b.branch_name ? ` · ${b.branch_name}` : ''}</Text>
          {b.rating_count > 0 ? (
            <Pressable onPress={() => jump('reviews')} style={s.ratingRow} accessibilityRole="button">
              <Icon name="star" size={18} color={c.star} />
              <Text style={s.ratingValue}>{b.rating_avg.toFixed(1).replace('.', ',')}</Text>
              <Text style={s.kind}>({t("{a} ta sharh", { a: b.rating_count.toLocaleString('ru-RU').replace(/[, ]/g, ' ') })})</Text>
            </Pressable>
          ) : <Text style={[s.kind, { marginTop: 6 }]}>{t("Yangi muassasa")}</Text>}
          {b.address && (
            <Pressable onPress={() => jump('info')} style={s.address} accessibilityRole="button">
              <Icon name="location-outline" size={18} color={c.text} />
              <Text style={s.addressText} numberOfLines={2}>{[myDistance, b.address].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          )}
          <View style={s.hoursRow}>
            <Icon name="time-outline" size={18} color={b.is_open_now ? c.success : c.danger} />
            <Text style={[s.hoursState, { color: b.is_open_now ? c.success : c.danger }]}>
              {b.is_open_now ? t("Hozir ochiq") : t("Hozir yopiq")}
            </Text>
            <Text style={s.kind}>
              {todayHours ? ` · ${t("bugun {a} – {b}", { a: todayHours.opens_at.slice(0, 5), b: todayHours.closes_at.slice(0, 5) })}` : ` · ${t("bugun dam olish")}`}
            </Text>
          </View>
          {b.description && (
            <View style={{ marginTop: 18, gap: 6 }}>
              <Text style={ty.h3}>{t("Umumiy ma'lumot")}</Text>
              <Text style={ty.body} numberOfLines={more ? undefined : 4}>{b.description}</Text>
              {b.description.length > 160 && (
                <Pressable onPress={() => setMore(!more)} hitSlop={6}><Text style={ty.link}>{more ? t("Yopish") : t("Batafsil")}</Text></Pressable>
              )}
            </View>
          )}
        </View>

        {/* Tablar (surilganda yuqoridagi nusxasi ko'rinadi) */}
        <View style={{ backgroundColor: c.bg, paddingTop: 4 }} onLayout={(e) => setTabsY(e.nativeEvent.layout.y)}>
          {tabsView}
        </View>

        {/* Xizmatlar */}
        <View onLayout={mark('services')} style={s.section}>
          {canBook && <BusinessDeals businessId={b.id} slug={b.slug} lat={b.lat} lng={b.lng} />}
          <Text style={ty.h2}>{kind === 'pharmacy' ? t("Katalog") : t("Xizmatlar")}</Text>
          {kind === 'pharmacy' && <PharmacyCatalog slug={b.slug} />}
          {b.service_groups.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}>
              {[{ id: 'all' as const, label: t("Hammasi") }, ...b.service_groups.map((g) => ({ id: g.category_id, label: pick(g.category_name, g.category_name_ru) }))]
                .map((x) => {
                  const on = group === x.id;
                  return (
                    <Pressy key={String(x.id)} onPress={() => setGroup(x.id)} scaleTo={0.95} style={[s.chip, on && s.chipOn]}
                      accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[s.chipText, on && { color: c.ctaText }]}>{x.label}</Text>
                    </Pressy>
                  );
                })}
            </ScrollView>
          )}
          {shownGroups.flatMap((g) => g.services).map((sv) => (
            <View key={sv.id} style={s.service}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={ty.h3}>{pick(sv.name, sv.name_ru)}</Text>
                <Text style={ty.small} numberOfLines={2}>{durationText(sv.duration_min)}{sv.description ? ` · ${sv.description}` : ''}</Text>
                <Text style={s.price}>{money(sv.price)}</Text>
              </View>
              {canBook && (
                <Pressy onPress={() => book(sv)} style={s.bookBtn} scaleTo={0.94} accessibilityRole="button"
                  accessibilityLabel={`${t("Band qilish")}: ${pick(sv.name, sv.name_ru)}`}>
                  <Text style={s.bookBtnText}>{t("Band qilish")}</Text>
                </Pressy>
              )}
            </View>
          ))}
        </View>

        {/* Jamoa */}
        <View onLayout={mark('team')} style={s.section}>
          <Text style={ty.h2}>{staffWord}</Text>
          {b.staff.length === 0 ? <Text style={ty.small}>{t("Hozircha mutaxassislar qo'shilmagan")}</Text> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 20 }}>
              {b.staff.map((m) => (
                <Pressy key={m.member_id} onPress={() => canBook && book(undefined, m.member_id)} style={s.member} accessibilityRole="button"
                  accessibilityLabel={[m.full_name, m.title].filter(Boolean).join(', ')}>
                  <View>
                    <Avatar name={m.full_name} photo={m.photo_url} size={96} />
                    {m.rating_count > 0 && (
                      <View style={s.memberRating}>
                        <Icon name="star" size={13} color={c.star} />
                        <Text style={s.memberRatingText}>{m.rating_avg.toFixed(1).replace('.', ',')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.memberName} numberOfLines={1}>{m.full_name.split(/\s+/)[0]}</Text>
                  <Text style={s.memberTitle} numberOfLines={1}>{m.title ? t(m.title) : ' '}</Text>
                </Pressy>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Sharhlar */}
        <View onLayout={mark('reviews')} style={s.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={ty.h2}>{t("Sharhlar")}</Text>
            {b.rating_count > 0 && <View style={s.count}><Text style={s.countText}>{b.rating_count}</Text></View>}
          </View>
          <BusinessReviews slug={b.slug} staffWord={kind === 'clinic' ? t("Shifokor") : t("Usta")} />
        </View>

        {/* Ma'lumot */}
        <View onLayout={mark('info')} style={s.section}>
          <Text style={ty.h2}>{t("Ish vaqti")}</Text>
          <View style={{ gap: 12 }}>
            {WEEK.map((day, i) => {
              const h = b.hours?.find((x) => x.weekday === i + 1);
              const isToday = i + 1 === today;
              return (
                <View key={day} style={s.hourRow}>
                  <View style={[s.dot, { backgroundColor: h ? c.success : c.off }]} />
                  <Text style={[ty.body, { flex: 1 }, isToday && { fontFamily: 'PlusJakartaSans_700Bold' }]}>{day}</Text>
                  <Text style={[ty.body, isToday && { fontFamily: 'PlusJakartaSans_700Bold' }, !h && { color: c.muted }]}>
                    {h ? `${h.opens_at.slice(0, 5)} – ${h.closes_at.slice(0, 5)}` : t("Yopiq")}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={s.hr} />
          <Text style={ty.h2}>{t("Manzil")}</Text>
          {b.address && <Text style={ty.body}>{b.address}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {b.lat != null && b.lng != null && (
              <View style={{ flex: 1 }}>
                <Button title={t("Yo'nalish")} icon="navigate-outline" kind="outline" compact
                  onPress={() => Linking.openURL(`geo:${b.lat},${b.lng}?q=${b.lat},${b.lng}(${encodeURIComponent(b.name)})`).catch(() =>
                    Linking.openURL(`https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=17/${b.lat}/${b.lng}`))} />
              </View>
            )}
            {b.phone && (
              <View style={{ flex: 1 }}>
                <Button title={t("Qo'ng'iroq")} icon="call-outline" kind="outline" compact onPress={() => Linking.openURL(`tel:${b.phone}`)} />
              </View>
            )}
          </View>
          {branches.length > 0 && (
            <>
              <View style={s.hr} />
              <Text style={ty.h2}>{t("Boshqa filiallar ({a})", { a: branches.length })}</Text>
              {branches.map((br) => (
                <Pressable key={br.id} onPress={() => router.push(`/business/${br.slug}`)} style={s.branch} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <Text style={ty.h3} numberOfLines={1}>{br.branch_name ?? br.name}</Text>
                    <Text style={ty.small} numberOfLines={1}>{[distanceText(br.distance), br.address ?? br.city].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Text style={[ty.small, { color: br.is_open_now ? c.success : c.danger }]}>{br.is_open_now ? t("Ochiq") : t("Yopiq")}</Text>
                  <Icon name="chevron-forward" size={18} color={c.muted} />
                </Pressable>
              ))}
            </>
          )}
        </View>

        {/* O'xshash salonlar */}
        {similar.length > 0 && (
          <View style={[s.section, { borderTopWidth: 8, borderTopColor: c.surface2, paddingTop: 24 }]}>
            <Text style={ty.h2}>{t("O'xshash salonlar")}</Text>
            <Text style={ty.small}>{t("Shu yo'nalishdagi yaqin va yuqori baholangan muassasalar")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 14, paddingTop: 6 }}>
              {similar.map((x) => (
                <SalonCardBig key={x.id} item={x} width={270} onOpen={() => router.push({ pathname: '/business/[slug]', params: { slug: x.slug } })}
                  badge={x.rating_count > 0 && x.rating_avg >= 4.8 ? t("Eng yaxshi") : null} />
              ))}
            </ScrollView>
          </View>
        )}
      </Animated.ScrollView>

      {/* Yuqori panel: rasm ustida yumaloq tugmalar, pastga surilganda — oq panel va nom */}
      <Animated.View pointerEvents="none" style={[s.topBg, { height: barTop, opacity: barOpacity }]} />
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: barTop, backgroundColor: c.bg, opacity: stuck,
        transform: [{ translateY: stuck.interpolate({ inputRange: [0, 1], outputRange: [-400, 0] }) }] }}>
        {tabsView}
      </Animated.View>
      <View style={[s.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
        <RoundButton icon="arrow-back" label={t("Orqaga")} onPress={() => router.back()} />
        <Animated.Text style={[s.topTitle, { opacity: barOpacity }]} numberOfLines={1}>{b.name}</Animated.Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <RoundButton icon="share-social-outline" label={t("Ulashish")} onPress={share} />
          <RoundButton icon={fav ? 'heart' : 'heart-outline'} color={fav ? '#E0245E' : undefined}
            label={fav ? t("Sevimlilardan olib tashlash") : t("Sevimlilarga qo'shish")} onPress={() => favorites.toggle(b.id)} />
        </View>
      </View>

      {canBook && (
        <View style={[s.bookBar, { paddingBottom: bottom }]}>
          <Text style={s.barText}>{t("{a} ta xizmat mavjud", { a: allServices.length })}</Text>
          <Pressy onPress={() => book()} style={s.barBtn} accessibilityRole="button">
            <Text style={s.barBtnText}>{t("Band qilish")}</Text>
          </Pressy>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  counter: { position: 'absolute', right: 14, bottom: 42, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(17,17,20,0.6)' },
  counterText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  sheet: {
    marginTop: -28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: c.bg, paddingHorizontal: 24,
    paddingTop: 28, paddingBottom: 20,
  },
  name: { fontSize: 26, fontWeight: '700', color: c.text, letterSpacing: -0.6, lineHeight: 32 },
  kind: { fontSize: 15, color: c.muted },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  ratingValue: { fontSize: 16, fontWeight: '700', color: c.text },
  address: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, backgroundColor: c.surface2,
  },
  addressText: { flex: 1, fontSize: 13, color: c.text },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  hoursState: { fontSize: 13, fontWeight: '600' },
  section: { paddingHorizontal: 24, paddingTop: 26, gap: 14 },
  chip: { height: 40, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: c.line, justifyContent: 'center' },
  chipOn: { backgroundColor: c.cta, borderColor: c.cta },
  chipText: { fontSize: 14, fontWeight: '600', color: c.text },
  service: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: c.line,
    backgroundColor: c.bg,
  },
  price: { fontSize: 15, fontWeight: '700', color: c.text, marginTop: 4 },
  bookBtn: { height: 40, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: c.line, justifyContent: 'center' },
  bookBtnText: { fontSize: 14, fontWeight: '600', color: c.text },
  member: { width: 100, alignItems: 'center' },
  memberRating: {
    position: 'absolute', bottom: -12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line,
  },
  memberRatingText: { fontSize: 13, fontWeight: '600', color: c.text },
  memberName: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 20 },
  memberTitle: { fontSize: 13, color: c.muted },
  count: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: c.line },
  countText: { fontSize: 11, fontWeight: '600', color: c.text },
  hourRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  hr: { height: 1, backgroundColor: c.line, marginVertical: 4 },
  branch: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.line },
  topBg: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.line },
  topBar: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: c.text },
  bookBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 24, paddingTop: 16, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line,
  },
  barText: { flex: 1, fontSize: 15, color: c.muted },
  barBtn: { height: 52, paddingHorizontal: 26, borderRadius: 999, backgroundColor: c.cta, justifyContent: 'center' },
  barBtnText: { fontSize: 16, fontWeight: '600', color: c.ctaText },
}));
