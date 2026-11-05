// Yulduzchalar (ko'rsatish va tanlash) va salon sahifasidagi baholar bo'limi.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api, PublicReview, ReviewsOut } from './api';
import { Button, Card, colors, dayOf, Icon, shared, type } from './ui';

export function StarsView({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  const v = Math.round(value ?? 0);
  return (
    <View style={{ flexDirection: 'row', gap: 1 }} accessibilityLabel={`${value ? value.toFixed(1) : 0} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name={i <= v ? 'star' : 'star-outline'} size={size} color={i <= v ? colors.star : colors.muted} />
      ))}
    </View>
  );
}

// Katta, bosiladigan yulduzchalar (barmoq uchun kamida 40px)
export function StarsInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const WORDS = ['', 'Juda yomon', 'Yomon', "O'rtacha", 'Yaxshi', "A'lo"];
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={type.h3}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable key={i} onPress={() => onChange(i)} hitSlop={4} style={styles.starBtn}
            accessibilityRole="button" accessibilityLabel={`${label}: ${i} yulduz`} accessibilityState={{ selected: value === i }}>
            <Icon name={i <= value ? 'star' : 'star-outline'} size={34} color={i <= value ? colors.star : colors.muted} />
          </Pressable>
        ))}
        <Text style={[shared.muted, { marginLeft: 8 }]}>{WORDS[value]}</Text>
      </View>
    </View>
  );
}

export function BusinessReviews({ slug, staffWord }: { slug: string; staffWord: string }) {
  const [data, setData] = useState<ReviewsOut | null>(null);
  const [more, setMore] = useState<PublicReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<ReviewsOut>(`/catalog/businesses/${slug}/reviews?limit=5`).then(setData).catch(() => {});
  }, [slug]);

  if (!data || data.summary.count === 0) return null;
  const s = data.summary;
  const items = [...data.items, ...more];

  const loadMore = async () => {
    setBusy(true);
    try {
      const next = await api<ReviewsOut>(`/catalog/businesses/${slug}/reviews?limit=10&offset=${items.length}`);
      setMore((m) => [...m, ...next.items]);
      if (next.items.length < 10) setDone(true);
    } catch {
      // keyingi bosishda
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={shared.heading}>Baholar</Text>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontSize: 34, fontWeight: '800', color: colors.text }}>{s.rating_avg?.toFixed(1)}</Text>
          <View>
            <StarsView value={s.rating_avg} size={18} />
            <Text style={shared.muted}>{s.count} ta baho</Text>
          </View>
        </View>
        <Text style={[shared.muted, { marginTop: 8 }]}>
          Tozalik {s.cleanliness_avg?.toFixed(1) ?? '—'} · Qabul va xizmat {s.quality_avg?.toFixed(1) ?? '—'}
        </Text>
        <Text style={[type.small, { marginTop: 4, color: colors.muted }]}>Faqat xizmatdan foydalangan mijozlar baho qo'ya oladi</Text>
      </Card>
      {items.map((r) => (
        <Card key={r.id}>
          <View style={shared.row}>
            <Text style={[type.h3, { flex: 1 }]}>{r.author}</Text>
            <Text style={shared.muted}>{dayOf(r.created_at).split('-').reverse().join('.')}</Text>
          </View>
          <View style={{ marginTop: 4 }}><StarsView value={r.rating} /></View>
          {r.comment && <Text style={[type.body, { marginTop: 6 }]}>{r.comment}</Text>}
          {r.staff_rating != null && r.member_name && (
            <View style={styles.staff}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={shared.muted}>{staffWord}: {r.member_name}</Text>
                <StarsView value={r.staff_rating} size={12} />
              </View>
              {r.staff_comment && <Text style={[type.body, { marginTop: 4 }]}>{r.staff_comment}</Text>}
            </View>
          )}
          {r.reply && (
            <View style={styles.reply}>
              <Text style={[type.small, { fontWeight: '700' }]}>Muassasa javobi</Text>
              <Text style={[type.body, { marginTop: 2 }]}>{r.reply}</Text>
            </View>
          )}
        </Card>
      ))}
      {!done && items.length < s.count && (
        <Button title="Yana baholar" kind="outline" compact busy={busy} onPress={loadMore} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  starBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  staff: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: colors.background },
  reply: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: colors.primary },
});
