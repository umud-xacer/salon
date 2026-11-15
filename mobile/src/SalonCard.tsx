// Muassasa kartalari — Fresha ko'rinishi.
// Katta: rasm (chapda yorliq, o'ngda yurakcha), nomi va ★ reyting, masofa · manzil, yo'nalish · N ta sharh.
// Qator (Yaqin atrofdagi muassasalar): chapda katta rasm, o'ngda nomi va masofa · manzil, yurakcha.
import { Image, Pressable, Text, View } from 'react-native';

import { BusinessCard } from './api';
import { useFavorites } from './favorites';
import { pick, t } from './i18n';
import { Icon, IconName, makeStyles, Pressy, useTheme } from './ui';

export const distanceText = (m: number | null) => {
  if (m === null) return null;
  if (m > 50000) return t(">50 km");
  return m < 1000 ? `${m} m` : t("{a} km", { a: (m / 1000).toFixed(1).replace('.', ',') });
};

const reviews = (n: number) => t("{a} ta sharh", { a: n.toLocaleString('ru-RU').replace(/[, ]/g, ' ') });

function Photo({ b, style }: { b: BusinessCard; style: object }) {
  const { c } = useTheme();
  return b.photos?.[0]
    ? <Image source={{ uri: b.photos[0] }} style={style} resizeMode="cover" />
    : (
      <View style={[style, { backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name="storefront-outline" size={36} color={c.off} />
      </View>
    );
}

function Heart({ id, style }: { id: number; style: object }) {
  const favorites = useFavorites();
  const on = favorites.has(id);
  return (
    <Pressable onPress={() => favorites.toggle(id)} hitSlop={8} style={style} accessibilityRole="button"
      accessibilityLabel={on ? t("Sevimlilardan olib tashlash") : t("Sevimlilarga qo'shish")}>
      <Icon name={on ? 'heart' : 'heart-outline'} size={22} color={on ? '#E0245E' : '#FFFFFF'} />
    </Pressable>
  );
}

/** Katta karta (Tavsiya etilganlar, Yaqinda ko'rilganlar, Yangi, O'xshash salonlar, qidiruv) */
export function SalonCardBig({ item: b, onOpen, badge, badgeIcon, width }: {
  item: BusinessCard; onOpen: () => void; badge?: string | null; badgeIcon?: IconName; width?: number;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const meta = [distanceText(b.distance_m), b.address ?? b.city].filter(Boolean).join(' · ');
  const line3 = [pick(b.category_name, b.category_name_ru), b.rating_count > 0 ? reviews(b.rating_count) : t("Yangi")].join(' · ');
  return (
    <Pressy onPress={onOpen} style={[s.big, width ? { width } : null]} accessibilityRole="button"
      accessibilityLabel={[b.name, meta, line3].filter(Boolean).join(', ')} scaleTo={0.98}>
      <View>
        <Photo b={b} style={s.bigImg} />
        {badge && (
          <View style={s.badge}>
            {badgeIcon && <Icon name={badgeIcon} size={16} color={c.accent} />}
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        )}
        <Heart id={b.id} style={s.heart} />
      </View>
      <View style={s.row}>
        <Text style={s.bigName} numberOfLines={1}>{b.name}{b.branch_name ? ` · ${b.branch_name}` : ''}</Text>
        {b.rating_count > 0 && (
          <View style={s.rating}>
            <Icon name="star" size={18} color={c.star} />
            <Text style={s.ratingText}>{b.rating_avg.toFixed(1).replace('.', ',')}</Text>
          </View>
        )}
      </View>
      <Text style={s.meta} numberOfLines={1}>{meta}</Text>
      <Text style={s.meta} numberOfLines={1}>{line3}</Text>
    </Pressy>
  );
}

/** Qator (Yaqin atrofdagi muassasalar, sevimlilar) */
export function SalonCard({ item: b, onOpen }: {
  item: BusinessCard; onOpen: () => void; favorite?: boolean; onToggleFavorite?: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const favorites = useFavorites();
  const on = favorites.has(b.id);
  const meta = [distanceText(b.distance_m), b.address ?? b.city].filter(Boolean).join(' · ');
  return (
    <Pressy onPress={onOpen} style={s.small} accessibilityRole="button" accessibilityLabel={[b.name, meta].join(', ')} scaleTo={0.98}>
      <Photo b={b} style={s.smallImg} />
      <View style={{ flex: 1, minWidth: 0, gap: 6, paddingVertical: 14, paddingRight: 8 }}>
        <Text style={s.smallName} numberOfLines={2}>{b.name}</Text>
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
        {b.rating_count > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="star" size={14} color={c.star} />
            <Text style={s.smallRating}>{b.rating_avg.toFixed(1).replace('.', ',')}</Text>
            <Text style={s.meta}>({b.rating_count})</Text>
          </View>
        )}
      </View>
      <Pressable onPress={() => favorites.toggle(b.id)} hitSlop={10} style={s.smallHeart} accessibilityRole="button"
        accessibilityLabel={on ? t("Sevimlilardan olib tashlash") : t("Sevimlilarga qo'shish")}>
        <Icon name={on ? 'heart' : 'heart-outline'} size={20} color={on ? '#E0245E' : c.muted} />
      </Pressable>
    </Pressy>
  );
}

const useStyles = makeStyles((c) => ({
  big: { gap: 3 },
  bigImg: { width: '100%', height: 190, borderRadius: 18, backgroundColor: c.surface2 },
  badge: {
    position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.95)',
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#111114' },
  heart: {
    position: 'absolute', right: 12, top: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(17,17,20,0.28)',
    alignItems: 'center', justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  bigName: { flex: 1, fontSize: 17, fontWeight: '700', color: c.text },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 16, fontWeight: '600', color: c.text },
  meta: { fontSize: 14, color: c.muted },
  small: {
    flexDirection: 'row', alignItems: 'stretch', gap: 16, borderRadius: 18, borderWidth: 1, borderColor: c.line,
    backgroundColor: c.bg, marginBottom: 12, overflow: 'hidden', minHeight: 120,
  },
  smallImg: { width: 120, minHeight: 120, backgroundColor: c.surface2 },
  smallName: { fontSize: 17, fontWeight: '700', color: c.text },
  smallRating: { fontSize: 13, fontWeight: '600', color: c.text },
  smallHeart: { paddingTop: 12, paddingRight: 12 },
}));
