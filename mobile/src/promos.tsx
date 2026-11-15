// Bosh sahifa aksiyalari: Hot Slots (bugungi chegirmali bo'sh vaqtlar), sovg'a promokod va tashriflar seriyasi.
// Ma'lumot bo'lmasa blok umuman ko'rinmaydi.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

import { api, HotSlot, MyLoyalty, Offer } from './api';
import { pick, t } from './i18n';
import { useMyLocation } from './location';
import { distanceText } from './SalonCard';
import { Gradient, Icon, makeStyles, money, Pressy, SectionHeader, useTheme } from './ui';

/** "HH:MM:SS" — mahalliy (Toshkent) vaqt bo'yicha bugun `until` gacha qolgan vaqt */
function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const [h, m] = until.split(':').map(Number);
  const local = new Date(now + 5 * 3600 * 1000);
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - 5 * 3600 * 1000;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`;
}

export function HotSlots({ refreshKey }: { refreshKey: number }) {
  const router = useRouter();
  const { coords } = useMyLocation();
  const { c } = useTheme();
  const s = useStyles();
  const [items, setItems] = useState<HotSlot[]>([]);

  useEffect(() => {
    const p = new URLSearchParams({ lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '15000' });
    api<HotSlot[]>(`/catalog/hot-slots?${p}`).then(setItems).catch(() => setItems([]));
  }, [coords, refreshKey]);

  const ends = items.length ? items.map((x) => x.ends_window.slice(0, 5)).sort()[0] : null;
  const countdown = useCountdown(ends);
  if (!items.length) return null;

  return (
    <View style={{ marginTop: 26 }}>
      <SectionHeader title={`🔥 ${t("Hot Slots")}`}
        sub={<>{t("Bugungi bo'sh vaqtlar chegirmada")}{countdown ? <Text style={{ color: c.hot, fontWeight: '800' }}>{` · ${countdown}`}</Text> : null}</>}
        style={{ paddingHorizontal: 16 }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingTop: 12 }}>
        {items.map((h) => (
          <Pressy key={`${h.business_id}-${h.service_id}`} style={s.hot} accessibilityRole="button"
            accessibilityLabel={t("{a}, {b}, {c} foiz chegirma", { a: pick(h.service_name, h.service_name_ru), b: h.time, c: h.percent })}
            onPress={() => router.push({ pathname: '/book', params: {
              slug: h.business_slug, serviceId: String(h.service_id), memberId: String(h.member_id), startsAt: h.starts_at,
            } })}>
            <View style={s.hotTop}>
              {h.photo
                ? <Image source={{ uri: h.photo }} style={s.fill} resizeMode="cover" />
                : <Gradient colors={c.perk} style={s.fill} />}
              <View style={s.hotBadges}>
                <View style={[s.pill, { backgroundColor: c.hot }]}><Text style={s.pillText}>−{h.percent}%</Text></View>
                <View style={[s.pill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}><Text style={s.pillText}>{h.time}</Text></View>
              </View>
            </View>
            <View style={{ padding: 12, gap: 3 }}>
              <Text style={s.title} numberOfLines={1}>{pick(h.service_name, h.service_name_ru)}</Text>
              <Text style={s.muted} numberOfLines={1}>{[h.business_name, distanceText(h.distance_m)].filter(Boolean).join(' · ')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6, marginTop: 3 }}>
                <Text style={s.price} numberOfLines={1}>{money(h.final)}</Text>
                <Text style={s.old} numberOfLines={1}>{money(h.price)}</Text>
              </View>
            </View>
          </Pressy>
        ))}
      </ScrollView>
    </View>
  );
}

export function Perks({ refreshKey }: { refreshKey: number }) {
  const router = useRouter();
  const { coords } = useMyLocation();
  const { c } = useTheme();
  const s = useStyles();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loyalty, setLoyalty] = useState<MyLoyalty | null>(null);

  useEffect(() => {
    const p = new URLSearchParams({ lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '15000' });
    api<Offer[]>(`/catalog/offers?${p}`).then((l) => setOffer(l[0] ?? null)).catch(() => setOffer(null));
    api<MyLoyalty[]>('/me/loyalty').then((l) => setLoyalty(l[0] ?? null)).catch(() => setLoyalty(null));
  }, [coords, refreshKey]);

  if (!offer && !loyalty) return null;
  const open = (slug: string) => router.push({ pathname: '/business/[slug]', params: { slug } });

  return (
    <View style={s.perks}>
      {offer && (
        <Pressy onPress={() => open(offer.business_slug)} style={{ flex: 1 }} accessibilityRole="button">
          <Gradient colors={c.perk} style={s.perk}>
            <View style={s.perkIcon}><Icon name="gift-outline" size={18} color="#FFFFFF" /></View>
            <Text style={s.perkLabel}>{t("Sizga sovg'a")} · {offer.business_name}</Text>
            <Text style={s.perkTitle} numberOfLines={2}>−{offer.percent}% {offer.title}</Text>
            <View style={s.codeBox}><Text style={s.code}>{offer.code}</Text></View>
          </Gradient>
        </Pressy>
      )}
      {loyalty && (
        <Pressy onPress={() => open(loyalty.business_slug)} style={[s.perk, s.loyal]} accessibilityRole="button">
          <Text style={s.muted} numberOfLines={1}>{t("Tashriflar seriyasi")} · {loyalty.business_name}</Text>
          <Text style={s.loyalTitle} numberOfLines={3}>
            {loyalty.ready
              ? t("Keyingi broningiz −{a}%", { a: loyalty.percent })
              : t("Yana {a} tashrif — −{b}%", { a: loyalty.required - loyalty.visits, b: loyalty.percent })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 'auto' }}>
            {Array.from({ length: loyalty.required }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: i < loyalty.visits ? c.accent : c.line }} />
            ))}
          </View>
        </Pressy>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  hot: { width: 200, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
  hotTop: { height: 96, backgroundColor: c.line },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hotBadges: { flexDirection: 'row', justifyContent: 'space-between', padding: 10 },
  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  pillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  title: { fontSize: 14, fontWeight: '800', color: c.text },
  muted: { fontSize: 12, color: c.muted, fontWeight: '600' },
  price: { fontSize: 16, fontWeight: '800', color: c.text },
  old: { fontSize: 12, color: c.muted, textDecorationLine: 'line-through' },
  perks: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 24 },
  perk: { flex: 1, minHeight: 132, borderRadius: 22, padding: 14, gap: 8 },
  perkIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  perkLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  perkTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', lineHeight: 20 },
  codeBox: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.7)' },
  code: { color: '#FFFFFF', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  loyal: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
  loyalTitle: { fontSize: 16, fontWeight: '800', color: c.text, lineHeight: 20 },
}));
