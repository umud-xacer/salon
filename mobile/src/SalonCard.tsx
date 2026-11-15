// Ixcham muassasa kartasi (prototip "Yaqin atrofda"): chapda rasm va masofa, o'ngda ma'lumot. Butun karta bosiladi.
import { Image, Pressable, Text, View } from 'react-native';

import { BusinessCard } from './api';
import { pick, t } from './i18n';
import { Badge, Gradient, Icon, makeStyles, money, Pressy, useTheme } from './ui';

const PHOTO = 92;

export const distanceText = (m: number | null) => {
  if (m === null) return null;
  return m < 1000 ? `${m} m` : t("{a} km", { a: (m / 1000).toFixed(1) });
};

export function SalonCard({ item: b, favorite, onToggleFavorite, onOpen }: {
  item: BusinessCard;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const kind = pick(b.category_name, b.category_name_ru);
  const distance = distanceText(b.distance_m);
  const photo = b.photos?.[0];

  return (
    <Pressy onPress={onOpen} style={s.card} accessibilityRole="button"
      accessibilityLabel={[b.name, kind, distance].filter(Boolean).join(', ')}>
      <View style={s.photo}>
        {photo
          ? <Image source={{ uri: photo }} style={s.photoImg} resizeMode="cover" />
          : (
            <Gradient colors={c.avatar} style={[s.photoImg, { alignItems: 'center', justifyContent: 'center' }]}>
              <Icon name="storefront-outline" size={30} color="rgba(255,255,255,0.85)" />
            </Gradient>
          )}
        {distance && <View style={s.km}><Text style={s.kmText}>{distance}</Text></View>}
      </View>

      <View style={s.body}>
        <View style={s.row}>
          <Text style={s.kind} numberOfLines={1}>{kind}</Text>
          <Pressable onPress={onToggleFavorite} hitSlop={12}
            accessibilityLabel={favorite ? t("Sevimlilardan olib tashlash") : t("Sevimlilarga qo'shish")}>
            <Icon name={favorite ? 'heart' : 'heart-outline'} size={19} color={favorite ? '#E0245E' : c.muted} />
          </Pressable>
        </View>
        <Text style={s.name} numberOfLines={1}>
          {b.name}{b.branch_name ? <Text style={s.branch}>{` · ${b.branch_name}`}</Text> : null}
        </Text>
        <View style={s.meta}>
          {b.rating_count > 0 ? (
            <>
              <Text style={[s.metaText, { color: c.star, fontWeight: '800' }]}>★ {b.rating_avg.toFixed(1)}</Text>
              <Text style={s.metaText}>({b.rating_count})</Text>
            </>
          ) : <Text style={s.metaText}>{t("Yangi")}</Text>}
          {b.min_price !== null && <Text style={s.metaText} numberOfLines={1}>· {t("{a}dan", { a: money(b.min_price) })}</Text>}
        </View>
        <View style={[s.row, { marginTop: 'auto' }]}>
          <Badge label={b.is_open_now ? t("Ochiq") : t("Yopiq")} tone={b.is_open_now ? 'success' : 'danger'} />
          {(b.branch_count ?? 1) > 1 && (
            <Text style={s.chain} numberOfLines={1}>{t("{a} ta filial", { a: b.branch_count ?? 1 })}</Text>
          )}
          {b.top_service && (b.branch_count ?? 1) <= 1 && <Text style={s.top} numberOfLines={1}>{b.top_service}</Text>}
        </View>
      </View>
    </Pressy>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    flexDirection: 'row', gap: 12, padding: 10, backgroundColor: c.surface, borderRadius: 22, marginBottom: 10,
    borderWidth: 1, borderColor: c.line,
  },
  photo: { width: PHOTO, height: PHOTO },
  photoImg: { width: PHOTO, height: PHOTO, borderRadius: 16, backgroundColor: c.line },
  km: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' },
  kmText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  body: { flex: 1, minWidth: 0, gap: 3, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kind: { flex: 1, fontSize: 12, fontWeight: '600', color: c.muted },
  name: { fontSize: 16, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
  branch: { color: c.muted, fontWeight: '500' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 13, color: c.muted, flexShrink: 1 },
  chain: { fontSize: 12, color: c.accent, fontWeight: '700', flexShrink: 1 },
  top: { fontSize: 12, color: c.muted, flexShrink: 1, textAlign: 'right' },
}));
