import { useState } from 'react';
import { Dimensions, Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BusinessCard } from './api';
import { Button, colors, Icon, money, radius, shadow, type } from './ui';

const PHOTO_HEIGHT = 168;

export const distanceText = (m: number | null) => {
  if (m === null) return null;
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
};

function Photos({ urls, width, onPress }: { urls: string[]; width: number; onPress: () => void }) {
  const [index, setIndex] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  if (urls.length === 0) {
    return (
      <Pressable onPress={onPress} style={[styles.placeholder, { width }]}>
        <Icon name="storefront-outline" size={44} color="rgba(255,255,255,0.75)" />
      </Pressable>
    );
  }
  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll}>
        {urls.map((url) => (
          <Pressable key={url} onPress={onPress}>
            <Image source={{ uri: url }} style={{ width, height: PHOTO_HEIGHT }} resizeMode="cover" />
          </Pressable>
        ))}
      </ScrollView>
      {urls.length > 1 && (
        <View style={styles.dots}>
          {urls.map((url, i) => <View key={url} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
      )}
    </View>
  );
}

export function SalonCard({ item: b, favorite, onToggleFavorite, onOpen }: {
  item: BusinessCard;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: () => void;
}) {
  const width = Dimensions.get('window').width - 32;
  const place = [b.city, distanceText(b.distance_m)].filter(Boolean).join(', ');

  return (
    <View style={styles.card}>
      <View>
        <Photos urls={b.photos ?? []} width={width} onPress={onOpen} />
        <Pressable onPress={onToggleFavorite} style={styles.heart} hitSlop={8}
          accessibilityLabel={favorite ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga qo\'shish'}>
          <Icon name={favorite ? 'heart' : 'heart-outline'} size={20} color={favorite ? colors.danger : colors.text} />
        </Pressable>
        <View style={[styles.badge, { backgroundColor: b.is_open_now ? colors.successSoft : colors.dangerSoft }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: b.is_open_now ? colors.success : colors.danger }}>
            {b.is_open_now ? 'Ochiq' : 'Yopiq'}
          </Text>
        </View>
      </View>
      <Pressable onPress={onOpen} style={{ padding: 14 }}>
        <View style={styles.titleRow}>
          <Text style={[type.h3, { flex: 1 }]} numberOfLines={1}>{b.name}</Text>
          {b.rating_count > 0 ? (
            <View style={styles.rating}>
              <Icon name="star" size={14} color={colors.star} />
              <Text style={{ fontWeight: '700', color: colors.text }}>{b.rating_avg.toFixed(1)}</Text>
              <Text style={type.small}>({b.rating_count})</Text>
            </View>
          ) : <Text style={type.small}>Yangi</Text>}
        </View>
        <Text style={[type.small, { marginTop: 3 }]}>{b.category_name}</Text>
        {!!place && (
          <View style={styles.line}>
            <Icon name="location-outline" size={15} color={colors.muted} />
            <Text style={type.small} numberOfLines={1}>{place}</Text>
          </View>
        )}
        <View style={styles.footer}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            {b.min_price !== null && (
              <>
                {!!b.top_service && <Text style={type.small} numberOfLines={1}>{b.top_service}</Text>}
                <Text style={{ fontWeight: '700', color: colors.text }}>{money(b.min_price)}dan</Text>
              </>
            )}
          </View>
          <Button title="Bron qilish" compact onPress={onOpen} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, marginBottom: 14, overflow: 'hidden', ...shadow },
  placeholder: { height: PHOTO_HEIGHT, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  heart: {
    position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center', justifyContent: 'center',
  },
  badge: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  dots: { position: 'absolute', bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: '#fff' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
});
