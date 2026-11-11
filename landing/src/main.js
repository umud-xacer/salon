import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { LINKS, PLANS } from "./config.js";
import { applyLang, currentLang, PLAN_TEXT, saveLang, t } from "./i18n.js";

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add("js");
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
document.body.classList.add("loading");

// ── Til (UZ / RU): matnlar so'zlarga bo'linishidan OLDIN qo'yiladi ──
const LANG = currentLang();
applyLang(LANG);
const tr = (k) => t(LANG, k);
const planText = (x) => (LANG === "uz" ? x : PLAN_TEXT[LANG]?.[x] ?? x);
// Til almashganda sahifa yuklanish ekranisiz qayta ochiladi va scroll joyi saqlanadi
let skipLoader = false;
try {
  skipLoader = sessionStorage.getItem("chronix-lang-switch") === "1";
  sessionStorage.removeItem("chronix-lang-switch");
} catch { /* xususiy oyna */ }
document.querySelectorAll("[data-lang]").forEach((btn) => {
  const on = btn.dataset.lang === LANG;
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.addEventListener("click", () => {
    if (btn.dataset.lang === LANG) return;
    saveLang(btn.dataset.lang);
    try {
      sessionStorage.setItem("chronix-lang-switch", "1");
      sessionStorage.setItem("chronix-scroll", String(Math.round(window.scrollY)));
    } catch { /* xususiy oyna */ }
    const url = new URL(location.href);
    url.searchParams.delete("lang");
    document.body.classList.add("switching");
    setTimeout(() => { location.replace(url.toString()); }, 260);
  });
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const mobile = () => window.innerWidth < 860;

// ── Silliq scroll (Lenis) ──
let lenis = null;
if (!reducedMotion) {
  lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();
}
function scrollToHash(hash) {
  const target = hash === "#top" ? 0 : $(hash);
  if (target === null) return;
  if (lenis) lenis.scrollTo(target, { offset: hash === "#top" ? 0 : -70, duration: 1.5 });
  else if (target === 0) window.scrollTo({ top: 0 });
  else target.scrollIntoView();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const hash = a.getAttribute("href");
  if (hash.length < 2) return;
  e.preventDefault();
  scrollToHash(hash);
});

// ── Toast ──
const toastEl = $("#toast");
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// ── Tariflar: matnlar config.js da, narxlar va faol tariflar Super Admin "Narxlar" sahifasidan (API) ──
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtSum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const periodText = (p) => (p.period ? (LANG === "uz" ? p.period : PLAN_TEXT[LANG].period) : "");
const planCard = (p) => `
  <article class="price${p.featured ? " featured" : ""}" data-plan="${esc(p.name)}"${p.fixed ? " data-fixed" : ""}>
    <span class="tag"${p.note ? "" : " hidden"}>${esc(planText(p.note ?? ""))}</span>
    <h3>${esc(p.name)}</h3>
    <div class="amount">${esc(planText(p.price))}</div>
    <div class="per">${periodText(p)}</div>
    <ul>${(p.features ?? []).map((f) => `<li>${esc(planText(f))}</li>`).join("")}</ul>
    <a class="btn ${p.featured ? "btn-light" : "btn-line"}" href="#aloqa"><span>${tr("prices.cta")}</span><i class="arrow" aria-hidden="true">→</i></a>
  </article>`;
$("#prices").innerHTML = PLANS.map(planCard).join("");

// Jonli narxlar: kartalar joyida yangilanadi (animatsiyalar buzilmaydi). Xato bo'lsa config.js dagi zaxira qoladi.
function applyLivePlans(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  const box = $("#prices");
  const live = new Map(list.filter((p) => p?.name && Number.isFinite(p.monthly_fee)).map((p) => [p.name.trim().toLowerCase(), p]));
  if (live.size === 0) return;
  box.querySelectorAll("[data-plan]:not([data-fixed])").forEach((card) => {
    const key = card.dataset.plan.trim().toLowerCase();
    const p = live.get(key);
    if (!p) { card.remove(); return; }                    // tarif Narxlar sahifasida o'chirilgan
    card.querySelector(".amount").textContent = fmtSum(p.monthly_fee);
    if (LANG === "ru" && p.name_ru) card.querySelector("h3").textContent = p.name_ru;
    live.delete(key);
  });
  // Narxlar sahifasida ochilgan, config.js da tavsifi hali yo'q tariflar — nom va narx bilan
  const fixed = box.querySelector("[data-fixed]");
  for (const p of live.values()) {
    const html = planCard({ name: LANG === "ru" && p.name_ru ? p.name_ru : p.name, price: fmtSum(p.monthly_fee), period: "so'm / oy" });
    if (fixed) fixed.insertAdjacentHTML("beforebegin", html); else box.insertAdjacentHTML("beforeend", html);
  }
}
if (LINKS.api) {
  fetch(`${LINKS.api}/api/v1/catalog/plans`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(applyLivePlans)
    .catch(() => { /* API yo'q — zaxira narxlar ko'rinadi */ });
}

// ── Havolalar ──
const SOON = { play: tr("toast.play"), appstore: tr("toast.appstore") };
$$("[data-link]").forEach((a) => {
  const k = a.dataset.link;
  let href = LINKS[k];
  if (k === "phone" && href) href = `tel:${href.replace(/\s/g, "")}`;
  if (href) {
    a.href = href;
    if (/^https?:/.test(href) && k !== "panel") { a.target = "_blank"; a.rel = "noopener"; }
  } else {
    a.addEventListener("click", (e) => { e.preventDefault(); toast(SOON[k] ?? tr("toast.soon")); });
  }
});
$$("[data-text='phone']").forEach((el) => {
  el.textContent = LINKS.phone.replace(/^(\+998)(\d{2})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5");
});
$("#year").textContent = new Date().getFullYear();

// ── So'zlarga bo'lish (nbsp saqlanadi; <em> ichidagi so'zlar ko'k qoladi) ──
function splitWords(el, wrapClass = "w", innerClass = "wi") {
  const walk = (node, inEm) => {
    [...node.childNodes].forEach((ch) => {
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        ch.textContent.split(/([ \t\n\r]+)/).forEach((w) => {
          if (!w) return;
          if (/^[ \t\n\r]+$/.test(w)) { frag.append(" "); return; }
          const o = document.createElement("span");
          o.className = wrapClass;
          if (innerClass) {
            const i = document.createElement(inEm ? "em" : "span");
            i.className = innerClass;
            i.textContent = w;
            o.append(i);
          } else o.textContent = w;
          frag.append(o);
        });
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && ch.tagName !== "BR") {
        const isEm = ch.tagName === "EM";
        walk(ch, inEm || isEm);
        if (isEm) ch.replaceWith(...ch.childNodes);
      }
    });
  };
  walk(el, false);
}
$$(".split").forEach((el) => splitWords(el));
$$(".panel-title").forEach((el) => { el.classList.add("split"); splitWords(el); });
splitWords($("#manifestText"), "mw", null);

// ── Menyu ──
const header = $("#header");
const nav = $("#nav");
const burger = $("#burger");
burger.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  burger.setAttribute("aria-expanded", String(open));
});
$$(".nav a").forEach((a) => a.addEventListener("click", () => { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }));

