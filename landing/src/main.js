import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { LINKS, PLANS } from "./config.js";

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add("js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ── Silliq scroll (Lenis) — ScrollTrigger bilan bitta soatda ──
let lenis = null;
if (!reducedMotion) {
  lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
function scrollToHash(hash) {
  const target = hash === "#top" ? 0 : $(hash);
  if (target === null) return;
  if (lenis) lenis.scrollTo(target, { offset: hash === "#top" ? 0 : -84, duration: 1.4 });
  else if (target === 0) window.scrollTo({ top: 0 });
  else target.scrollIntoView();
}
$$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
  const hash = a.getAttribute("href");
  if (hash.length < 2) return;
  e.preventDefault();
  scrollToHash(hash);
}));

// ── Toast ──
const toastEl = $("#toast");
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// ── Havolalar (config.js) ──
const SOON = { play: "Google Play'da tez orada!", appstore: "App Store'da tez orada!" };
$$("[data-link]").forEach((a) => {
  const k = a.dataset.link;
  let href = LINKS[k];
  if (k === "phone" && href) href = `tel:${href.replace(/\s/g, "")}`;
  if (href) {
    a.href = href;
    if (/^https?:/.test(href) && k !== "panel") { a.target = "_blank"; a.rel = "noopener"; }
  } else {
    a.addEventListener("click", (e) => { e.preventDefault(); toast(SOON[k] ?? "Tez orada!"); });
  }
});
$$("[data-text='phone']").forEach((el) => {
  el.textContent = LINKS.phone.replace(/^(\+998)(\d{2})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5");
});
$("#year").textContent = new Date().getFullYear();

// ── Tariflar ──
$("#prices").innerHTML = PLANS.map((p) => `
  <article class="price glass tilt${p.featured ? " featured" : ""}">
    <span class="tag">${p.note}</span>
    <h3>${p.name}</h3>
    <div class="amount">${p.price}</div>
    <div class="per">${p.period}</div>
    <ul>${p.features.map((f) => `<li>${f}</li>`).join("")}</ul>
    <a class="btn ${p.featured ? "btn-primary" : "btn-ghost"}" href="#aloqa">Ulanish</a>
  </article>`).join("");
$$('#prices a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); scrollToHash("#aloqa"); }));

// ── Sarlavhalarni so'zlarga bo'lish (nbsp saqlanadi: "uchun — " bir qatorda) ──
function splitWords(el) {
  const walk = (node, inGrad) => {
    [...node.childNodes].forEach((ch) => {
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        ch.textContent.split(/([ \t\n\r]+)/).forEach((w) => {
          if (!w) return;
          if (/^[ \t\n\r]+$/.test(w)) { frag.append(" "); return; }
          const o = document.createElement("span");
          o.className = "w";
          const i = document.createElement("span");
          i.className = inGrad ? "wi grad" : "wi";
          i.textContent = w;
          o.append(i);
          frag.append(o);
        });
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && ch.tagName !== "BR") {
        const g = ch.classList.contains("grad");
        if (g) ch.classList.replace("grad", "grad-host");
        walk(ch, inGrad || g);
      }
    });
  };
  walk(el, false);
}
$$(".split").forEach(splitWords);

// ── Header, menyu, scroll ko'rsatkichi, yon navigatsiya ──
const header = $("#header");
const nav = $("#nav");
const burger = $("#burger");
burger.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  burger.setAttribute("aria-expanded", String(open));
});
$$(".nav a").forEach((a) => a.addEventListener("click", () => { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }));

