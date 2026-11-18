// Bron qilish (prototip "9", Immersive Booking): pastdan prujina bilan chiquvchi oyna, qadamlar orasida silliq o'tish.
// Salon: xizmat -> usta ("Farqi yo'q" ham) -> sana va vaqt (bitta ekranda) -> tasdiq (promokod, chegirma).
// Klinika: shifokor -> xizmat -> vaqt -> tasdiq. Ko'chirish: vaqt -> tasdiq. Hot Slot: darhol tasdiq.
import { track } from '../src/analytics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, Appointment, BusinessDetail, Quote, Service, Slot } from '../src/api';
import { useAuth } from '../src/auth';
import { useAuthGate } from '../src/authGate';
import { pick, t } from '../src/i18n';
import { scheduleBookingReminder } from '../src/localReminders';
import { needsPhoneConfirm, PhoneConfirm } from '../src/PhoneConfirm';
import {
  Avatar, Button, dayOf, Empty, ErrorText, Icon, IconButton, makeStyles, money, nextDays, Pressy, Steps, timeOf, useBottomSpace,
  useTheme, useType,
} from '../src/ui';

type StepId = 'service' | 'master' | 'doctor' | 'time' | 'confirm';
type Pick = { starts_at: string; time: string; member: number };
const DAYS = nextDays(14);
const WD = [t("Ya"), t("Du"), t("Se"), t("Ch"), t("Pa"), t("Ju"), t("Sh")];
const WD_LONG = [t("yakshanba"), t("dushanba"), t("seshanba"), t("chorshanba"), t("payshanba"), t("juma"), t("shanba")];
const MONTHS = [t("yanvar"), t("fevral"), t("mart"), t("aprel"), t("may"), t("iyun"), t("iyul"), t("avgust"), t("sentabr"),
  t("oktabr"), t("noyabr"), t("dekabr")];
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const dateText = (d: string) => `${+d.slice(8)}-${MONTHS[+d.slice(5, 7) - 1]}, ${WD_LONG[weekday(d)]}`;
const ANY = -1;
const SOURCE: Record<string, string> = { hot: t("Bo'sh soat chegirmasi"), promo: t("Promokod"), loyalty: t("Sodiqlik mukofoti") };

