import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { api, BusinessCard } from '../src/api';
import { useFavorites } from '../src/favorites';
import { SalonCard } from '../src/SalonCard';
import { EmptyState, ErrorText, shared } from '../src/ui';

export default function Favorites() {
  const router = useRouter();
  const favorites = useFavorites();
  const [items, setItems] = useState<BusinessCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<BusinessCard[]>('/me/favorites'));
    } catch {
      setError('Yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const shown = items.filter((b) => favorites.has(b.id));

  return (
    <View style={shared.screen}>
      <ErrorText text={error} />
      <FlatList
        data={shown}
        keyExtractor={(b) => String(b.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : (
          <EmptyState icon="heart-outline" title="Sevimli salonlar yo'q" text="Yoqqan saloningizdagi yurakchani bosing"
            action="Salonlarni ko'rish" onAction={() => router.navigate('/')} />
        )}
        renderItem={({ item }) => (
          <SalonCard item={item} favorite onToggleFavorite={() => favorites.toggle(item.id)}
            onOpen={() => router.push({ pathname: '/business/[slug]', params: { slug: item.slug } })} />
        )}
      />
    </View>
  );
}
