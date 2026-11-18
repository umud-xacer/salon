// "Biznes uchun" — salon, klinika va SPA egalari uchun oddiy landing sahifa (chronix.uz bilan bir xil dizayn).
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BarChart3, Bell, Building2, CalendarDays, Check, CreditCard, Gift, Package, Phone, Send, Smartphone, Users,
} from "lucide-react";

import { api } from "../api";
import { btn, Section } from "../components/ui";
import { PANEL_URL } from "../util";
import { useCategories } from "./Home";
import { pick, t as tr } from "../i18n";

const FEATURES = [
  [Smartphone, tr("Onlayn bron"), tr("Mijozlar Chronix ilovasi va saytidan sizni topib, xizmat, usta va vaqtni tanlab o'zi yoziladi.")],
  [CalendarDays, tr("Kalendar"), tr("Barcha xodimlar bronlari bitta ekranda — to'qnashuvdan himoya, tanaffus va ish soatlari bilan.")],
  [Bell, tr("Eslatmalar"), tr("Mijozga tashrifdan oldin eslatma boradi — kelmay qolishlar kamayadi.")],
  [CreditCard, tr("Kassa"), tr("Naqd va karta to'lovlari, chek, avans va qarzlar — har bir so'm nazoratda.")],
  [Package, tr("Ombor"), tr("Materiallar qoldig'i, kirim-chiqim va shtrix-kod skaneri.")],
  [Users, tr("Xodimlar va oylik"), tr("Foiz yoki stavka bo'yicha oylik avtomatik hisoblanadi, avanslar ayiriladi.")],
  [BarChart3, tr("Hisobotlar"), tr("Daromad, xizmatlar va xodimlar samaradorligi — Excel'ga bir bosishda.")],
  [Gift, tr("Aksiyalar"), tr("Bo'sh soatlarga chegirma, promokodlar va doimiy mijozlar uchun sodiqlik dasturi.")],
  [Building2, tr("Filiallar"), tr("Bir nechta filialni bitta hisobdan boshqarish va yagona obuna.")],
] as const;

const PLAN_TEXT: Record<string, { note: string; features: string[]; featured?: boolean }> = {
  Start: { note: tr("Kichik salon yoki kabinet"), features: [tr("3 tagacha xodim"), tr("Onlayn bron va kalendar"), tr("Ilova va saytda ko'rinish"), tr("Eslatmalar")] },
  Biznes: { note: tr("Eng ko'p tanlanadi"), featured: true, features: [tr("10 tagacha xodim"), tr("Kassa va xarajatlar"), tr("Ombor"), tr("Oylik hisob-kitob"), tr("Hisobotlar va Excel")] },
};