/** Qadam almashganda o'ngdan silliq kirib keladi */
function StepIn({ children }: { children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v]);
  return (
    <Animated.View style={{ gap: 10, opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

export default function Book() {
  const params = useLocalSearchParams<{ slug?: string; serviceId?: string; memberId?: string; startsAt?: string; appointmentId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottom = useBottomSpace(12);
  const { height } = useWindowDimensions();
  const { c } = useTheme();
  const { me, refresh } = useAuth();
  const [askPhone, setAskPhone] = useState(false);
  const { requireAuth } = useAuthGate();
  const s = useStyles();
  const ty = useType();
  const reschedule = !!params.appointmentId;
  const hot = !!params.startsAt && !!params.memberId && !!params.serviceId;

  const [b, setB] = useState<BusinessDetail | null>(null);
  const [service, setService] = useState<number | null>(params.serviceId ? Number(params.serviceId) : null);
  const [member, setMember] = useState<number | null>(params.memberId ? Number(params.memberId) : null);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [day, setDay] = useState(params.startsAt ? dayOf(params.startsAt) : DAYS[0]);
  const [slots, setSlots] = useState<Pick[] | null>(null);
  const [slot, setSlot] = useState<Pick | null>(hot ? { starts_at: params.startsAt!, time: timeOf(params.startsAt!), member: Number(params.memberId) } : null);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Appointment | null>(null);

  const y = useRef(new Animated.Value(height)).current;
  useEffect(() => {
    Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 170, mass: 0.9 }).start();
  }, [y]);
  const close = () => Animated.timing(y, { toValue: height, duration: 220, useNativeDriver: true }).start(() => router.back());

  // Muassasa (ko'chirishda — bron orqali)
  useEffect(() => {
    (async () => {
      try {
        let slug = params.slug;
        if (reschedule) {
          const a = await api<Appointment>(`/appointments/${params.appointmentId}`);
          slug = a.business_slug ?? undefined;
          setService(a.service_ids[0]);
          setMember(a.member_id);
        }
        if (slug) setB(await api<BusinessDetail>(`/catalog/businesses/${slug}`));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("Yuklab bo'lmadi"));
      }
    })();
  }, [params.slug, params.appointmentId, reschedule]);

  const clinic = b?.kind === 'clinic';
  // Yakka rejim: yagona mutaxassis (direktor) — usta/shifokor tanlash qadami yo'q, bron unga yoziladi
  const soloId = b?.solo && b.staff.length === 1 ? b.staff[0].member_id : null;
  const steps: StepId[] = reschedule ? ['time', 'confirm'] : hot ? ['confirm'] : soloId !== null
    ? ['service', 'time', 'confirm'] : clinic
    ? ['doctor', 'service', 'time', 'confirm'] : ['service', 'master', 'time', 'confirm'];
  useEffect(() => {
    if (soloId !== null && !reschedule && !hot) setMember(soloId);
  }, [soloId, reschedule, hot]);
  const current = steps[Math.min(step, steps.length - 1)];

  // Venue'dan xizmat tanlab kelinsa — usta qadamidan boshlanadi
  const started = useRef(false);
  useEffect(() => {
    if (!b || started.current) return;
    started.current = true;
    if (!reschedule && !hot && !clinic && params.serviceId) setStep(1);
  }, [b, reschedule, hot, clinic, params.serviceId]);

  const allServices = useMemo(() => b?.service_groups.flatMap((g) => g.services) ?? [], [b]);
  const svc: Service | undefined = allServices.find((x) => x.id === service);
  const masters = useMemo(() => (b && service ? b.staff.filter((m) => m.service_ids.includes(service)) : []), [b, service]);
  const chosen = b?.staff.find((m) => m.member_id === (slot?.member ?? member));

  const loadSlots = useCallback(async () => {
    if (!service || member === null || !b) return;
    setSlots(null);
    setError(null);
    const one = async (m: number) => {
      const p = new URLSearchParams({ member_id: String(m), service_id: String(service), date: day });
      return (await api<{ slots: Slot[] }>(`/catalog/slots?${p}`)).slots.map((x) => ({ starts_at: x.starts_at, time: x.time, member: m }));
    };
    try {
      if (member !== ANY) {
        setSlots(await one(member));
        return;
      }
      // "Farqi yo'q": har vaqtga o'sha kuni eng ko'p bo'sh vaqti bor usta (yuklama teng taqsimlanadi)
      const lists = await Promise.all(masters.map((m) => one(m.member_id).catch(() => [] as Pick[])));
      const free = new Map(lists.map((l, i) => [masters[i].member_id, l.length]));
      const best = new Map<string, Pick>();
      for (const p of lists.flat()) {
        const cur = best.get(p.starts_at);
        if (!cur || (free.get(p.member) ?? 0) > (free.get(cur.member) ?? 0)) best.set(p.starts_at, p);
      }
      setSlots([...best.values()].sort((a, z) => a.starts_at.localeCompare(z.starts_at)));
    } catch (e) {
      setSlots([]);
      setError(e instanceof ApiError ? e.message : t("Yuklab bo'lmadi"));
    }
  }, [service, member, day, b, masters]);

  useEffect(() => {
    if (current === 'time') void loadSlots();
  }, [current, loadSlots]);

  // Tasdiqlash: narx va chegirmani server hisoblaydi
  const loadQuote = useCallback(async (promo: string | null) => {
    if (!slot || !service || !me) return;            // mehmon: chegirma kirgandan keyin hisoblanadi
    try {
      setQuote(await api<Quote>('/appointments/quote', { method: 'POST', body: {
        member_id: slot.member, service_id: service, starts_at: slot.starts_at, promo_code: promo,
      } }));
    } catch {
      setQuote(null);
    }
  }, [slot, service, me]);

  useEffect(() => {
    if (current === 'confirm' && !reschedule) void loadQuote(applied);
  }, [current, reschedule, applied, loadQuote]);

  const codeError = quote?.code_error ? {
    promo_not_found: t("Promokod topilmadi yoki muddati tugagan"),
    promo_used: t("Bu promokoddan allaqachon foydalangansiz"),
    promo_limit: t("Promokod limiti tugagan"),
    promo_first_visit: t("Bu promokod faqat birinchi tashrif uchun"),
  }[quote.code_error] : null;

  const submit = async (phoneOk = false) => {
    if (!slot || !service) return;
    // Lazy auth: tanlov saqlanadi, kirgandan keyin shu oynaga qaytib "Tasdiqlash" bosiladi
    if (!requireAuth(t("Bron qilish uchun profilingizga kiring yoki ro'yxatdan o'ting"))) return;
    // Yangi bron oldidan (7 kunda bir marta): salon bog'lanadigan raqam hamon to'g'rimi
    if (!reschedule && !phoneOk && needsPhoneConfirm(me?.user)) return setAskPhone(true);
    setBusy(true);
    setError(null);
    try {
      const saved = reschedule
        ? await api<Appointment>(`/appointments/${params.appointmentId}/reschedule`, { method: 'POST', body: { starts_at: slot.starts_at } })
        : await api<Appointment>('/appointments', { method: 'POST', body: {
          member_id: slot.member, service_id: service, starts_at: slot.starts_at,
          promo_code: applied && !quote?.code_error ? applied : null,
        } });
      void scheduleBookingReminder(saved.id, saved.starts_at, saved.business_name ?? t("Salon"));
      track(reschedule ? 'booking_reschedule' : 'booking_confirm', { discount: quote?.source ?? null, hot });
      setDone(saved);
    } catch (e) {
      // Vaqtni shu orada boshqa mijoz olgan: vaqt tanlashga qaytamiz (Hot Slot'da — yopib, qayta tanlashga)
      if (e instanceof ApiError && e.code === 'time_conflict' && steps.includes('time')) {
        setSlot(null);
        setStep(steps.indexOf('time'));
      }
      setError(e instanceof ApiError ? e.message : t("Bajarib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setError(null);
    if (current === 'confirm') return void submit();
    setStep(step + 1);
  };
  const canNext = current === 'service' ? !!service : current === 'master' || current === 'doctor' ? member !== null
    : current === 'time' ? !!slot : !busy;
  const titles: Record<StepId, string> = {
    service: t("Xizmatni tanlang"), master: t("Ustani tanlang"), doctor: t("Shifokorni tanlang"),
    time: t("Sana va vaqt"), confirm: reschedule ? t("Yangi vaqtni tasdiqlang") : t("Tasdiqlash"),
  };
  const final = quote ? quote.final : svc?.price ?? 0;
  const cta = current === 'confirm'
    ? (reschedule ? t("Vaqtni o'zgartirish") : t("Tasdiqlash · {a}", { a: money(final) }))
    : current === 'time' && !slot ? t("Vaqtni tanlang") : t("Davom etish");

  const groups = useMemo(() => {
    const g = [
      { label: t("Ertalab"), items: [] as Pick[] }, { label: t("Kunduzi"), items: [] as Pick[] }, { label: t("Kechqurun"), items: [] as Pick[] },
    ];
    for (const p of slots ?? []) g[+p.time.slice(0, 2) < 12 ? 0 : +p.time.slice(0, 2) < 17 ? 1 : 2].items.push(p);
    return g.filter((x) => x.items.length);
  }, [slots]);

  const specialties = useMemo(() => [...new Set((b?.staff ?? []).map((m) => m.title?.trim() || t("Umumiy amaliyot")))].sort(), [b]);

  const body = !b ? (
    error ? <ErrorText text={error} /> : <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} />
  ) : done ? (
    <View style={s.done}>
      <View style={s.doneIcon}><Icon name="checkmark" size={46} color={c.success} /></View>
      <Text style={[ty.h1, { textAlign: 'center' }]}>{reschedule ? t("Vaqt o'zgartirildi") : t("Bron qilindi!")}</Text>
      <Text style={[ty.body, { color: c.muted, textAlign: 'center', lineHeight: 22 }]}>
        {dateText(dayOf(done.starts_at))}, {timeOf(done.starts_at)} — {done.member_name}.{'\n'}
        {done.status === 'pending'
          ? t("Salon tasdiqlashini kuting: tasdiqlanmasa, bron avtomatik bekor qilinadi.")
          : t("Eslatma 30 daqiqa oldin keladi.")}
      </Text>
      {!!done.discount && <Text style={[ty.h3, { color: c.success }]}>{t("Tejadingiz: {a}", { a: money(done.discount) })}</Text>}
    </View>
  ) : (
    <StepIn key={current}>
      {current === 'service' && b.service_groups.map((g) => {
        const list = g.services.filter((x) => !clinic || !member || b.staff.find((m) => m.member_id === member)?.service_ids.includes(x.id))
          .filter((x) => clinic || !params.memberId || b.staff.find((m) => m.member_id === Number(params.memberId))?.service_ids.includes(x.id));
        if (!list.length) return null;
        return (
          <View key={g.category_id ?? 0} style={{ gap: 10 }}>
            <Text style={ty.caps}>{pick(g.category_name, g.category_name_ru)}</Text>
            {list.map((x) => {
              const on = service === x.id;
              return (
                <Pressy key={x.id} onPress={() => { setService(x.id); if (!clinic && !params.memberId) setMember(null); setSlot(null); }}
                  style={[s.option, on && s.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={ty.h3}>{pick(x.name, x.name_ru)}</Text>
                    <Text style={ty.small}>{t("{a} daq", { a: x.duration_min })}</Text>
                  </View>
                  <Text style={s.price}>{money(x.price)}</Text>
                  <View style={[s.radio, on && s.radioOn]}>{on && <Icon name="checkmark" size={14} color={c.ctaText} />}</View>
                </Pressy>
              );
            })}
          </View>
        );
      })}

      {current === 'doctor' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {specialties.map((x) => (
              <Pressy key={x} onPress={() => setSpecialty(specialty === x ? null : x)} style={[s.chip, specialty === x && s.chipOn]} scaleTo={0.95}>
                <Text style={[s.chipText, specialty === x && { color: c.ctaText }]}>{t(x)}</Text>
              </Pressy>
            ))}
          </ScrollView>
          {b.staff.filter((m) => !specialty || (m.title?.trim() || t("Umumiy amaliyot")) === specialty).map((m) => {
            const on = member === m.member_id;
            return (
              <Pressy key={m.member_id} onPress={() => { setMember(m.member_id); setService(null); setSlot(null); }}
                style={[s.option, on && s.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Avatar name={m.full_name} photo={m.photo_url} size={50} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={ty.h3}>{m.full_name}</Text>
                  <Text style={ty.small}>{[m.title ? t(m.title) : null, m.rating_count > 0 ? `★ ${m.rating_avg.toFixed(1)}` : null].filter(Boolean).join(' · ')}</Text>
                </View>
                <View style={[s.radio, on && s.radioOn]}>{on && <Icon name="checkmark" size={14} color={c.ctaText} />}</View>
              </Pressy>
            );
          })}
        </>
      )}

      {current === 'master' && (
        <>
          {svc && (
            <View style={s.summaryRow}>
              <Text style={[ty.h3, { flex: 1 }]} numberOfLines={1}>{pick(svc.name, svc.name_ru)} · {t("{a} daq", { a: svc.duration_min })}</Text>
              <Text style={s.price}>{money(svc.price)}</Text>
            </View>
          )}
          {masters.length === 0 && <Empty text={t("Bu xizmat uchun mutaxassis yo'q")} />}
          {[...(masters.length > 1 ? [null] : []), ...masters].map((m) => {
            const id = m ? m.member_id : ANY;
            const on = member === id;
            return (
              <Pressy key={id} onPress={() => { setMember(id); setSlot(null); }} style={[s.option, on && s.optionOn]}
                accessibilityRole="radio" accessibilityState={{ selected: on }}>
                {m ? <Avatar name={m.full_name} photo={m.photo_url} size={50} /> : (
                  <View style={s.anyIcon}><Icon name="sparkles" size={22} color={c.accent} /></View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={ty.h3}>{m ? m.full_name : t("Farqi yo'q")}</Text>
                  <Text style={ty.small}>
                    {m ? [m.title ? t(m.title) : null, m.rating_count > 0 ? `★ ${m.rating_avg.toFixed(1)} (${m.rating_count})` : t("Yangi")].filter(Boolean).join(' · ')
                      : t("Birinchi bo'sh usta — eng tez vaqt")}
                  </Text>
                </View>
                <View style={[s.radio, on && s.radioOn]}>{on && <Icon name="checkmark" size={14} color={c.ctaText} />}</View>
              </Pressy>
            );
          })}
        </>
      )}

      {current === 'time' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {DAYS.map((d) => {
              const on = d === day;
              return (
                <Pressy key={d} onPress={() => { setDay(d); setSlot(null); }} scaleTo={0.94} style={[s.day, on && s.dayOn]}
                  accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={dateText(d)}>
                  <Text style={[s.dayWd, on && { color: c.ctaText }]}>{WD[weekday(d)]}</Text>
                  <Text style={[s.dayNum, on && { color: c.ctaText }]}>{+d.slice(8)}</Text>
                </Pressy>
              );
            })}
          </ScrollView>
          <Text style={ty.small}>{dateText(day)}{member === ANY ? ` · ${t("usta avtomatik tanlanadi")}` : chosen ? ` · ${chosen.full_name}` : ''}</Text>
          {slots === null ? <ActivityIndicator style={{ marginTop: 16 }} color={c.accent} />
            : slots.length === 0 ? <Empty text={t("Bu kunda bo'sh vaqt yo'q")} />
              : groups.map((g) => (
                <View key={g.label} style={{ gap: 8 }}>
                  <Text style={ty.caps}>{g.label}</Text>
                  <View style={s.grid}>
                    {g.items.map((p) => {
                      const on = slot?.starts_at === p.starts_at;
                      return (
                        <Pressy key={p.starts_at} onPress={() => setSlot(p)} scaleTo={0.92} style={[s.time, on && s.timeOn]}
                          accessibilityRole="button" accessibilityState={{ selected: on }}>
                          <Text style={[s.timeText, on && { color: c.onAccent }]}>{p.time}</Text>
                        </Pressy>
                      );
                    })}
                  </View>
                </View>
              ))}
        </>
      )}

      {current === 'confirm' && slot && (
        <>
          <View style={s.ticket}>
            <Text style={ty.h2}>{b.name}</Text>
            {b.address && <Text style={ty.small}>{b.address}</Text>}
            <View style={s.hr} />
            {[
              [t("Xizmat"), svc ? pick(svc.name, svc.name_ru) : '—'],
              [clinic ? t("Shifokor") : t("Usta"), chosen?.full_name ?? '—'],
              [t("Sana"), dateText(dayOf(slot.starts_at))],
              [t("Vaqt"), `${slot.time}${svc ? ` · ${t("{a} daq", { a: svc.duration_min })}` : ''}`],
            ].map(([k, v]) => (
              <View key={k} style={s.kv}><Text style={ty.small}>{k}</Text><Text style={[ty.body, { fontWeight: '700', flexShrink: 1, textAlign: 'right' }]}>{v}</Text></View>
            ))}
            {!reschedule && (
              <>
                <View style={s.hr} />
                <View style={s.kv}><Text style={ty.small}>{t("Narx")}</Text><Text style={ty.body}>{money(quote?.price ?? svc?.price ?? 0)}</Text></View>
                {!!quote?.discount && (
                  <View style={s.kv}>
                    <Text style={[ty.small, { color: c.success }]}>{SOURCE[quote.source ?? ''] ?? t("Chegirma")} · −{quote.percent}%</Text>
                    <Text style={[ty.body, { color: c.success, fontWeight: '700' }]}>−{money(quote.discount)}</Text>
                  </View>
                )}
                <View style={[s.kv, { marginTop: 4 }]}>
                  <Text style={ty.h3}>{t("Jami")}</Text>
                  <Text style={s.total}>{money(final)}</Text>
                </View>
              </>
            )}
          </View>
          {!reschedule && (
            <View style={s.promo}>
              <Icon name="pricetag-outline" size={19} color={c.muted} />
              <TextInput value={code} onChangeText={(x) => setCode(x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
                placeholder={t("Promokod")} placeholderTextColor={c.muted} autoCapitalize="characters" style={s.promoInput}
                accessibilityLabel={t("Promokod")} />
              <Pressable onPress={() => { track('promo_apply'); setApplied(code || null); }} disabled={code.length < 3} hitSlop={8} accessibilityRole="button">
                <Text style={[ty.link, code.length < 3 && { color: c.muted }]}>{t("Qo'llash")}</Text>
              </Pressable>
            </View>
          )}
          {applied && codeError && <Text style={{ color: c.danger, fontSize: 13 }}>{codeError}</Text>}
          {applied && quote && !quote.code_error && quote.source !== 'promo' && (
            <Text style={ty.small}>{t("Promokoddan kattaroq chegirma qo'llandi")}</Text>
          )}
          <Text style={[ty.small, s.note]}>{t("To'lov muassasada. Bron vaqtidan 30 daqiqa oldin eslatma keladi — \"Boraman\" yoki \"Bormayman\" deb javob berasiz.")}</Text>
        </>
      )}
      <ErrorText text={error} />
    </StepIn>
  );

  return (
    <View style={{ flex: 1 }}>
      <Pressable style={[s.backdrop]} onPress={close} accessibilityLabel={t("Yopish")} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap} pointerEvents="box-none">
        <Animated.View style={[s.sheet, { maxHeight: height - insets.top - 20, minHeight: Math.min(560, height * 0.7), transform: [{ translateY: y }] }]}>
          <View style={s.grabber} />
          {!done && (
            <View style={s.head}>
              {step > 0 && !hot
                ? <IconButton icon="chevron-back" label={t("Orqaga")} onPress={() => { setError(null); setStep(step - 1); }} size={40} />
                : <View style={{ width: 40 }} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={ty.tiny}>{t("{a} / {b} qadam", { a: Math.min(step, steps.length - 1) + 1, b: steps.length })}</Text>
                <Text style={ty.h3} numberOfLines={1}>{titles[current]}</Text>
              </View>
              <IconButton icon="close" label={t("Yopish")} onPress={close} size={40} />
            </View>
          )}
          {!done && steps.length > 1 && <View style={{ flexDirection: 'row', height: 5, marginHorizontal: 20, marginBottom: 12 }}><Steps step={step + 1} total={steps.length} /></View>}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 6 }} keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {body}
          </ScrollView>
          <View style={[s.footer, { paddingBottom: bottom }]}>
            {done ? (
              <Button title={t("Bronlarimga o'tish")} onPress={() => router.replace('/bookings')} />
            ) : b && (
              <Button title={cta} onPress={next} busy={busy} disabled={!canNext} />
            )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
      {me && askPhone && (
        <PhoneConfirm user={me.user} visible onClose={() => setAskPhone(false)}
          onDone={() => { setAskPhone(false); void refresh().catch(() => {}); void submit(true); }} />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.line, marginTop: 10, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: c.surface,
    borderWidth: 2, borderColor: c.line,
  },
  optionOn: { borderColor: c.text },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: c.cta, borderColor: c.cta },
  price: { fontSize: 15, fontWeight: '800', color: c.text },
  anyIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.surface2 },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, justifyContent: 'center' },
  chipOn: { backgroundColor: c.cta, borderColor: c.cta },
  chipText: { fontSize: 13, fontWeight: '700', color: c.text },
  day: {
    width: 56, height: 72, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  dayOn: { backgroundColor: c.cta, borderColor: c.cta },
  dayWd: { fontSize: 12, fontWeight: '700', color: c.muted },
  dayNum: { fontSize: 20, fontWeight: '800', color: c.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  time: {
    width: '23%', flexGrow: 1, maxWidth: '24%', height: 46, borderRadius: 14, borderWidth: 1, borderColor: c.line,
    backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center',
  },
  timeOn: { backgroundColor: c.accent, borderColor: c.accent },
  timeText: { fontSize: 15, fontWeight: '700', color: c.text },
  ticket: { padding: 18, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 8 },
  hr: { height: 1, backgroundColor: c.line, marginVertical: 4 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  total: { fontSize: 24, fontWeight: '800', color: c.text },
  promo: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 14, borderRadius: 16,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderStyle: 'dashed',
  },
  promoInput: { flex: 1, fontSize: 15, fontWeight: '700', color: c.text, letterSpacing: 1 },
  note: { padding: 14, borderRadius: 16, backgroundColor: c.accentSoft, color: c.accent, lineHeight: 19 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg },
  done: { alignItems: 'center', gap: 14, paddingVertical: 36 },
  doneIcon: { width: 92, height: 92, borderRadius: 46, backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center' },
}));
