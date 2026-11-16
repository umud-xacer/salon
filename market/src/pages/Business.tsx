// "Biznes uchun" — salon, klinika va SPA egalari uchun oddiy landing sahifa (chronix.uz bilan bir xil dizayn).
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BarChart3, Bell, Building2, CalendarDays, Check, CreditCard, Gift, Package, Phone, Send, Smartphone, Users,
} from "lucide-react";

import { api } from "../api";
import { btn, Section } from "../components/ui";
import { PANEL_URL } from "../util";
import { useCategories } from "./Home";

const FEATURES = [
  [Smartphone, "Onlayn bron", "Mijozlar Chronix ilovasi va saytidan sizni topib, xizmat, usta va vaqtni tanlab o'zi yoziladi."],
  [CalendarDays, "Kalendar", "Barcha xodimlar bronlari bitta ekranda — to'qnashuvdan himoya, tanaffus va ish soatlari bilan."],
  [Bell, "Eslatmalar", "Mijozga tashrifdan oldin eslatma boradi — kelmay qolishlar kamayadi."],
  [CreditCard, "Kassa", "Naqd va karta to'lovlari, chek, avans va qarzlar — har bir so'm nazoratda."],
  [Package, "Ombor", "Materiallar qoldig'i, kirim-chiqim va shtrix-kod skaneri."],
  [Users, "Xodimlar va oylik", "Foiz yoki stavka bo'yicha oylik avtomatik hisoblanadi, avanslar ayiriladi."],
  [BarChart3, "Hisobotlar", "Daromad, xizmatlar va xodimlar samaradorligi — Excel'ga bir bosishda."],
  [Gift, "Aksiyalar", "Bo'sh soatlarga chegirma, promokodlar va doimiy mijozlar uchun sodiqlik dasturi."],
  [Building2, "Filiallar", "Bir nechta filialni bitta hisobdan boshqarish va yagona obuna."],
] as const;

const PLAN_TEXT: Record<string, { note: string; features: string[]; featured?: boolean }> = {
  Start: { note: "Kichik salon yoki kabinet", features: ["3 tagacha xodim", "Onlayn bron va kalendar", "Ilova va saytda ko'rinish", "Eslatmalar"] },
  Biznes: { note: "Eng ko'p tanlanadi", featured: true, features: ["10 tagacha xodim", "Kassa va xarajatlar", "Ombor", "Oylik hisob-kitob", "Hisobotlar va Excel"] },
};

export default function Business() {
  const cats = useCategories();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<{ name: string; monthly_fee: number }[]>("/catalog/plans") });
  const list = [
    ...(plans.data ?? []).map((p) => ({ name: p.name, price: `${p.monthly_fee.toLocaleString("ru-RU").replace(/,/g, " ")}`, period: "so'm / oy", ...(PLAN_TEXT[p.name] ?? { note: "", features: [] }) })),
    { name: "Premium", price: "Kelishiladi", period: "", note: "Tarmoq va katta klinikalar", features: ["Cheksiz xodim", "Barcha modullar", "Bir nechta filial", "Shaxsiy menejer"], featured: false },
  ];

  return (
    <>
      {/* Hero */}
      <section className="hero-bg text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold ring-1 ring-white/15">Biznes uchun</p>
          <h1 className="max-w-3xl text-[38px] font-extrabold leading-[1.05] tracking-tight sm:text-[54px]">
            Salon, klinika va SPA'ni <span className="text-brand-grad">bitta tizimda</span> boshqaring
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-white/75">Onlayn bron, kalendar, kassa, ombor va oylik hisob-kitob — Chronix panelida. Mijozlar sizni chronix.uz va ilovada topadi.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#boglanish" className="bg-brand-grad inline-flex h-12 items-center gap-2 rounded-full px-6 font-bold text-white shadow-lg">Ulanish uchun ariza <ArrowRight size={18} /></a>
            <a href={PANEL_URL} className="inline-flex h-12 items-center rounded-full bg-white/10 px-6 font-bold ring-1 ring-white/20 hover:bg-white/15">Panelga kirish</a>
          </div>
        </div>
      </section>

      {/* Imkoniyatlar */}
      <Section title="Imkoniyatlar" sub="Kundalik ishning hammasi bitta joyda">
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
          <Section title="Kimlar uchun" sub="Har bir yo'nalishga moslangan xizmatlar ro'yxati bilan">
            <div className="flex flex-wrap gap-3">
              {cats.data.map((c) => (
                <span key={c.id} className="rounded-full bg-white px-5 py-3 font-semibold ring-1 ring-line">{c.name_uz}</span>
              ))}
            </div>
          </Section>
        </section>
      )}

      {/* Narxlar */}
      <Section id="narxlar" title="Narxlar" sub="Oylik obuna. Qo'shimcha filial — chegirma bilan.">
        <div className="grid gap-5 lg:grid-cols-3">
          {list.map((p) => (
            <div key={p.name} className={`relative rounded-3xl p-7 ${p.featured ? "hero-bg text-white shadow-xl" : "border border-line"}`}>
              {p.featured && <span className="absolute right-6 top-6 rounded-full bg-cyan px-3 py-1 text-xs font-extrabold text-navy">Ommabop</span>}
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
        <Section title="Qanday ulanasiz">
          <div className="grid gap-4 sm:grid-cols-3">
            {[["Ariza qoldiring", "Telefon yoki Telegram orqali bog'laning"], ["Biz sozlaymiz", "Xizmatlar, xodimlar va ish vaqtini birga kiritamiz"], ["Mijoz qabul qiling", "Muassasangiz chronix.uz va ilovada ko'rinadi"]].map(([t, d], k) => (
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
      <Section id="boglanish" title="Bog'lanish" sub="Savol yoki ulanish uchun — bizga yozing yoki qo'ng'iroq qiling">
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="tel:+998200035599" className="flex items-center gap-4 rounded-3xl border border-line p-6 hover:border-brand">
            <span className="bg-brand-grad flex h-12 w-12 items-center justify-center rounded-2xl text-white"><Phone size={22} /></span>
            <span><b className="block text-lg">+998 20 003 55 99</b><span className="text-muted">Qo'ng'iroq qilish</span></span>
          </a>
          <a href="https://t.me/JabborqulovUmidjon" target="_blank" rel="noopener" className="flex items-center gap-4 rounded-3xl border border-line p-6 hover:border-brand">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#229ED9] text-white"><Send size={22} /></span>
            <span><b className="block text-lg">Telegram</b><span className="text-muted">@JabborqulovUmidjon</span></span>
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-brand-soft p-6">
          <p className="font-bold text-navy">Allaqachon Chronix'dasizmi?</p>
          <a href={PANEL_URL} className={btn.dark}>Panelga kirish <ArrowRight size={18} /></a>
        </div>
      </Section>
    </>
  );
}
