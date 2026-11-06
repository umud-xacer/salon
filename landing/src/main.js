import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LINKS, PLANS } from "./config.js";

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add("js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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
  const key = a.dataset.link;
  let href = LINKS[key];
  if (key === "phone" && href) href = `tel:${href.replace(/\s/g, "")}`;
  if (href) {
    a.href = href;
    if (/^https?:/.test(href) && key !== "panel") { a.target = "_blank"; a.rel = "noopener"; }
  } else {
    a.addEventListener("click", (e) => { e.preventDefault(); toast(SOON[key] ?? "Tez orada!"); });
  }
});
$$("[data-text='phone']").forEach((el) => {
  el.textContent = LINKS.phone.replace(/^(\+998)(\d{2})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5");
});
$("#year").textContent = new Date().getFullYear();

// ── Tariflar ──
$("#prices").innerHTML = PLANS.map((p) => `
  <article class="price glass${p.featured ? " featured" : ""}">
    <span class="tag">${p.note}</span>
    <h3>${p.name}</h3>
    <div class="amount">${p.price}</div>
    <div class="per">${p.period}</div>
    <ul>${p.features.map((f) => `<li>${f}</li>`).join("")}</ul>
    <a class="btn ${p.featured ? "btn-primary" : "btn-ghost"}" href="#aloqa">Ulanish</a>
  </article>`).join("");

// ── Header: scroll soyasi, burger, faol menyu ──
const header = $("#header");
const nav = $("#nav");
const burger = $("#burger");
ScrollTrigger.create({ start: 40, end: "max", onToggle: (self) => header.classList.toggle("scrolled", self.isActive) });
burger.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  burger.setAttribute("aria-expanded", String(open));
});
$$(".nav a").forEach((a) => a.addEventListener("click", () => { nav.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); }));
[["#imkoniyatlar", "imkoniyatlar"], ["[data-scene='salon']", "yonalishlar"], ["#narxlar", "narxlar"], ["#biz-haqimizda", "biz-haqimizda"]]
  .forEach(([sel, id]) => {
    const link = $(`.nav a[href="#${id}"]`);
    const end = id === "yonalishlar" ? "[data-scene='spa']" : sel;
    ScrollTrigger.create({
      trigger: sel, endTrigger: end, start: "top 55%", end: "bottom 45%",
      onToggle: (self) => link.classList.toggle("active", self.isActive),
    });
  });

// ── Kirish animatsiyalari ──
function intro() {
  const tl = gsap.timeline({ defaults: { ease: "expo.out", duration: 1.2 } });
  tl.fromTo(".hero .reveal", { opacity: 0, y: 40, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", stagger: 0.09 })
    .from(".float-card", { opacity: 0, scale: 0.8, y: 30, stagger: 0.15 }, "-=0.9")
    .from(".header", { y: -40, opacity: 0, duration: 1 }, 0);
  $$("[data-count]").forEach((el) => {
    const o = { v: 0 };
    gsap.to(o, {
      v: +el.dataset.count, duration: 1.8, delay: 0.5, ease: "power2.out",
      onUpdate: () => { el.textContent = Math.round(o.v) + (el.dataset.suffix ?? ""); },
    });
  });
}

function reveals() {
  $$(".vertical").forEach((sec) => {
    gsap.fromTo(sec.querySelectorAll(".v-copy > *"), { opacity: 0, y: 50 }, {
      opacity: 1, y: 0, duration: 1, stagger: 0.08, ease: "power3.out",
      scrollTrigger: { trigger: sec, start: "top 65%" },
    });
  });
  $$(".section-head").forEach((h) => gsap.fromTo(h.children, { opacity: 0, y: 30 }, {
    opacity: 1, y: 0, duration: 0.9, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger: h, start: "top 80%" },
  }));
  [".card", ".steps li", ".price"].forEach((sel) => {
    ScrollTrigger.batch(sel, {
      start: "top 88%",
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 60, rotateX: -12 }, {
        opacity: 1, y: 0, rotateX: 0, duration: 1, stagger: 0.08, ease: "power3.out", overwrite: true,
      }),
    });
  });
  gsap.from(".bars i", { scaleY: 0, stagger: 0.06, duration: 0.9, ease: "back.out(1.6)", scrollTrigger: { trigger: ".bars", start: "top 90%" } });
  gsap.from(".cal i", { scaleX: 0, transformOrigin: "left", stagger: 0.07, duration: 0.7, ease: "power3.out", scrollTrigger: { trigger: ".cal", start: "top 90%" } });
  gsap.from(".cta h2", { opacity: 0, scale: 0.92, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: ".cta", start: "top 75%" } });
}

// ── Kartalarga 3D egilish ──
function tilt() {
  if (reducedMotion || window.matchMedia("(hover: none)").matches) return;
  $$(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);
      gsap.to(card, { rotateY: (x - 0.5) * 10, rotateX: (0.5 - y) * 10, transformPerspective: 900, duration: 0.4, ease: "power2.out" });
    });
    card.addEventListener("pointerleave", () => gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.6, ease: "power3.out" }));
  });
}

// ── 3D sahna (WebGL bo'lmasa — sahifa baribir to'liq ishlaydi) ──
async function initScene() {
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
    const { createScene } = await import("./scene.js");
    const s = createScene($("#scene"), { reducedMotion });
    s.show("hero", { side: 1, el: $(".hero") });
    $$("[data-scene]").forEach((sec) => {
      const name = sec.dataset.scene;
      const side = sec.classList.contains("right") ? -1 : 1;
      // Imkoniyatlar, narxlar, biz haqimizda — kartalar ortida obyekt bo'lmaydi
      const go = () => name === "none" ? s.show(null) : s.show(name, { side: name === "cta" ? 0 : side, dim: name === "cta" ? 1 : 0, el: sec });
      ScrollTrigger.create({ trigger: sec, start: "top 55%", end: "bottom 45%", onEnter: go, onEnterBack: go });
    });
    ScrollTrigger.create({
      start: 0, end: "max",
      onUpdate: (self) => { s.setSpin(self.progress * Math.PI * 4); s.setStarsDrift(self.progress * 3); },
    });
  } catch (err) {
    console.warn("3D sahna yuklanmadi", err);
  }
}

window.addEventListener("load", async () => {
  await initScene();
  $("#loader").classList.add("done");
  intro();
  reveals();
  tilt();
  ScrollTrigger.refresh();
});
