import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError, BusinessDetail, Service } from '../../src/api';
import { useFavorites } from '../../src/favorites';
import { Button, Card, Chip, colors, ErrorText, Icon, money, radius, shared, type } from '../../src/ui';

export default function Business() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const favorites = useFavorites();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BusinessDetail>(`/catalog/businesses/${slug}`)
      .then(setBusiness)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Yuklab bo\'lmadi'));
  }, [slug]);

  if (error) return <ScrollView style={shared.screen}><ErrorText text={error} /></ScrollView>;
  if (!business) return <ActivityIndicator style={{ marginTop: 40 }} size="large" />;

  const masters = service ? business.staff.filter((s) => s.service_ids.includes(service.id)) : [];

  return (
    <ScrollView style={shared.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      {business.photos.length > 0 && (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          style={{ borderRadius: radius.lg, marginBottom: 14 }}>
          {business.photos.map((url) => (
            <Image key={url} source={{ uri: url }} resizeMode="cover"
              style={{ width: Dimensions.get('window').width - 32, height: 200 }} />
          ))}
        </ScrollView>
      )}
      <View style={shared.row}>
        <Text style={[type.h1, { flex: 1, paddingRight: 8 }]}>{business.name}</Text>
        <Pressable onPress={() => favorites.toggle(business.id)} hitSlop={10}
          accessibilityLabel={favorites.has(business.id) ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga qo\'shish'}>
          <Icon name={favorites.has(business.id) ? 'heart' : 'heart-outline'} size={26}
            color={favorites.has(business.id) ? colors.danger : colors.text} />
        </Pressable>
      </View>
      <Text style={shared.muted}>
        {business.category_name}{business.rating_count > 0 ? ` · ★ ${business.rating_avg.toFixed(1)} (${business.rating_count})` : ''}
      </Text>
      {business.address && <Text style={shared.muted}>{business.address}</Text>}
      {business.description && <Text style={[shared.muted, { marginTop: 8 }]}>{business.description}</Text>}

      <Text style={shared.heading}>Xizmatni tanlang</Text>
      {business.service_groups.map((group) => (
        <Card key={group.category_id ?? 0}>
          <Text style={shared.name}>{group.category_name}</Text>
          {group.services.map((s) => (
            <Chip
              key={s.id}
              label={`${s.name} · ${s.duration_min} daq · ${money(s.price)}`}
              active={service?.id === s.id}
              onPress={() => {
                setService(s);
                setMemberId(null);
              }}
            />
          ))}
        </Card>
      ))}

      {service && (
        <>
          <Text style={shared.heading}>Ustani tanlang</Text>
          {masters.length === 0 && <Text style={shared.muted}>Bu xizmat uchun usta yo'q</Text>}
          {masters.map((m) => (
            <Chip
              key={m.member_id}
              label={m.title ? `${m.full_name} · ${m.title}` : m.full_name}
              active={memberId === m.member_id}
              onPress={() => setMemberId(m.member_id)}
            />
          ))}
        </>
      )}

      {service && memberId && (
        <Button
          title="Vaqt tanlash"
          onPress={() => router.push({
            pathname: '/book',
            params: { memberId: String(memberId), serviceId: String(service.id) },
          })}
        />
      )}
    </ScrollView>
  );
}
