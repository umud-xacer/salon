// "Bonuslarim": tashriflar seriyasi (sodiqlik) — har muassasada nechta tashrif qolgani va chegirma foizi,
// yaqin atrofdagi ochiq promokodlar va bugungi chegirmali vaqtlar (Hot Slots).
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { api, MyLoyalty, Offer } from '../src/api';
import { t } from '../src/i18n';
import { useMyLocation } from '../src/location';
import { HotSlots } from '../src/promos';
import { distanceText } from '../src/SalonCard';
import { EmptyState, ErrorText, Icon, makeStyles, Pressy, useBottomSpace, useTheme, useType } from '../src/ui';

export default function Bonuses() {
  const router = useRouter();
  const { coords } = useMyLocation();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const bottom = useBottomSpace(16);
  const [loyalty, setLoyalty] = useState<MyLoyalty[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ lat: String(coords.latitude), lng: String(coords.longitude), radius_m: '15000' });
    try {
      const [l, o] = await Promise.all([api<MyLoyalty[]>('/me/loyalty'), api<Offer[]>(`/catalog/offers?${p}`)]);
      setLoyalty(l);
      setOffers(o);
    } catch {
      setError(t("Yuklab bo'lmadi"));
    } finally {
      setLoading(false);
      setKey((k) => k + 1);
    }
  }, [coords]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const open = (slug: string) => router.push({ pathname: '/business/[slug]', params: { slug } });
  const ready = loyalty.filter((l) => l.ready).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.accent} />}>
      <ErrorText text={error} />

      {/* Umumiy holat */}
      <View style={[s.pad, { paddingTop: 16 }]}>
        <View style={s.hero}>
          <View style={s.heroIcon}><Icon name="ribbon-outline" size={22} color={c.accent} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ty.h3}>
              {ready > 0 ? t("{a} ta chegirma tayyor", { a: ready }) : t("Tashrif qiling — chegirma yig'ing")}
            </Text>
            <Text style={ty.small}>{t("Har bir yakunlangan tashrif seriyaga qo'shiladi. Seriya to'lganda keyingi bron avtomatik arzonlashadi.")}</Text>
          </View>
        </View>
      </View>

      {/* Tashriflar seriyasi */}
      <View style={[s.pad, { marginTop: 24, gap: 12 }]}>
        <Text style={ty.h2}>{t("Tashriflar seriyasi")}</Text>
        {loyalty.length === 0 && !loading && (
          <Text style={ty.small}>{t("Hozircha seriya yo'q. Sodiqlik dasturi bor muassasaga tashrif qilsangiz, shu yerda ko'rinadi.")}</Text>
        )}
        {loyalty.map((l) => (
          <Pressy key={l.business_id} onPress={() => open(l.business_slug)} style={[s.card, l.ready && s.cardReady]} accessibilityRole="button"
            accessibilityLabel={`${l.business_name}: ${l.visits} / ${l.required}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[ty.h3, { flex: 1 }]} numberOfLines={1}>{l.business_name}</Text>
              <View style={[s.badge, l.ready && { backgroundColor: c.accent }]}>
                <Text style={[s.badgeText, l.ready && { color: c.onAccent }]}>−{l.percent}%</Text>
              </View>
            </View>
            <Text style={ty.small}>
              {l.ready
                ? t("Keyingi broningiz −{a}% — avtomatik qo'llanadi", { a: l.percent })
                : t("Yana {a} tashrif — −{b}%", { a: l.required - l.visits, b: l.percent })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {Array.from({ length: l.required }, (_, i) => (
                <View key={i} style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: i < l.visits ? c.accent : c.line }} />
              ))}
            </View>
            <Text style={ty.tiny}>{t("{a} / {b} tashrif", { a: Math.min(l.visits, l.required), b: l.required })}</Text>
          </Pressy>
        ))}
      </View>

      {/* Promokodlar */}
      <View style={[s.pad, { marginTop: 26, gap: 12 }]}>
        <Text style={ty.h2}>{t("Promokodlar")}</Text>
        {offers.length === 0 && !loading && <Text style={ty.small}>{t("Yaqin atrofda ochiq promokod yo'q")}</Text>}
        {offers.map((o) => (
          <Pressy key={`${o.business_id}-${o.code}`} onPress={() => open(o.business_slug)} style={s.offer} accessibilityRole="button">
            <View style={s.heroIcon}><Icon name="gift-outline" size={20} color={c.accent} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={ty.h3} numberOfLines={1}>−{o.percent}% {o.title}</Text>
              <Text style={ty.small} numberOfLines={1}>{[o.business_name, distanceText(o.distance_m)].filter(Boolean).join(' · ')}</Text>
              <Text style={ty.tiny} numberOfLines={1}>
                {o.first_visit_only ? t("Birinchi tashrif uchun") : t("Bron qilishda kodni kiriting")}
                {o.valid_to ? ` · ${t("{a} gacha", { a: o.valid_to.slice(0, 10).split('-').reverse().join('.') })}` : ''}
              </Text>
            </View>
            <View style={s.codeBox}><Text style={s.code} selectable>{o.code}</Text></View>
          </Pressy>
        ))}
      </View>

      {/* Bugungi chegirmali vaqtlar */}
      <HotSlots refreshKey={key} />

      {!loading && !error && loyalty.length === 0 && offers.length === 0 && (
        <View style={{ marginTop: 12 }}>
          <EmptyState icon="pricetag-outline" title={t("Aksiyalarni kuzating")} text={t("Muassasalar chegirma qo'shganda shu yerda va salon sahifasida ko'rinadi")}
            action={t("Muassasalarni ko'rish")} onAction={() => router.navigate('/')} />
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  pad: { paddingHorizontal: 24 },
  hero: { flexDirection: 'row', gap: 14, padding: 16, borderRadius: 20, backgroundColor: c.accentSoft },
  heroIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg },
  cardReady: { borderColor: c.accent },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.accentSoft },
  badgeText: { color: c.accent, fontWeight: '700', fontSize: 13 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: c.line },
  codeBox: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: c.accent },
  code: { color: c.accent, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
}));
