// Yulduzchalar (ko'rsatish va tanlash) va salon sahifasidagi baholar bo'limi.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api, PublicReview, ReviewsOut } from './api';
import { Button, dayOf, font, Icon, makeStyles, useShared, useTheme, useType } from './ui';

import { t } from "./i18n";
export function StarsView({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  const { c: colors } = useTheme();
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
  const WORDS = ['', t("Juda yomon"), t("Yomon"), t("O'rtacha"), t("Yaxshi"), t("A'lo")];
  const { c: colors } = useTheme();
  const shared = useShared();
  const type = useType();
  const styles = useStyles();
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={type.h3}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable key={i} onPress={() => onChange(i)} hitSlop={4} style={styles.starBtn}
            accessibilityRole="button" accessibilityLabel={t("{a}: {b} yulduz", { a: label, b: i })} accessibilityState={{ selected: value === i }}>
            <Icon name={i <= value ? 'star' : 'star-outline'} size={34} color={i <= value ? colors.star : colors.muted} />
          </Pressable>
        ))}
        <Text style={[shared.muted, { marginLeft: 8 }]}>{WORDS[value]}</Text>
      </View>
    </View>
  );
}

/** Salon sahifasidagi sharhlar (Figma 06): umumiy baho kartasi va mijozlar fikrlari */
export function BusinessReviews({ slug, staffWord }: { slug: string; staffWord: string }) {
  const { c: colors } = useTheme();
  const type = useType();
  const styles = useStyles();
  const [data, setData] = useState<ReviewsOut | null>(null);
  const [more, setMore] = useState<PublicReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<ReviewsOut>(`/catalog/businesses/${slug}/reviews?limit=5`).then(setData).catch(() => {});
  }, [slug]);

  if (!data) return null;
  const s = data.summary;
  if (s.count === 0) {
    return <Text style={[type.small, { marginTop: 4 }]}>{t("Hali sharh yo'q. Birinchi tashrifdan keyin mijozlar baho qo'yadi.")}</Text>;
  }
  const items = [...data.items, ...more];
  const avg = s.rating_avg ?? 0;
  const title = avg >= 4.8 ? t("Eng yaxshi salon") : avg >= 4.5 ? t("A'lo baholangan") : avg >= 4 ? t("Yaxshi baholangan") : t("Mijozlar bahosi");

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
    <View style={{ gap: 16 }}>
      <View style={styles.score}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Icon name="trophy-outline" size={30} color={colors.accent} />
          <Text style={styles.scoreValue}>{avg.toFixed(1).replace('.', ',')}</Text>
          <Icon name="trophy-outline" size={30} color={colors.accent} />
        </View>
        <Text style={styles.scoreTitle}>{title}</Text>
        <Text style={type.small}>{t("{a} ta mijoz sharhi asosida", { a: s.count })}</Text>
        {(s.cleanliness_avg || s.quality_avg) && (
          <Text style={[type.small, { marginTop: 4 }]}>
            {t("Tozalik {a} · Qabul va xizmat {b}", { a: s.cleanliness_avg?.toFixed(1) ?? '—', b: s.quality_avg?.toFixed(1) ?? '—' })}
          </Text>
        )}
      </View>
      {items.map((r) => (
        <View key={r.id} style={styles.item}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(r.author)}</Text></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h3}>{r.author}</Text>
              <StarsView value={r.rating} size={14} />
            </View>
          </View>
          {r.comment && <Text style={type.body}>{r.comment}</Text>}
          <Text style={type.small}>
            {dayOf(r.created_at).split('-').reverse().join('.')}{r.member_name ? ` · ${t("{a} bilan", { a: r.member_name })}` : ''}
          </Text>
          {r.staff_rating != null && r.staff_comment && (
            <View style={styles.staff}>
              <Text style={type.small}>{staffWord}: {r.member_name}</Text>
              <Text style={type.body}>{r.staff_comment}</Text>
            </View>
          )}
          {r.reply && (
            <View style={styles.reply}>
              <Text style={[type.small, { color: colors.text, ...font('700') }]}>{t("Muassasa javobi")}</Text>
              <Text style={type.body}>{r.reply}</Text>
            </View>
          )}
        </View>
      ))}
      {!done && items.length < s.count && (
        <Button title={t("Barcha sharhlar")} kind="outline" compact busy={busy} onPress={loadMore} />
      )}
    </View>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

const useStyles = makeStyles((c) => ({
  starBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  score: { alignItems: 'center', gap: 4, paddingVertical: 20, borderRadius: 20, backgroundColor: c.accentSoft },
  scoreValue: { fontSize: 40, fontWeight: '800', color: c.text, letterSpacing: -1 },
  scoreTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  item: { gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.line },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: c.accent },
  staff: { padding: 12, borderRadius: 14, backgroundColor: c.surface2, gap: 2 },
  reply: { paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: c.accent, gap: 2 },
}));