const words = (el) => (el ? el.querySelectorAll(".wi") : []);
const showWords = (el, opts = {}) => gsap.to(words(el), { y: 0, duration: 1.1, stagger: 0.05, ease: "expo.out", ...opts });

// ── Yuklanish: 000 → 100 ──
function runLoader(ready) {
  const num = $("#loadNum");
  const o = { v: 0 };
  return new Promise((resolve) => {
    gsap.to(o, {
      v: 100, duration: reducedMotion || skipLoader ? 0.15 : 1.8, ease: "power2.inOut",
      onUpdate: () => {
        num.textContent = String(Math.round(o.v)).padStart(3, "0");
        gsap.set("#loadBar", { scaleX: o.v / 100 });
      },
      onComplete: async () => {
        await ready;
        gsap.timeline({ onComplete: resolve })
          .to(".loader-count, .loader-top", { yPercent: -40, opacity: 0, duration: 0.6, ease: "power3.in" })
          .to("#loader", { yPercent: -100, duration: 1, ease: "expo.inOut" }, "-=0.2")
          .set("#loader", { display: "none" });
      },
    });
  });
}

function chrome() {
  ScrollTrigger.create({ start: 40, end: "max", onToggle: (s) => header.classList.toggle("scrolled", s.isActive) });
  gsap.to("#progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
  [["#imkoniyatlar", "imkoniyatlar"], ["#salon", "salon", "#spa"], ["#narxlar", "narxlar"], ["#biz-haqimizda", "biz-haqimizda"]]
    .forEach(([sel, id, endSel]) => {
      const link = $(`.nav a[href="#${id}"]`);
      ScrollTrigger.create({ trigger: sel, endTrigger: endSel ?? sel, start: "top 55%", end: "bottom 45%", onToggle: (s) => link.classList.toggle("active", s.isActive) });
    });
  const dots = $("#dots");
  ScrollTrigger.create({ trigger: "#salon", endTrigger: "#spa", start: "top 60%", end: "bottom 40%", onToggle: (s) => dots.classList.toggle("show", s.isActive) });
  ["#salon", "#dental", "#ent", "#spa"].forEach((sel, i) => {
    ScrollTrigger.create({ trigger: sel, start: "top 50%", end: "bottom 50%", onToggle: (s) => s.isActive && $$("#dots a").forEach((a, j) => a.classList.toggle("on", i === j)) });
  });
}

function intro() {
  const tl = gsap.timeline({ defaults: { ease: "expo.out", duration: 1.3 } });
  tl.from(".header", { yPercent: -100, opacity: 0, duration: 1 }, 0)
    .add(showWords($(".hero h1"), { stagger: 0.06, duration: 1.4 }), 0.05)
    .fromTo(".hero .reveal", { opacity: 0, y: 26 }, { opacity: 1, y: 0, stagger: 0.1 }, 0.4);
  $$("[data-count]").forEach((el) => {
    const o = { v: 0 };
    gsap.to(o, { v: +el.dataset.count, duration: 2, delay: 0.7, ease: "power3.out", onUpdate: () => { el.textContent = Math.round(o.v) + (el.dataset.suffix ?? ""); } });
  });
}

// ── Manifest: sochilgan so'zlar scroll bilan jumlaga yig'iladi ──
function manifest() {
  const ws = $$("#manifestText .mw");
  const spread = mobile() ? 0.55 : 1;
  ws.forEach((w) => gsap.set(w, {
    x: gsap.utils.random(-0.42, 0.42) * window.innerWidth * spread,
    y: gsap.utils.random(-0.38, 0.38) * window.innerHeight,
    rotate: gsap.utils.random(-35, 35), scale: gsap.utils.random(0.55, 1.5), opacity: gsap.utils.random(0.08, 0.3),
  }));
  const tl = gsap.timeline({ scrollTrigger: { trigger: ".manifest", start: "top top", end: "bottom bottom", scrub: 1 } });
  tl.to(ws, { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, ease: "power3.out", duration: 1, stagger: { each: 0.012, from: "random" } })
    .to({}, { duration: 0.35 });
  gsap.fromTo("#manifestText", { opacity: 0 }, { opacity: 1, ease: "none", scrollTrigger: { trigger: ".manifest", start: "top 85%", end: "top 20%", scrub: true } });
  gsap.fromTo(".manifest .label", { opacity: 0 }, { opacity: 1, scrollTrigger: { trigger: ".manifest", start: "top 60%", end: "top top", scrub: true } });
}

function verticals() {
  $$(".vertical").forEach((sec) => {
    const c = sec.querySelector(".v-copy");
    const right = sec.classList.contains("right");
    const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: "top 62%", end: "bottom 38%", toggleActions: "play reverse play reverse" } });
    tl.fromTo(c.querySelectorAll(".v-num, .eyebrow"), { opacity: 0, x: right ? 24 : -24 }, { opacity: 1, x: 0, duration: 0.7, stagger: 0.08, ease: "power3.out" })
      .add(showWords(c.querySelector("h2"), { stagger: 0.04 }), 0.05)
      .fromTo(c.querySelector("p:not(.eyebrow)"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.3)
      .fromTo(c.querySelector(".ticks"), { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0.4)
      .fromTo(c.querySelectorAll(".ticks li"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.07, ease: "power3.out" }, 0.4)
      .fromTo(c.querySelector(".mini-ui"), { opacity: 0, y: 40, rotateY: right ? -16 : 16, rotateX: 8, transformPerspective: 900 }, { opacity: 1, y: 0, rotateY: 0, rotateX: 0, duration: 1.1, ease: "expo.out" }, 0.5)
      .fromTo(c.querySelectorAll(".mu-row, .chips span, .wave"), { opacity: 0, x: 22 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.07, ease: "power2.out" }, 0.75);
  });
}