function chrome() {
  ScrollTrigger.create({ start: 40, end: "max", onToggle: (s) => header.classList.toggle("scrolled", s.isActive) });
  gsap.to("#progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
  [["#imkoniyatlar", "imkoniyatlar"], ["#salon", "yonalishlar", "#spa"], ["#narxlar", "narxlar"], ["#biz-haqimizda", "biz-haqimizda"]]
    .forEach(([sel, id, endSel]) => {
      const link = $(`.nav a[href="#${id}"]`);
      ScrollTrigger.create({
        trigger: sel, endTrigger: endSel ?? sel, start: "top 55%", end: "bottom 45%",
        onToggle: (s) => link.classList.toggle("active", s.isActive),
      });
    });
  const dots = $("#dots");
  ScrollTrigger.create({ trigger: "#salon", endTrigger: "#spa", start: "top 60%", end: "bottom 40%", onToggle: (s) => dots.classList.toggle("show", s.isActive) });
  ["#salon", "#dental", "#ent", "#spa"].forEach((sel, i) => {
    ScrollTrigger.create({
      trigger: sel, start: "top 50%", end: "bottom 50%",
      onToggle: (s) => s.isActive && $$("#dots a").forEach((a, j) => a.classList.toggle("on", i === j)),
    });
  });
}

// ── Animatsiyalar ──
const words = (el) => el.querySelectorAll(".wi");

function intro() {
  const tl = gsap.timeline({ defaults: { ease: "expo.out", duration: 1.3 } });
  tl.from(".header", { y: -40, opacity: 0, duration: 1 }, 0)
    .to(words($(".hero h1")), { y: 0, rotate: 0, stagger: 0.06 }, 0.15)
    .fromTo(".hero .reveal", { opacity: 0, y: 34, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: 0.1 }, 0.35);
  $$("[data-count]").forEach((el) => {
    const o = { v: 0 };
    gsap.to(o, {
      v: +el.dataset.count, duration: 2, delay: 0.8, ease: "power3.out",
      onUpdate: () => { el.textContent = Math.round(o.v) + (el.dataset.suffix ?? ""); },
    });
  });
}

function reveals() {
  // 4 yo'nalish: matn 3D obyekt bilan bir vaqtda kiradi va orqaga scroll qilinganda qaytadi
  $$(".vertical").forEach((sec) => {
    const copy = sec.querySelector(".v-copy");
    const right = sec.classList.contains("right");
    const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: "top 62%", end: "bottom 38%", toggleActions: "play reverse play reverse" } });
    tl.fromTo(copy.querySelector(".eyebrow"), { opacity: 0, x: right ? 30 : -30 }, { opacity: 1, x: 0, duration: 0.7, ease: "power3.out" })
      .to(words(copy.querySelector("h2")), { y: 0, rotate: 0, duration: 1, stagger: 0.045, ease: "expo.out" }, 0.05)
      .fromTo(copy.querySelector("h2"), { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0)
      .fromTo(copy.querySelector("p:not(.eyebrow)"), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.3)
      .fromTo(copy.querySelectorAll(".ticks li"), { opacity: 0, x: right ? 24 : -24 }, { opacity: 1, x: 0, duration: 0.6, stagger: 0.08, ease: "power3.out" }, 0.4)
      .fromTo(copy.querySelector(".ticks"), { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0.4)
      .fromTo(copy.querySelector(".mini-ui"),
        { opacity: 0, y: 40, rotateY: right ? -18 : 18, rotateX: 8, transformPerspective: 900 },
        { opacity: 1, y: 0, rotateY: 0, rotateX: 0, duration: 1.1, ease: "expo.out" }, 0.5)
      .fromTo(copy.querySelectorAll(".mu-row, .chips span, .wave"), { opacity: 0, x: 26 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.07, ease: "power2.out" }, 0.75)
      .fromTo(copy.querySelector(".v-num"), { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0);
    // katta raqam scroll bilan suzadi
    gsap.fromTo(copy.querySelector(".v-num"), { yPercent: 60 }, { yPercent: -60, ease: "none", scrollTrigger: { trigger: sec, scrub: true } });
  });

  $$(".section-head, .about-grid > div:first-child").forEach((h) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: h, start: "top 82%" } });
    tl.fromTo(h.querySelector(".eyebrow"), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 })
      .fromTo(h.querySelector("h2"), { opacity: 0 }, { opacity: 1, duration: 0.01 }, 0)
      .to(words(h.querySelector("h2")), { y: 0, rotate: 0, duration: 1, stagger: 0.05, ease: "expo.out" }, 0.05)
      .fromTo(h.querySelectorAll("p:not(.eyebrow)"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.1 }, 0.3);
  });

  [".card", ".steps li", ".price", ".contact"].forEach((sel) => {
    ScrollTrigger.batch(sel, {
      start: "top 90%", once: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 70, scale: 0.96 }, {
        opacity: 1, y: 0, scale: 1, duration: 1.1, stagger: 0.09, ease: "expo.out",
        clearProps: "transform", onComplete() { els.forEach((e) => e.classList.add("ready")); },
      }),
    });
  });
  gsap.from(".bars i", { scaleY: 0, stagger: 0.07, duration: 1, ease: "back.out(1.7)", scrollTrigger: { trigger: ".bars", start: "top 92%" } });
  gsap.from(".cal i", { scaleX: 0, transformOrigin: "left", stagger: 0.08, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: ".cal", start: "top 92%" } });

  const cta = $(".cta");
  gsap.timeline({ scrollTrigger: { trigger: cta, start: "top 72%" } })
    .fromTo(cta.querySelector("h2"), { opacity: 0 }, { opacity: 1, duration: 0.01 })
    .to(words(cta.querySelector("h2")), { y: 0, rotate: 0, duration: 1.1, stagger: 0.05, ease: "expo.out" })
    .from(cta.querySelectorAll(".store"), { opacity: 0, y: 30, stagger: 0.1, duration: 0.8, ease: "power3.out" }, 0.4);

  // Yugurik qator scroll tezligiga qarab qiyshayadi
  const skew = gsap.quickTo(".marquee", "skewY", { duration: 0.5, ease: "power3.out" });
  ScrollTrigger.create({ start: 0, end: "max", onUpdate: (s) => skew(gsap.utils.clamp(-1.6, 1.6, s.getVelocity() / -1500)) });
}