export default function Business() {
  const cats = useCategories();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<{ name: string; name_ru?: string | null; monthly_fee: number }[]>("/catalog/plans") });
  const list = [
    ...(plans.data ?? []).map((p) => ({ name: pick(p.name, p.name_ru), price: `${p.monthly_fee.toLocaleString("ru-RU").replace(/,/g, " ")}`, period: tr("so'm / oy"), ...(PLAN_TEXT[p.name] ?? { note: "", features: [] }) })),
    { name: "Premium", price: tr("Kelishiladi"), period: "", note: tr("Tarmoq va katta klinikalar"), features: [tr("Cheksiz xodim"), tr("Barcha modullar"), tr("Bir nechta filial"), tr("Shaxsiy menejer")], featured: false },
  ];

  return (
    <>
      {/* Hero */}
      <section className="hero-bg text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/15">{tr("Biznes uchun")}</p>
          <h1 className="max-w-3xl text-[38px] font-extrabold leading-[1.05] tracking-tight sm:text-[54px]">
            {tr("Salon, klinika va SPA'ni")} <span className="text-brand-grad">{tr("bitta tizimda")}</span> {tr("boshqaring")}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-white/75">{tr("Onlayn bron, kalendar, kassa, ombor va oylik hisob-kitob — Chronix panelida. Mijozlar sizni chronix.uz va ilovada topadi.")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#boglanish" className="bg-brand-grad inline-flex h-12 items-center gap-2 rounded-full px-6 font-bold text-white shadow-lg">{tr("Ulanish uchun ariza")} <ArrowRight size={18} /></a>
            <a href={PANEL_URL} className="inline-flex h-12 items-center rounded-full bg-white/10 px-6 font-bold ring-1 ring-white/20 hover:bg-white/15">{tr("Panelga kirish")}</a>
          </div>
        </div>
      </section>

      {/* Imkoniyatlar */}
      <Section title={tr("Imkoniyatlar")} sub={tr("Kundalik ishning hammasi bitta joyda")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([Icon, t, d]) => (
            <div key={t} className="rounded-3xl border border-line p-6 transition hover:border-brand/40 hover:shadow-md">
              <span className="bg-brand-grad mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-white"><Icon size={22} /></span>
              <h3 className="text-lg font-bold">{t}</h3>
              <p className="mt-1 text-muted">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Yo'nalishlar */}
      {!!cats.data?.length && (
        <section className="bg-soft">
          <Section title={tr("Kimlar uchun")} sub={tr("Har bir yo'nalishga moslangan xizmatlar ro'yxati bilan")}>
            <div className="flex flex-wrap gap-3">
              {cats.data.map((c) => (
                <span key={c.id} className="rounded-full bg-white px-5 py-3 font-semibold ring-1 ring-line">{pick(c.name_uz, c.name_ru)}</span>
              ))}
            </div>
          </Section>
        </section>
      )}

      {/* Narxlar */}
      <Section id="narxlar" title={tr("Narxlar")} sub={tr("Oylik obuna. Qo'shimcha filial — chegirma bilan.")}>
        <div className="grid gap-5 lg:grid-cols-3">
          {list.map((p) => (
            <div key={p.name} className={`relative rounded-3xl p-7 ${p.featured ? "hero-bg text-white shadow-xl" : "border border-line"}`}>
              {p.featured && <span className="absolute right-6 top-6 rounded-full bg-cyan px-3 py-1 text-xs font-extrabold text-navy">{tr("Ommabop")}</span>}
              <h3 className="text-xl font-extrabold">{p.name}</h3>
              <p className={`mt-1 text-sm ${p.featured ? "text-white/70" : "text-muted"}`}>{p.note}</p>
              <p className="mt-5"><span className="text-4xl font-extrabold">{p.price}</span> <span className={p.featured ? "text-white/70" : "text-muted"}>{p.period}</span></p>
              <ul className="mt-6 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5"><Check size={18} className={p.featured ? "text-cyan" : "text-brand"} />{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* Qanday ulanish */}
      <section className="bg-soft">
        <Section title={tr("Qanday ulanasiz")}>
          <div className="grid gap-4 sm:grid-cols-3">
            {[[tr("Ariza qoldiring"), tr("Telefon yoki Telegram orqali bog'laning")], [tr("Biz sozlaymiz"), tr("Xizmatlar, xodimlar va ish vaqtini birga kiritamiz")], [tr("Mijoz qabul qiling"), tr("Muassasangiz chronix.uz va ilovada ko'rinadi")]].map(([t, d], k) => (
              <div key={t} className="rounded-3xl bg-white p-6 ring-1 ring-line">
                <span className="bg-brand-grad flex h-10 w-10 items-center justify-center rounded-full font-extrabold text-white">{k + 1}</span>
                <h3 className="mt-4 text-lg font-bold">{t}</h3>
                <p className="mt-1 text-muted">{d}</p>
              </div>
            ))}
          </div>
        </Section>
      </section>

      {/* Bog'lanish */}
      <Section id="boglanish" title={tr("Bog'lanish")} sub={tr("Savol yoki ulanish uchun — bizga yozing yoki qo'ng'iroq qiling")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="tel:+998200035599" className="flex items-center gap-4 rounded-3xl border border-line p-6 hover:border-brand">
            <span className="bg-brand-grad flex h-12 w-12 items-center justify-center rounded-2xl text-white"><Phone size={22} /></span>
            <span><b className="block text-lg">+998 20 003 55 99</b><span className="text-muted">{tr("Qo'ng'iroq qilish")}</span></span>
          </a>
          <a href="https://t.me/JabborqulovUmidjon" target="_blank" rel="noopener" className="flex items-center gap-4 rounded-3xl border border-line p-6 hover:border-brand">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#229ED9] text-white"><Send size={22} /></span>
            <span><b className="block text-lg">Telegram</b><span className="text-muted">@JabborqulovUmidjon</span></span>
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-brand-soft p-6">
          <p className="font-bold text-navy">{tr("Allaqachon Chronix'dasizmi?")}</p>
          <a href={PANEL_URL} className={btn.dark}>{tr("Panelga kirish")} <ArrowRight size={18} /></a>
        </div>
      </Section>
    </>
  );
}
