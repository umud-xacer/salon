// Muassasa sahifasi (prototip "8"): katta rasm, shisha tugmalar, ma'lumot kartasi, bo'limlar
// (Xizmatlar / Mutaxassislar / Sharhlar / Ma'lumot) va pastda qotgan "Bron qilish".
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Share, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, BusinessDetail, Service } from '../../src/api';
import { useFavorites } from '../../src/favorites';
import { pick, t } from '../../src/i18n';
import { distanceM, getLastLocation } from '../../src/lastLocation';
import { PharmacyCatalog } from '../../src/PharmacyCatalog';
import { BusinessReviews } from '../../src/Reviews';
import { distanceText } from '../../src/SalonCard';
import {
  Avatar, Badge, Button, ErrorText, Glass, Gradient, Icon, makeStyles, money, Pressy, ScreenScroll, Segments, useBottomSpace,
  useTheme, useType,
} from '../../src/ui';

type Tab = 'services' | 'staff' | 'reviews' | 'info';
const WEEK = [t("Dushanba"), t("Seshanba"), t("Chorshanba"), t("Payshanba"), t("Juma"), t("Shanba"), t("Yakshanba")];

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
  const [b, setB] = useState<BusinessDetail | null>(null);
  const [tab, setTab] = useState<Tab>('services');
  const [photo, setPhoto] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BusinessDetail>(`/catalog/businesses/${slug}`)
      .then(setB)
      .catch((e) => setError(e instanceof ApiError ? e.message : t("Yuklab bo'lmadi")));
  }, [slug]);

  const kind = b?.kind ?? 'salon';
  const staffWord = kind === 'clinic' ? t("Shifokorlar") : kind === 'pharmacy' ? t("Farmatsevtlar") : t("Ustalar");
  const minPrice = useMemo(() => {
    const all = b?.service_groups.flatMap((g) => g.services.map((x) => x.price)) ?? [];
    return all.length ? Math.min(...all) : null;
  }, [b]);
  const here = getLastLocation();
  const branches = (b?.branches ?? [])
    .map((br) => ({ ...br, distance: here ? distanceM(here, br.lat, br.lng) : null }))
    .sort((x, y) => (x.distance ?? 0) - (y.distance ?? 0));

  if (error) return <ScreenScroll><View style={{ height: insets.top }} /><ErrorText text={error} /></ScreenScroll>;
  if (!b) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}><ActivityIndicator size="large" color={c.accent} /></View>;

  const fav = favorites.has(b.id);
  const book = (service?: Service, memberId?: number) => router.push({ pathname: '/book', params: {
    slug: b.slug, ...(service ? { serviceId: String(service.id) } : {}), ...(memberId ? { memberId: String(memberId) } : {}),
  } });
  const heroH = Math.min(320, Math.round(width * 0.82));
  const canBook = kind !== 'pharmacy' && b.service_groups.length > 0 && b.staff.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottom + 90 }} showsVerticalScrollIndicator={false}>
        <View style={{ height: heroH }}>
          {b.photos.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / width))}>
              {b.photos.map((url) => <Image key={url} source={{ uri: url }} style={{ width, height: heroH }} resizeMode="cover" />)}
            </ScrollView>
          ) : <Gradient colors={c.hero} style={{ flex: 1 }} />}
          <Gradient colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.35)']} diagonal={false} style={s.shade} />
          {b.photos.length > 1 && (
            <View style={s.dots}>
              {b.photos.map((u, i) => <View key={u} style={[s.dot, i === photo && s.dotOn]} />)}
            </View>
          )}
        </View>

        <View style={s.info}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={ty.tiny}>{pick(b.category_name, b.category_name_ru)}</Text>
            <Badge label={b.is_open_now ? t("Ochiq") : t("Yopiq")} tone={b.is_open_now ? 'success' : 'danger'} />
          </View>
          <Text style={[ty.h1, { marginTop: 6 }]}>{b.name}</Text>
          {b.branch_name && <Text style={[ty.h3, { color: c.accent }]}>{b.branch_name}</Text>}
          <View style={s.stats}>
            <View style={s.stat}>
              <Text style={s.statValue}>{b.rating_count > 0 ? `★ ${b.rating_avg.toFixed(1)}` : '—'}</Text>
              <Text style={ty.small}>{t("{a} ta sharh", { a: b.rating_count })}</Text>
            </View>
            <View style={s.statLine} />
            <View style={s.stat}>
              <Text style={s.statValue}>{b.staff.length}</Text>
              <Text style={ty.small}>{staffWord}</Text>
            </View>
            <View style={s.statLine} />
            <View style={s.stat}>
              <Text style={s.statValue} numberOfLines={1}>{minPrice !== null ? money(minPrice) : '—'}</Text>
              <Text style={ty.small}>{t("dan boshlab")}</Text>
            </View>
          </View>
          {b.address && (
            <Pressable style={s.addr} onPress={() => setTab('info')} accessibilityRole="button">
              <Icon name="location-outline" size={17} color={c.muted} />
              <Text style={[ty.small, { flex: 1 }]} numberOfLines={2}>{b.address}</Text>
            </Pressable>
          )}
          {b.description && <Text style={[ty.body, { color: c.muted, marginTop: 10, lineHeight: 21 }]}>{b.description}</Text>}
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <Segments value={tab} onChange={setTab} options={[
            { id: 'services', label: kind === 'pharmacy' ? t("Katalog") : t("Xizmatlar") },
            { id: 'staff', label: staffWord },
            { id: 'reviews', label: t("Sharhlar") },
            { id: 'info', label: t("Ma'lumot") },
          ]} />
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          {tab === 'services' && (
            <>
              {kind === 'pharmacy' && <PharmacyCatalog slug={b.slug} />}
              {b.service_groups.map((g) => (
                <View key={g.category_id ?? 0} style={{ marginTop: 8 }}>
                  <Text style={[ty.caps, { marginBottom: 8 }]}>{pick(g.category_name, g.category_name_ru)}</Text>
                  {g.services.map((sv) => (
                    <Pressy key={sv.id} onPress={() => canBook && book(sv)} disabled={!canBook} style={s.service} accessibilityRole="button"
                      accessibilityLabel={`${pick(sv.name, sv.name_ru)}, ${sv.duration_min} ${t("daq")}, ${money(sv.price)}`}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={ty.h3}>{pick(sv.name, sv.name_ru)}</Text>
                        <Text style={ty.small}>{t("{a} daq", { a: sv.duration_min })}{sv.description ? ` · ${sv.description}` : ''}</Text>
                      </View>
                      <Text style={s.price}>{money(sv.price)}</Text>
                      {canBook && <View style={s.add}><Icon name="add" size={20} color={c.accent} /></View>}
                    </Pressy>
                  ))}
                </View>
              ))}
            </>
          )}

          {tab === 'staff' && b.staff.map((m) => (
            <Pressy key={m.member_id} onPress={() => canBook && book(undefined, m.member_id)} style={s.service} accessibilityRole="button">
              <Avatar name={m.full_name} photo={m.photo_url} size={54} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={ty.h3}>{m.full_name}</Text>
                <Text style={ty.small}>{[m.title ? t(m.title) : null, m.rating_count > 0 ? `★ ${m.rating_avg.toFixed(1)} (${m.rating_count})` : t("Yangi")].filter(Boolean).join(' · ')}</Text>
                {m.bio && <Text style={ty.small} numberOfLines={2}>{m.bio}</Text>}
              </View>
              {canBook && <Text style={ty.link}>{t("Yozilish")}</Text>}
            </Pressy>
          ))}

          {tab === 'reviews' && <BusinessReviews slug={b.slug} staffWord={kind === 'clinic' ? t("Shifokor") : kind === 'pharmacy' ? t("Farmatsevt") : t("Usta")} />}

          {tab === 'info' && (
            <View style={{ gap: 12 }}>
              {(b.hours?.length ?? 0) > 0 && (
                <View style={s.box}>
                  <Text style={[ty.h3, { marginBottom: 8 }]}>{t("Ish vaqti")}</Text>
                  {WEEK.map((day, i) => {
                    const h = b.hours!.find((x) => x.weekday === i + 1);
                    return (
                      <View key={day} style={s.hourRow}>
                        <Text style={ty.body}>{day}</Text>
                        <Text style={[ty.body, { fontWeight: '700', color: h ? c.text : c.danger }]}>
                          {h ? `${h.opens_at.slice(0, 5)} – ${h.closes_at.slice(0, 5)}` : t("Dam olish")}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {b.phone && <View style={{ flex: 1 }}><Button title={t("Qo'ng'iroq")} icon="call-outline" kind="soft" compact onPress={() => Linking.openURL(`tel:${b.phone}`)} /></View>}
                {b.lat != null && b.lng != null && (
                  <View style={{ flex: 1 }}>
                    <Button title={t("Yo'nalish")} icon="navigate-outline" kind="soft" compact
                      onPress={() => Linking.openURL(`geo:${b.lat},${b.lng}?q=${b.lat},${b.lng}(${encodeURIComponent(b.name)})`).catch(() =>
                        Linking.openURL(`https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=17/${b.lat}/${b.lng}`))} />
                  </View>
                )}
              </View>
              {branches.length > 0 && (
                <View style={s.box}>
                  <Text style={ty.h3}>{t("Boshqa filiallar ({a})", { a: branches.length })}</Text>
                  <Text style={[ty.small, { marginBottom: 6 }]}>{t("O'zingizga qulay filialni tanlang — bron o'sha filialga bo'ladi")}</Text>
                  {branches.map((br) => (
                    <Pressable key={br.id} onPress={() => router.push(`/business/${br.slug}`)} style={s.branch} accessibilityRole="button">
                      <View style={{ flex: 1 }}>
                        <Text style={ty.h3} numberOfLines={1}>{br.branch_name ?? br.name}</Text>
                        <Text style={ty.small} numberOfLines={1}>{[distanceText(br.distance), br.address ?? br.city].filter(Boolean).join(' · ')}</Text>
                      </View>
                      <Badge label={br.is_open_now ? t("Ochiq") : t("Yopiq")} tone={br.is_open_now ? 'success' : 'danger'} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[s.topBar, { top: insets.top + 8 }]}>
        <GlassButton icon="chevron-back" label={t("Orqaga")} onPress={() => router.back()} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GlassButton icon="share-outline" label={t("Ulashish")}
            onPress={() => { void Share.share({ message: `${b.name}${b.address ? `, ${b.address}` : ""} — Chronix ilovasida onlayn yozilish: https://chronix.uz` }); }} />
          <GlassButton icon={fav ? 'heart' : 'heart-outline'} color={fav ? '#FF4D6D' : '#FFFFFF'}
            label={fav ? t("Sevimlilardan olib tashlash") : t("Sevimlilarga qo'shish")} onPress={() => favorites.toggle(b.id)} />
        </View>
      </View>

      {canBook && (
        <Glass style={[s.bookBar, { paddingBottom: bottom }]} intensity={50}>
          <View style={{ flex: 1 }}>
            <Text style={ty.small}>{t("Narx")}</Text>
            <Text style={s.barPrice}>{minPrice !== null ? t("{a}dan", { a: money(minPrice) }) : '—'}</Text>
          </View>
          <View style={{ flex: 1.3 }}><Button title={t("Bron qilish")} onPress={() => book()} /></View>
        </Glass>
      )}
    </View>
  );
}

function GlassButton({ icon, label, onPress, color = '#FFFFFF' }: { icon: 'chevron-back' | 'share-outline' | 'heart' | 'heart-outline'; label: string; onPress: () => void; color?: string }) {
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.9}>
      <Glass style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderColor: 'rgba(255,255,255,0.35)' }}
        intensity={30} tint="rgba(255,255,255,0.22)">
        <Icon name={icon} size={21} color={color} />
      </Glass>
    </Pressy>
  );
}

const useStyles = makeStyles((c) => ({
  shade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dots: { position: 'absolute', bottom: 40, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { width: 18, backgroundColor: '#FFFFFF' },
  info: {
    marginTop: -28, marginHorizontal: 12, padding: 18, borderRadius: 26, backgroundColor: c.surface, borderWidth: 1,
    borderColor: c.line, shadowColor: c.shadow, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: c.surface2 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  statValue: { fontSize: 16, fontWeight: '800', color: c.text },
  statLine: { width: 1, height: 28, backgroundColor: c.line },
  addr: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  service: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10, borderRadius: 20,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  price: { fontSize: 15, fontWeight: '800', color: c.text },
  add: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  box: { padding: 16, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  branch: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  bookBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18,
    paddingTop: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 0, borderTopWidth: 1,
  },
  barPrice: { fontSize: 18, fontWeight: '800', color: c.text },
}));