function mega() {
  $$(".mega-row").forEach((row) => {
    const dir = +row.dataset.dir;
    gsap.fromTo(row, { xPercent: dir < 0 ? 0 : -30 }, { xPercent: dir < 0 ? -30 : 0, ease: "none", scrollTrigger: { trigger: ".mega", start: "top bottom", end: "bottom top", scrub: 0.6 } });
  });
}

// ── Ustma-ust panellar: keyingisi kelganda oldingisi kichrayib, xiralashadi ──
function panels() {
  const ps = $$(".panel");
  ps.forEach((p, i) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: p, start: "top 65%" } });
    tl.add(showWords(p.querySelector(".panel-title"), { duration: 1.2 }))
      .from(p.querySelectorAll(".panel-grid > *"), { opacity: 0, y: 30, stagger: 0.1, duration: 0.9, ease: "power3.out" }, 0.3)
      .from(p.querySelector(".panel-num"), { yPercent: 60, opacity: 0, duration: 1, ease: "expo.out" }, 0);
    if (ps[i + 1]) {
      gsap.to(p, { scale: 0.94, filter: "brightness(0.6)", transformOrigin: "50% 0%", ease: "none", scrollTrigger: { trigger: ps[i + 1], start: "top 70%", end: "top top", scrub: true } });
    }
  });
  gsap.to(".pg-ring .fill", { strokeDashoffset: 314 * (1 - 0.87), duration: 1.6, ease: "power3.out", scrollTrigger: { trigger: ".pg-ring", start: "top 85%" } });
  gsap.from(".pg-bars i", { scaleY: 0, stagger: 0.07, duration: 1, ease: "back.out(1.6)", scrollTrigger: { trigger: ".pg-bars", start: "top 90%" } });
  gsap.from(".pg-cal i", { scaleX: 0, transformOrigin: "left", stagger: 0.08, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: ".pg-cal", start: "top 90%" } });
}

