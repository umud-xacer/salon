// Muassasa kartalari (Figma "Salon card" va "Nearby item").
// Katta: rasm (yorliq bilan), nomi va reyting, masofa · manzil. Kichik: chapda rasm, o'ngda nomi va masofa.
import { Image, Text, View } from 'react-native';

import { BusinessCard } from './api';
import { pick, t } from './i18n';
import { Gradient, Icon, makeStyles, Pressy, useTheme } from './ui';

export const distanceText = (m: number | null) => {
  if (m === null) return null;
  return m < 1000 ? `${m} m` : t("{a} km", { a: (m / 1000).toFixed(1).replace('.', ',') });
};

function Photo({ b, style }: { b: BusinessCard; style: object }) {
  const { c } = useTheme();
  return b.photos?.[0]
    ? <Image source={{ uri: b.photos[0] }} style={style} resizeMode="cover" />
    : <Gradient colors={c.hero} style={style} />;
}

/** Katta karta (Tavsiya etilganlar, O'xshash salonlar, qidiruv ro'yxati) */
export function SalonCardBig({ item: b, onOpen, badge, width }: {
  item: BusinessCard; onOpen: () => void; badge?: string | null; width?: number;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const meta = [distanceText(b.distance_m), b.address ?? b.city].filter(Boolean).join(' · ');
  return (
    <Pressy onPress={onOpen} style={[s.big, width ? { width } : null]} accessibilityRole="button"
      accessibilityLabel={[b.name, meta].filter(Boolean).join(', ')}>
      <View>
        <Photo b={b} style={s.bigImg} />
        {badge && (
          <View style={s.badge}>
            <Icon name="trophy-outline" size={15} color={c.accent} />
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <View style={s.row}>
        <Text style={s.bigName} numberOfLines={1}>
          {b.name}{b.branch_name ? ` · ${b.branch_name}` : ''}
        </Text>
        {b.rating_count > 0 && (
          <View style={s.rating}>
            <Icon name="star" size={17} color={c.star} />
            <Text style={s.ratingText}>{b.rating_avg.toFixed(1).replace('.', ',')}</Text>
          </View>
        )}
      </View>
      <Text style={s.meta} numberOfLines={1}>{meta}</Text>
      <Text style={s.meta} numberOfLines={1}>
        {pick(b.category_name, b.category_name_ru)}
        {b.rating_count > 0 ? ` · ${t("{a} ta sharh", { a: b.rating_count })}` : ` · ${t("Yangi")}`}
        {!b.is_open_now ? ` · ${t("Yopiq")}` : ''}
      </Text>
    </Pressy>
  );
}

/** Kichik qator (Yaqin atrofda) */
export function SalonCard({ item: b, onOpen }: {
  item: BusinessCard; onOpen: () => void; favorite?: boolean; onToggleFavorite?: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const meta = [distanceText(b.distance_m), b.address ?? b.city].filter(Boolean).join(' · ');
  return (
    <Pressy onPress={onOpen} style={s.small} accessibilityRole="button" accessibilityLabel={[b.name, meta].join(', ')}>
      <Photo b={b} style={s.smallImg} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={s.smallName} numberOfLines={1}>{b.name}</Text>
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {b.rating_count > 0 ? (
            <>
              <Icon name="star" size={13} color={c.star} />
              <Text style={s.smallRating}>{b.rating_avg.toFixed(1).replace('.', ',')}</Text>
              <Text style={s.meta}>({b.rating_count})</Text>
            </>
          ) : <Text style={s.meta}>{pick(b.category_name, b.category_name_ru)}</Text>}
          {!b.is_open_now && <Text style={[s.meta, { color: c.danger }]}> · {t("Yopiq")}</Text>}
        </View>
      </View>
    </Pressy>
  );
}

const useStyles = makeStyles((c) => ({
  big: { gap: 4 },
  bigImg: { width: '100%', height: 200, borderRadius: 16, backgroundColor: c.surface2 },
  badge: {
    position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#FFFFFF',
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#111114' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  bigName: { flex: 1, fontSize: 17, fontWeight: '700', color: c.text },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 16, fontWeight: '600', color: c.text },
  meta: { fontSize: 13, color: c.muted },
  small: {
    flexDirection: 'row', alignItems: 'center', gap: 16, padding: 1, paddingRight: 14, borderRadius: 16, borderWidth: 1,
    borderColor: c.line, backgroundColor: c.bg, marginBottom: 12,
  },
  smallImg: { width: 100, height: 92, borderTopLeftRadius: 15, borderBottomLeftRadius: 15, backgroundColor: c.surface2 },
  smallName: { fontSize: 16, fontWeight: '700', color: c.text },
  smallRating: { fontSize: 13, fontWeight: '600', color: c.text },
}));