// ── Kartalarga 3D egilish va magnit tugmalar ──
function pointerFx() {
  if (reducedMotion || !finePointer) return;
  $$(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      if (!card.classList.contains("ready")) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);
      gsap.to(card, { rotateY: (x - 0.5) * 9, rotateX: (0.5 - y) * 9, transformPerspective: 1000, duration: 0.4, ease: "power2.out", overwrite: "auto" });
    });
    card.addEventListener("pointerleave", () => gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.7, ease: "power3.out", overwrite: "auto" }));
  });
  $$(".btn, .store").forEach((b) => {
    const xTo = gsap.quickTo(b, "x", { duration: 0.5, ease: "power3.out" });
    const yTo = gsap.quickTo(b, "y", { duration: 0.5, ease: "power3.out" });
    b.addEventListener("pointermove", (e) => {
      const r = b.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * 0.25);
      yTo((e.clientY - r.top - r.height / 2) * 0.35);
    });
    b.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
  });
  const glow = $("#glow");
  const gx = gsap.quickTo(glow, "x", { duration: 0.8, ease: "power3.out" });
  const gy = gsap.quickTo(glow, "y", { duration: 0.8, ease: "power3.out" });
  window.addEventListener("pointermove", (e) => { glow.classList.add("on"); gx(e.clientX); gy(e.clientY); }, { passive: true });
}

// ── Hero kartalari 3D halqa atrofida (ustiga chiqmaydi) ──
const cards = $$(".float-card");
const CARD_SPOTS = [[0.5, -1.04], [1.12, 0.62], [-0.5, 1.06]];   // halqa radiusiga nisbatan
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

// ── 3D sahna (WebGL bo'lmasa — sahifa baribir to'liq ishlaydi) ──
async function initScene() {
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return false;
    const { createScene } = await import("./scene.js");
    const accent = (sec, fallback) => getComputedStyle(sec).getPropertyValue("--accent").trim() || fallback;
    const sections = [
      { el: $(".hero"), group: "hero", side: 1, accent: "#1565f5" },
      ...$$(".vertical").map((el) => ({ el, group: el.dataset.scene, side: el.classList.contains("right") ? -1 : 1, accent: accent(el, "#1565f5") })),
    ];
    createScene($("#scene"), { sections, reducedMotion, onFrame: placeCards });
    return true;
  } catch (err) {
    console.warn("3D sahna yuklanmadi", err);
    return false;
  }
}

window.addEventListener("load", async () => {
  const ok = await initScene();
  if (!ok) cards.forEach((c) => { c.style.display = "none"; });
  $("#loader").classList.add("done");
  chrome();
  intro();
  reveals();
  pointerFx();
  ScrollTrigger.refresh();
});
