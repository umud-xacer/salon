import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { api, ApiError, BusinessDetail, Service } from '../../src/api';
import { PharmacyCatalog } from '../../src/PharmacyCatalog';
import { BusinessReviews } from '../../src/Reviews';
import { useFavorites } from '../../src/favorites';
import { Button, Card, Chip, colors, ErrorText, Icon, money, radius, shared, type } from '../../src/ui';

import { pick, t } from "../../src/i18n";
export default function Business() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const favorites = useFavorites();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BusinessDetail>(`/catalog/businesses/${slug}`)
      .then(setBusiness)
      .catch((e) => setError(e instanceof ApiError ? e.message : t("Yuklab bo'lmadi")));
  }, [slug]);

  if (error) return <ScrollView style={shared.screen}><ErrorText text={error} /></ScrollView>;
  if (!business) return <ActivityIndicator style={{ marginTop: 40 }} size="large" />;

  const kind = business.kind ?? 'salon';
  const masters = service ? business.staff.filter((s) => s.service_ids.includes(service.id)) : [];
  // Klinika: shifokorlar lavozimi (mutaxassisligi) bo'yicha guruh
  const specialties = [...new Set(business.staff.map((s) => s.title?.trim() || t("Umumiy amaliyot")))].sort();
  const doctors = business.staff.filter((s) => (s.title?.trim() || t("Umumiy amaliyot")) === specialty);
  const doctor = business.staff.find((s) => s.member_id === memberId);
  const allServices = business.service_groups.flatMap((g) => g.services);
  const doctorServices = doctor ? allServices.filter((sv) => doctor.service_ids.includes(sv.id)) : [];

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
          accessibilityLabel={favorites.has(business.id) ? t("Sevimlilardan olib tashlash") : t("Sevimlilarga qo'shish")}>
          <Icon name={favorites.has(business.id) ? 'heart' : 'heart-outline'} size={26}
            color={favorites.has(business.id) ? colors.danger : colors.text} />
        </Pressable>
      </View>
      <Text style={shared.muted}>
        {pick(business.category_name, business.category_name_ru)}{business.rating_count > 0 ? ` · ★ ${business.rating_avg.toFixed(1)} (${business.rating_count})` : ''}
      </Text>
      {business.address && <Text style={shared.muted}>{business.address}</Text>}
      {business.description && <Text style={[shared.muted, { marginTop: 8 }]}>{business.description}</Text>}

      {kind === 'pharmacy' && <PharmacyCatalog slug={business.slug} />}

      {kind === 'clinic' ? (
        <>
          {/* Klinika: mutaxassislik -> shifokor -> tibbiy xizmat -> vaqt */}
          <Text style={shared.heading}>{t("Mutaxassislikni tanlang")}</Text>
          {specialties.length === 0 && <Text style={shared.muted}>{t("Hozircha shifokorlar qo'shilmagan")}</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {specialties.map((tx) => (
              <Chip key={tx} label={`${t(tx)} · ${business.staff.filter((s) => (s.title?.trim() || t("Umumiy amaliyot")) === tx).length}`}
                active={specialty === tx}
                onPress={() => { setSpecialty(tx); setMemberId(null); setService(null); }} />
            ))}
          </View>
          {specialty && (
            <>
              <Text style={shared.heading}>{t("Shifokorni tanlang")}</Text>
              {doctors.map((d) => (
                <Chip key={d.member_id} label={d.rating_avg > 0 ? `${d.full_name} · ★ ${d.rating_avg.toFixed(1)}` : d.full_name}
                  active={memberId === d.member_id} onPress={() => { setMemberId(d.member_id); setService(null); }} />
              ))}
            </>
          )}
          {doctor && (
            <>
              <Text style={shared.heading}>{t("Tibbiy xizmat")}</Text>
              {doctorServices.length === 0 && <Text style={shared.muted}>{t("Bu shifokorga hali xizmat biriktirilmagan")}</Text>}
              {/* Bo'limlar bo'yicha: terapevtik davolash, ortodontiya, jarrohlik... */}
              {business.service_groups.map((g) => {
                const list = g.services.filter((sv) => doctor.service_ids.includes(sv.id));
                if (list.length === 0) return null;
                return (
                  <Card key={g.category_id ?? 0}>
                    <Text style={shared.name}>{pick(g.category_name, g.category_name_ru)}</Text>
                    {list.map((sv) => (
                      <Chip key={sv.id} label={t("{a} · {b} daq · {c}", { a: pick(sv.name, sv.name_ru), b: sv.duration_min, c: money(sv.price) })}
                        active={service?.id === sv.id} onPress={() => setService(sv)} />
                    ))}
                  </Card>
                );
              })}
            </>
          )}
        </>
      ) : business.service_groups.length > 0 && (
        <>
      <Text style={shared.heading}>{kind === 'pharmacy' ? t("Xizmatlar") : t("Xizmatni tanlang")}</Text>
      {business.service_groups.map((group) => (
        <Card key={group.category_id ?? 0}>
          <Text style={shared.name}>{pick(group.category_name, group.category_name_ru)}</Text>
          {group.services.map((s) => (
            <Chip
              key={s.id}
              label={t("{a} · {b} daq · {c}", { a: pick(s.name, s.name_ru), b: s.duration_min, c: money(s.price) })}
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
          <Text style={shared.heading}>{kind === 'pharmacy' ? t("Farmatsevtni tanlang") : t("Ustani tanlang")}</Text>
          {masters.length === 0 && <Text style={shared.muted}>{t("Bu xizmat uchun mutaxassis yo'q")}</Text>}
          {masters.map((m) => (
            <Chip
              key={m.member_id}
              label={[m.full_name, m.title ? t(m.title) : null, m.rating_count > 0 ? `★ ${m.rating_avg.toFixed(1)} (${m.rating_count})` : null]
                .filter(Boolean).join(' · ')}
              active={memberId === m.member_id}
              onPress={() => setMemberId(m.member_id)}
            />
          ))}
        </>
      )}

        </>
      )}

      {service && memberId && (
        <Button
          title={t("Vaqt tanlash")}
          onPress={() => router.push({
            pathname: '/book',
            params: { memberId: String(memberId), serviceId: String(service.id) },
          })}
        />
      )}

      <BusinessReviews slug={business.slug} staffWord={kind === 'clinic' ? t("Shifokor") : kind === 'pharmacy' ? t("Farmatsevt") : t("Usta")} />
    </ScrollView>
  );
}
