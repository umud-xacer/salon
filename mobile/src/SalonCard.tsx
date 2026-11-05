// Ixcham salon kartochkasi: chapda kichik rasm, o'ngda ma'lumot. Butun kartochka bosiladi.
// Bitta ekranga ~5–6 ta salon sig'adi (avval 2 ta).
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { BusinessCard } from './api';
import { colors, Icon, money, radius, shadow, type } from './ui';

const PHOTO = 84;

export const distanceText = (m: number | null) => {
  if (m === null) return null;
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
};

export function SalonCard({ item: b, favorite, onToggleFavorite, onOpen }: {
  item: BusinessCard;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: () => void;
}) {
  const meta = [b.category_name, distanceText(b.distance_m) ?? b.city].filter(Boolean).join(' · ');
  const photo = b.photos?.[0];

  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button" accessibilityLabel={`${b.name}, ${meta}`}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={[styles.photo, styles.placeholder]}>
          <Icon name="storefront-outline" size={30} color="rgba(255,255,255,0.8)" />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={[type.h3, styles.name]} numberOfLines={1}>{b.name}</Text>
          <Pressable onPress={onToggleFavorite} hitSlop={10} style={styles.heart}
            accessibilityLabel={favorite ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga qo\'shish'}>
            <Icon name={favorite ? 'heart' : 'heart-outline'} size={19} color={favorite ? colors.danger : colors.muted} />
          </Pressable>
        </View>

        <Text style={type.small} numberOfLines={1}>{meta}</Text>

        <View style={[styles.row, { marginTop: 6 }]}>
          <View style={styles.rating}>
            {b.rating_count > 0 ? (
              <>
                <Icon name="star" size={13} color={colors.star} />
                <Text style={styles.ratingText}>{b.rating_avg.toFixed(1)}</Text>
                <Text style={type.small}>({b.rating_count})</Text>
              </>
            ) : <Text style={type.small}>Yangi</Text>}
          </View>
          <View style={[styles.badge, { backgroundColor: b.is_open_now ? colors.successSoft : colors.dangerSoft }]}>
            <Text style={[styles.badgeText, { color: b.is_open_now ? colors.success : colors.danger }]}>
              {b.is_open_now ? 'Ochiq' : 'Yopiq'}
            </Text>
          </View>
        </View>

        {b.min_price !== null && (
          <Text style={styles.price} numberOfLines={1}>
            {money(b.min_price)}dan{b.top_service ? <Text style={type.small}>{`  ·  ${b.top_service}`}</Text> : null}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', gap: 12, padding: 10, backgroundColor: colors.card, borderRadius: radius.md,
    marginBottom: 8, ...shadow,
  },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radius.sm, backgroundColor: colors.line },
  placeholder: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 15 },
  heart: { padding: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontWeight: '700', color: colors.text, fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  badgeText: { fontSize: 11, fontWeight: '700' },
  price: { marginTop: 4, fontWeight: '700', color: colors.text, fontSize: 13 },
});
