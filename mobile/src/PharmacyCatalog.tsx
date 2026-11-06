// Dorixona katalogi: qidiruv (nom yoki shtrix-kod), kategoriyalar, narx va holat (bor / kam qoldi / tugagan).
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, ApiError } from './api';
import { Chip, colors, ErrorText, Icon, money, radius, shared, type } from './ui';

import { t } from "./i18n";
type Product = { id: number; name: string; category: string | null; unit: string; price: number; stock: 'in' | 'low' | 'out' };
type Catalog = { items: Product[]; categories: { category: string; count: number }[] };

const STOCK = {
  in: { label: t("Bor"), color: colors.success, bg: colors.successSoft },
  low: { label: t("Kam qoldi"), color: colors.warning, bg: '#FFF4E0' },
  out: { label: t("Tugagan"), color: colors.danger, bg: colors.dangerSoft },
} as const;

export function PharmacyCatalog({ slug }: { slug: string }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [data, setData] = useState<Catalog | null>(null);
  const [categories, setCategories] = useState<Catalog['categories']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      setLoading(true);
      api<Catalog>(`/catalog/businesses/${slug}/products?${params}`)
        .then((d) => {
          setData(d);
          if (!q.trim() && !category) setCategories(d.categories);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : t("Katalogni yuklab bo'lmadi")))
        .finally(() => setLoading(false));
    }, 300);                                        // har harfda so'rov yubormaslik uchun
    return () => clearTimeout(timer.current);
  }, [slug, q, category]);

  return (
    <View>
      <Text style={shared.heading}>{t("Dorilar va tibbiy buyumlar")}</Text>
      <View style={styles.search}>
        <Icon name="search-outline" size={18} color={colors.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t("Dori nomi yoki shtrix-kod")} placeholderTextColor={colors.muted}
          style={styles.input} autoCorrect={false} returnKeyType="search" accessibilityLabel={t("Dori qidirish")} />
      </View>
      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          <Chip label={t("Hammasi")} active={category === null} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip key={c.category} label={`${c.category} (${c.count})`} active={category === c.category}
              onPress={() => setCategory(category === c.category ? null : c.category)} />
          ))}
        </ScrollView>
      )}
      <ErrorText text={error} />
      {loading && !data && <ActivityIndicator style={{ marginTop: 12 }} />}
      {data && data.items.length === 0 && (
        <Text style={[shared.muted, { marginVertical: 12 }]}>{q || category ? t("Hech narsa topilmadi") : t("Katalog hali bo'sh")}</Text>
      )}
      {data?.items.map((p) => {
        const s = STOCK[p.stock];
        return (
          <View key={p.id} style={[styles.row, p.stock === 'out' && { opacity: 0.6 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{p.name}</Text>
              {p.category && <Text style={type.small}>{p.category}</Text>}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[type.body, { fontWeight: '700' }]}>{money(p.price)}</Text>
              <Text style={[styles.badge, { color: s.color, backgroundColor: s.bg }]}>{s.label}</Text>
            </View>
          </View>
        );
      })}
      <Text style={[type.small, { marginTop: 8 }]}>{t("Narx va mavjudlik dorixona ma'lumoti. Aniqlash uchun qo'ng'iroq qiling.")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, marginBottom: 10,
  },
  input: { flex: 1, paddingVertical: 10, fontSize: 15, color: colors.text },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: radius.md,
    padding: 12, marginBottom: 8,
  },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
});