// ── Qadamlar: ekran mahkamlanadi, scroll bilan 01 → 02 → 03 ──
function steps() {
  const items = $$(".step");
  const labels = $$(".steps-list li");
  const now = $("#stepNow");
  let cur = -1;
  const go = (i) => {
    if (i === cur) return;
    const prev = items[cur];
    const down = i > cur;
    cur = i;
    if (prev) gsap.to(prev, { opacity: 0, y: down ? -50 : 50, duration: 0.5, ease: "power2.in", overwrite: true });
    const el = items[i];
    gsap.fromTo(el, { opacity: 0, y: down ? 60 : -60 }, { opacity: 1, y: 0, duration: 0.9, ease: "expo.out", delay: prev ? 0.2 : 0, overwrite: true });
    gsap.fromTo(el.querySelector(".step-big"), { yPercent: down ? 25 : -25 }, { yPercent: 0, duration: 1.2, ease: "expo.out", delay: prev ? 0.2 : 0 });
    labels.forEach((l, j) => l.classList.toggle("on", j === i));
    now.textContent = String(i + 1).padStart(2, "0");
  };
  gsap.set(items, { opacity: 0 });
  go(0);
  ScrollTrigger.create({
    trigger: ".steps", start: "top top", end: "bottom bottom",
    onUpdate: (s) => { go(Math.min(items.length - 1, Math.floor(s.progress * items.length))); gsap.set("#stepLine", { scaleX: s.progress }); },
  });
}

function sections() {
  $$(".section-head, .about-grid > div:first-child, .footer-cta").forEach((h) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: h, start: "top 80%" } });
    const label = h.querySelector(".label");
    if (label) tl.fromTo(label, { opacity: 0 }, { opacity: 1, duration: 0.6 });
    tl.add(showWords(h.querySelector("h2")), 0.05)
      .fromTo(h.querySelectorAll(":scope > p:not(.label), :scope > .stores"), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.1 }, 0.3);
  });
  ScrollTrigger.batch(".price, .contact", {
    start: "top 88%", once: true,
    onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 1.1, stagger: 0.1, ease: "expo.out" }),
  });
  // Ulkan "Chronix" yozuvi harflari pastdan ko'tariladi
  gsap.fromTo(".wordmark span", { yPercent: 100 }, {
    yPercent: 0, stagger: 0.06, ease: "power3.out",
    scrollTrigger: { trigger: ".wordmark", start: "top bottom", end: "bottom bottom", scrub: 0.8 },
  });
}

// ── Sichqoncha effektlari ──
function pointerFx() {
  if (reducedMotion || !finePointer) return;
  $$(".btn, .store").forEach((b) => {
    const xTo = gsap.quickTo(b, "x", { duration: 0.5, ease: "power3.out" });
    const yTo = gsap.quickTo(b, "y", { duration: 0.5, ease: "power3.out" });
    b.addEventListener("pointermove", (e) => {
      const r = b.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.22);
      yTo((e.clientY - r.top - r.height / 2) * 0.32);
    });
    b.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
  });
  const glow = $("#glow");
  const gx = gsap.quickTo(glow, "x", { duration: 0.8, ease: "power3.out" });
  const gy = gsap.quickTo(glow, "y", { duration: 0.8, ease: "power3.out" });
  window.addEventListener("pointermove", (e) => { glow.classList.add("on"); gx(e.clientX); gy(e.clientY); }, { passive: true });
}

// ── Hero kartalari 3D halqa atrofida ──
const cards = $$(".float-card");
const CARD_SPOTS = [[0.3, -1.1], [0.92, 1.14], [1.22, -0.2]];
function placeCards({ hero }) {
  if (window.innerWidth < 1024) return;
  cards.forEach((c, i) => {
    const [kx, ky] = CARD_SPOTS[i];
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const x = Math.min(window.innerWidth - w - 16, Math.max(16, hero.x + kx * hero.r - w / 2));
    const y = hero.y + ky * hero.r - h / 2;
    const k = gsap.utils.clamp(0, 1, (hero.mix - 0.35 - i * 0.12) / 0.4);
    c.style.opacity = k.toFixed(3);
    c.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + (1 - k) * 30).toFixed(1)}px, 0) scale(${(0.9 + 0.1 * k).toFixed(3)})`;
  });
}

async function initScene() {
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return false;
    const { createScene } = await import("./scene.js");
    const tint = { salon: "#46464e", dental: "#3e434b", ent: "#24366a", spa: "#43464a" };
    const list = [
      { el: $(".hero"), group: "hero", side: 1, accent: "#22346a" },
      ...$$(".vertical").map((el) => ({ el, group: el.dataset.scene, side: el.classList.contains("right") ? -1 : 1, accent: tint[el.dataset.scene] })),
    ];
    createScene($("#scene"), { sections: list, reducedMotion, onFrame: placeCards });
    return true;
  } catch (err) {
    console.warn("3D sahna yuklanmadi", err);
    return false;
  }
}

const sceneReady = new Promise((resolve) => {
  const start = async () => resolve(await initScene());
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
});

runLoader(sceneReady).then(async () => {
  const ok = await sceneReady;
  if (!ok) cards.forEach((c) => { c.style.display = "none"; });
  document.body.classList.remove("loading");
  lenis?.start();
  chrome();
  intro();
  manifest();
  verticals();
  mega();
  panels();
  steps();
  sections();
  pointerFx();
  ScrollTrigger.refresh();
  if (skipLoader) {
    // Til almashgandan keyin o'sha joyga qaytish
    let y = 0;
    try { y = Number(sessionStorage.getItem("chronix-scroll")) || 0; sessionStorage.removeItem("chronix-scroll"); } catch { /* */ }
    if (y > 0) {
      window.scrollTo(0, y);
      lenis?.scrollTo(y, { immediate: true, force: true });
      ScrollTrigger.update();
    }
  }
});
