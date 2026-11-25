// Mijoz xaritasi WebView ichida: Yandex Maps JS API (kalit serverdan kelsa) yoki OpenStreetMap (Leaflet, kalitsiz).
// Ikkalasida bir xil window API: setMarkers, setMe, flyTo, locateDone — RN tomoni bitta.
// Salon nomlari va rasm manzillari belgiga ekranlab (esc) qo'yiladi.
import { ComponentType, createElement, RefObject, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { BusinessCard } from './api';
import { mapKind } from './categories';
import { t } from './i18n';

// OSM xarita rasmlari Referer'siz bloklanadi: sahifa shu manzildan ochilgandek ko'rinadi
const BASE_URL = 'https://chronix.uz/';

// WebView klassining turlari React 19 bilan to'g'ri ishlamaydi
const MapView = WebView as unknown as ComponentType<WebViewProps & { ref: RefObject<WebView | null> }>;

export type Bounds = { sw: [number, number]; ne: [number, number] };

type Point = { latitude: number; longitude: number };
export type Gender = 'male' | 'female' | null | undefined;

// Foydalanuvchi o'zi — jinsiga mos odamcha: o'g'il (ko'k), qiz (pushti, soch va ko'ylak), belgilanmagan (binafsha).
// Atrofida yarim shaffof halqa — "siz shu yerdasiz". WebView ichidagi JS (meSvg) — ikkala xaritada bir xil.
const ME_JS = `
  const meSvg = (g) => {
    const c = g === 'male' ? '#2F80ED' : g === 'female' ? '#E0458B' : '#6B4EFF';
    const body = g === 'female'
      ? '<path d="M14 15.5c0-4 2.7-6.5 6-6.5s6 2.5 6 6.5v4.5h-12z" fill="#5B3A29"/>'
        + '<circle cx="20" cy="16" r="4.6" fill="#F6C9A8"/>'
        + '<path d="M20 21.5l8.5 12h-17z" fill="' + c + '"/>'
      : '<circle cx="20" cy="15" r="5" fill="#F6C9A8"/>'
        + (g === 'male' ? '<path d="M15 14c0-3.6 2.3-5.6 5-5.6s5 2 5 5.6c-1.6-1.4-3.2-2-5-2s-3.4.6-5 2z" fill="#3B2A20"/>' : '')
        + '<path d="M10.5 33.5c0-6 4.2-10 9.5-10s9.5 4 9.5 10z" fill="' + c + '"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="-2 -2 44 44">'
      + '<circle cx="20" cy="20" r="21" fill="' + c + '" fill-opacity=".18"/>'
      + '<circle cx="20" cy="20" r="16.5" fill="#fff" stroke="' + c + '" stroke-width="2.5"/>'
      + '<clipPath id="mc"><circle cx="20" cy="20" r="15"/></clipPath><g clip-path="url(#mc)">' + body + '</g></svg>';
  };
`;

type Props = {
  center: Point;
  me?: Point | null;
  businesses: BusinessCard[];
  onBounds: (bounds: Bounds) => void;
  onSelect: (id: number) => void;
  onError: () => void;
  /** Tanlangan muassasa (pin ajralib turadi) */
  selectedId?: number | null;
  /** Xaritaning bo'sh joyi bosildi — preview yopiladi */
  onTapMap?: () => void;
  /** "Mening joyim" tugmasi: joylashuvni topib qaytaradi (ruxsat yo'q bo'lsa null) */
  onLocate?: () => Promise<Point | null>;
  /** Bo'lmasa — OpenStreetMap. Yandex yuklanmasa onError chaqiriladi, chaqiruvchi OSM ga o'tkazadi */
  yandexKey?: string | null;
  /** Xarita tugmalari (+/−, joylashuv) yuqoridan shuncha px pastda, o'ngda — pastki panel ularni to'smasin */
  controlsTop?: number;
  /** Shu nuqtaga markazlash (yangi obyekt berilganda bir marta; xarita tayyor bo'lmasa — tayyor bo'lgach) */
  focus?: Point | null;
  /** Profildagi jins — o'z joylashuvidagi odamcha ikonkasi */
  gender?: Gender;
};

// Xarita tugmalari (2026-11-24 dizayn): o'ngda, qidiruv paneli ostida — oq "kapsula" ichida + / − va alohida
// binafsha gradientli "Mening joyim" (navigatsiya strelkasi). Qidirayotganda strelka aylanadi, atrofida to'lqin.
// Xaritaning o'z tugmalari o'chirilgan — Yandex va OSM da ko'rinish bir xil. window.zoomBy(±1) — xarita JS'ida.
const CTL_CSS = (top: number) => `
  .ctl{position:absolute;right:12px;top:${top}px;z-index:3000;display:flex;flex-direction:column;align-items:center;gap:12px;
       -webkit-tap-highlight-color:transparent;user-select:none}
  .zoom{display:flex;flex-direction:column;width:46px;border-radius:23px;background:rgba(255,255,255,.96);overflow:hidden;
        box-shadow:0 6px 18px rgba(17,17,20,.16),0 1px 3px rgba(17,17,20,.12)}
  .zoom button{width:46px;height:46px;border:0;background:transparent;display:flex;align-items:center;justify-content:center;
               color:#16161D;padding:0;transition:background .15s}
  .zoom button:active{background:#EFEBFF}
  .zoom i{display:block;height:1px;margin:0 11px;background:#E6E6EE}
  .loc{position:relative;width:52px;height:52px;border:0;border-radius:50%;padding:0;color:#fff;
       background:linear-gradient(145deg,#8B74FF 0%,#6B4EFF 55%,#4B2FE0 100%);
       box-shadow:0 10px 22px -6px rgba(107,78,255,.75),inset 0 1px 0 rgba(255,255,255,.35);
       display:flex;align-items:center;justify-content:center;transition:transform .12s}
  .loc:active{transform:scale(.9)}
  .loc svg{transition:transform .3s}
  .loc:before{content:'';position:absolute;inset:0;border-radius:50%;border:2px solid #8B74FF;opacity:0}
  .loc.busy svg{animation:locspin 1s linear infinite}
  .loc.busy:before{animation:locwave 1.1s ease-out infinite}
  @keyframes locspin{to{transform:rotate(360deg)}}
  @keyframes locwave{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.7);opacity:0}}
`;
const CTL_HTML = `<div class="ctl">
  <div class="zoom">
    <button id="zin" aria-label="Yaqinlashtirish"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <i></i>
    <button id="zout" aria-label="Uzoqlashtirish"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
  </div>
  <button id="loc" class="loc" aria-label="Mening joyim"><svg width="24" height="24" viewBox="0 0 24 24">
    <path d="M20.6 3.4 3.9 10.3c-.8.3-.7 1.5.1 1.7l6.6 1.6 1.6 6.6c.2.8 1.4.9 1.7.1l6.9-16.7c.2-.5-.3-1-.8-.8z" fill="#fff"/>
    <circle cx="11.2" cy="12.8" r="1.6" fill="#6B4EFF"/></svg></button>
</div>`;
const CTL_JS = `
  const wireControls = () => {
    document.getElementById('zin').addEventListener('click', () => window.zoomBy(1));
    document.getElementById('zout').addEventListener('click', () => window.zoomBy(-1));
    const loc = document.getElementById('loc');
    loc.addEventListener('click', () => { loc.classList.add('busy'); post({ type: 'locate' }); });
    window.locateDone = () => loc.classList.remove('busy');
  };
`;

// Muassasa belgisi (2026-11-25 TZ): dumaloq logo/rasm (128px nusxa), bo'lmasa yo'nalish ikonkasi; ostida reyting va aksiya.
// Ikkala xaritada bir xil HTML (mkHtml). Matn va manzillar ekranlanadi (esc). Rasm yuklanmasa — ikonka (imgFail).
const MARK_CSS = `
  .mk{position:relative;width:46px;height:56px;font:700 11px system-ui,sans-serif;-webkit-tap-highlight-color:transparent}
  .mk .av{position:absolute;left:0;top:0;width:46px;height:46px;box-sizing:border-box;border-radius:50%;border:3px solid #fff;
          background:var(--b);color:var(--c);display:flex;align-items:center;justify-content:center;overflow:hidden;
          box-shadow:0 4px 12px rgba(17,17,20,.28);transition:transform .15s ease}
  .mk .av img{width:100%;height:100%;object-fit:cover;display:block}
  .mk .tag{position:absolute;left:50%;top:37px;transform:translateX(-50%);display:flex;align-items:center;gap:3px;white-space:nowrap;
           padding:2px 6px;border-radius:999px;background:#111114;color:#fff;border:1.5px solid #fff;box-shadow:0 2px 6px rgba(17,17,20,.3)}
  .mk .tag .s{color:#F5A623}
  .mk .tag .p{padding:0 4px;border-radius:999px;background:#FF3D71}
  .mk.promo .av{border-color:#FF3D71}
  .mk.closed .av{filter:grayscale(.85);opacity:.85}
  .mk.closed .tag{background:#8a8a94}
  .mk.sel .av{transform:scale(1.22);border-color:#6B4EFF;box-shadow:0 0 0 3px rgba(107,78,255,.3),0 8px 18px rgba(17,17,20,.35)}
  .cl{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;
      font:800 14px system-ui,sans-serif;background:linear-gradient(145deg,#8B74FF,#4B2FE0);border:3px solid #fff;
      box-sizing:border-box;box-shadow:0 0 0 5px rgba(107,78,255,.22),0 6px 14px rgba(17,17,20,.3)}
`;
const MARK_JS = `
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ico = (d) => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
    + ' stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const ICONS = {
    barber: ico('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>'),
    beauty: ico('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>'),
    spa: ico('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>'),
    cosmetic: ico('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
    nail: ico('<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
    fitness: ico('<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>'),
    clinic: ico('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M12 11v6M9 14h6"/>'),
    ent: ico('<path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0"/><path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4"/>'),
    pharmacy: ico('<path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="M8.5 8.5l7 7"/>'),
    other: ico('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
  };
  window.imgFail = (el) => { const av = el.parentNode; if (av) av.innerHTML = ICONS[av.dataset.k] || ICONS.other; };
  const mkHtml = (b) => {
    const inner = b.img
      ? '<img src="' + esc(b.img) + '" alt="" loading="lazy" decoding="async" onerror="imgFail(this)">'
      : (ICONS[b.k] || ICONS.other);
    const tag = '<div class="tag">' + (b.rated ? '<span class="s">\\u2605</span>' : '') + esc(b.label)
      + (b.promo ? '<span class="p">\\u2212' + esc(b.promo) + '%</span>' : '') + '</div>';
    return '<div class="mk' + (b.open ? '' : ' closed') + (b.promo ? ' promo' : '') + (b.sel ? ' sel' : '') + '">'
      + '<div class="av" data-k="' + esc(b.k) + '" style="--b:' + esc(b.bg) + ';--c:' + esc(b.fg) + '">' + inner + '</div>'
      + tag + '</div>';
  };
  // Faqat o'zgargan belgilar qayta chiziladi: xarita surilganda yoki boshqa salon tanlanganda hammasi o'chib-yonmaydi
  const syncMarks = (list, current, make, addAll, removeAll) => {
    const keep = new Set(), add = [], drop = [];
    list.forEach((b) => {
      const sig = JSON.stringify(b);
      const old = current.get(b.id);
      keep.add(b.id);
      if (old && old.sig === sig) return;
      if (old) drop.push(old.m);
      const m = make(b);
      current.set(b.id, { m, sig });
      add.push(m);
    });
    current.forEach((v, id) => { if (!keep.has(id)) { drop.push(v.m); current.delete(id); } });
    if (drop.length) removeAll(drop);
    if (add.length) addAll(add);
  };
`;

// Yandex JS API 2.1. Shartlar: bepul versiya faqat ochiq ilovada; olingan ma'lumot saqlanmaydi (faqat ko'rsatish).
const yandexHtml = (lat: number, lng: number, key: string, top: number) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body,#map{width:100%;height:100%;margin:0;padding:0;background:#eef1f6}
  .ym{transform:translate(-23px,-23px)}
${CTL_CSS(top)}${MARK_CSS}
</style>
<script>const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));</script>
<script src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU" onerror="post({type:'error'})"></script>
</head><body><div id="map"></div>
${CTL_HTML}
<script>${ME_JS}${CTL_JS}${MARK_JS}
  const fail = setTimeout(() => post({ type: 'error' }), 15000);
  if (!window.ymaps) post({ type: 'error' });
  else ymaps.ready(() => {
    clearTimeout(fail);
    const map = new ymaps.Map('map', { center: [${lat}, ${lng}], zoom: 13, controls: [] },
                              { suppressMapOpenBlock: true, autoFitToViewport: 'always' });
    // Yaqin belgilar guruhlanadi (raqamli doira); yaqinlashtirilganda ajraladi
    const markers = new ymaps.Clusterer({ preset: 'islands#invertedVioletClusterIcons', gridSize: 80, maxZoom: 16,
                                          hasBalloon: false, hasHint: false, groupByCoordinates: false });
    map.geoObjects.add(markers);
    const MarkLayout = ymaps.templateLayoutFactory.createClass('<div class="ym">{{ properties.html|raw }}</div>');
    const current = new Map();
    let me = null;
    window.setMarkers = (list) => syncMarks(list, current, (b) => {
      const mark = new ymaps.Placemark([b.lat, b.lng], { html: mkHtml(b), hintContent: esc(b.name) },
        { iconLayout: MarkLayout, iconShape: { type: 'Circle', coordinates: [0, 0], radius: 26 },
          zIndex: b.sel ? 1000 : b.promo ? 500 : 0 });
      mark.events.add('click', (e) => { e.stopPropagation(); post({ type: 'select', id: b.id }); });
      return mark;
    }, (arr) => markers.add(arr), (arr) => markers.remove(arr));
    window.setMe = (p) => {
      if (me) map.geoObjects.remove(me);
      me = new ymaps.Placemark([p.lat, p.lng], {}, {
        iconLayout: 'default#image', interactive: false, zIndex: 2000,
        iconImageHref: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(meSvg(p.g)),
        iconImageSize: [44, 44], iconImageOffset: [-22, -22] });
      map.geoObjects.add(me);
    };
    window.flyTo = (p) => map.setCenter([p.lat, p.lng], 15, { duration: 300 });
    window.centerOn = (p) => map.setCenter([p.lat, p.lng], 14, { duration: 250 });
    window.zoomBy = (d) => map.setZoom(Math.max(2, Math.min(19, map.getZoom() + d)), { duration: 200 });
    wireControls();
    const bounds = () => {
      const [sw, ne] = map.getBounds();
      post({ type: 'bounds', sw, ne });
    };
    map.events.add('boundschange', bounds);
    map.events.add('click', () => post({ type: 'tap' }));
    bounds();
    post({ type: 'ready' });
  });
</script></body></html>`;

const html = (lat: number, lng: number, top: number) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>
  html,body,#map{width:100%;height:100%;margin:0;padding:0;background:#eef1f6}
  .me{width:44px;height:44px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}
  .leaflet-tooltip{font:600 12px system-ui,sans-serif}
  .leaflet-marker-icon.lmk{background:none;border:0}
${CTL_CSS(top)}${MARK_CSS}
</style>
<script>const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="" onerror="post({type:'error'})"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
</head><body><div id="map"></div>
${CTL_HTML}
<script>${CTL_JS}${MARK_JS}
  if (!window.L) post({ type: 'error' });
  const map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], 13);
  window.zoomBy = (d) => (d > 0 ? map.zoomIn() : map.zoomOut());
  wireControls();
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).on('tileerror', () => post({ type: 'tileerror' })).addTo(map);
  // Yaqin belgilar guruhlanadi (plagin yuklanmasa — oddiy qatlam, belgilar baribir chiqadi)
  const markers = (L.markerClusterGroup ? L.markerClusterGroup({
    maxClusterRadius: 56, disableClusteringAtZoom: 17, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    chunkedLoading: true, removeOutsideVisibleBounds: true,
    iconCreateFunction: (c) => L.divIcon({ className: '', html: '<div class="cl">' + c.getChildCount() + '</div>',
                                            iconSize: [44, 44], iconAnchor: [22, 22] }),
  }) : L.layerGroup()).addTo(map);
  const current = new Map();
  let meMarker = null;${ME_JS}

  window.setMarkers = (list) => syncMarks(list, current, (b) =>
    L.marker([b.lat, b.lng], { icon: L.divIcon({ className: 'lmk', html: mkHtml(b), iconSize: [46, 56], iconAnchor: [23, 23] }),
                               zIndexOffset: b.sel ? 1000 : b.promo ? 500 : 0, title: b.name })
      .on('click', () => post({ type: 'select', id: b.id })),
    (arr) => (markers.addLayers ? markers.addLayers(arr) : arr.forEach((m) => markers.addLayer(m))),
    (arr) => (markers.removeLayers ? markers.removeLayers(arr) : arr.forEach((m) => markers.removeLayer(m))));
  window.setMe = (p) => {
    if (meMarker) meMarker.remove();
    meMarker = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="me">' + meSvg(p.g) + '</div>',
                                                              iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 2000,
                                          interactive: false }).addTo(map);
  };
  window.flyTo = (p) => map.setView([p.lat, p.lng], 15);
  window.centerOn = (p) => map.setView([p.lat, p.lng], 14, { animate: true });

  const bounds = () => {
    const b = map.getBounds();
    post({ type: 'bounds', sw: [b.getSouth(), b.getWest()], ne: [b.getNorth(), b.getEast()] });
  };
  map.on('moveend', bounds);
  map.on('click', () => post({ type: 'tap' }));
  bounds();
  post({ type: 'ready' });
</script></body></html>`;

export function OsmMap({ center, me, businesses, onBounds, onSelect, onError, onLocate, yandexKey, selectedId, onTapMap,
  controlsTop = 12, focus, gender }: Props) {
  const web = useRef<WebView | null>(null);
  const ready = useRef(false);
  const latest = useRef({ businesses, me, selectedId, gender });
  latest.current = { businesses, me, selectedId, gender };
  const meJson = (p: Point) => JSON.stringify({ lat: p.latitude, lng: p.longitude, g: latest.current.gender ?? null });
  // Xarita markazi faqat birinchi ochilganda: keyin foydalanuvchi o'zi suradi
  const source = useMemo(() => ({
    html: yandexKey ? yandexHtml(center.latitude, center.longitude, yandexKey, controlsTop)
      : html(center.latitude, center.longitude, controlsTop),
    baseUrl: BASE_URL,                               // Yandex kaliti shu Referer bilan cheklanadi
  }), [yandexKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useRef<{ contentWindow: { eval: (code: string) => unknown } | null } | null>(null);
  const run = (code: string) => {
    if (Platform.OS === 'web') {
      try {
        frame.current?.contentWindow?.eval(code);
      } catch {
        // xarita hali yuklanmagan
      }
      return;
    }
    web.current?.injectJavaScript(`${code}; true;`);
  };
  const sent = useRef('');
  const sentMe = useRef('');
  const pending = useRef<Point | null>(null);
  const centerOn = (p: Point) => run(`window.centerOn && window.centerOn(${JSON.stringify({ lat: p.latitude, lng: p.longitude })})`);
  const pushMarkers = () => {
    const list = latest.current.businesses.map((b) => ({
      id: b.id, name: b.branch_name ? `${b.name} · ${b.branch_name}` : b.name,   // filial xaritada aniq ajralsin
      lat: b.lat, lng: b.lng, open: b.is_open_now, rated: b.rating_count > 0,
      promo: b.promo_percent ?? null, sel: b.id === latest.current.selectedId,
      label: b.rating_count > 0 ? b.rating_avg.toFixed(1).replace('.', ',') : t('Yangi'),
      img: b.map_image ?? b.logo_url ?? null, ...mapKind(b.category, b.category_name) }));
    // Ro'yxat o'zgarmagan bo'lsa belgilar qayta chizilmaydi (xarita har surilganda shu chaqiriladi)
    const json = JSON.stringify(list);
    if (json !== sent.current) {
      sent.current = json;
      run(`window.setMarkers && window.setMarkers(${json})`);
    }
    const p = latest.current.me;
    if (p && meJson(p) !== sentMe.current) {               // odamcha faqat joy yoki jins o'zgarsa qayta chiziladi
      sentMe.current = meJson(p);
      run(`window.setMe && window.setMe(${sentMe.current})`);
    }
  };

  // Xarita tayyor bo'lmaguncha belgilar yuborilmaydi: aks holda ular yo'qolib qoladi
  useEffect(() => {
    if (ready.current) pushMarkers();
  }, [businesses, me, selectedId, gender]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus) return;
    if (ready.current) centerOn(focus);
    else pending.current = focus;
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMessage = (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'ready') {
      ready.current = true;
      sent.current = '';
      sentMe.current = '';
      pushMarkers();
      if (pending.current) {
        centerOn(pending.current);
        pending.current = null;
      }
    } else if (m.type === 'bounds') onBounds({ sw: m.sw, ne: m.ne });
    else if (m.type === 'select') onSelect(m.id);
    else if (m.type === 'tap') onTapMap?.();
    else if (m.type === 'error') onError();
    else if (m.type === 'locate') {
      (onLocate ? onLocate() : Promise.resolve(latest.current.me ?? null))
        .then((p) => {
          if (!p) return;
          run(`window.setMe && window.setMe(${meJson(p)})`);
          run(flyToScript(p));
        })
        .catch(() => {})
        .finally(() => run('window.locateDone && window.locateDone()'));
    }
  };

  if (Platform.OS === 'web') {
    // Brauzerdagi ko'rik: WebView yo'q — o'sha xarita iframe ichida, xabarlar postMessage orqali
    return <WebFrame html={source.html} frame={frame} onMessage={(data) => onMessage({ nativeEvent: { data } } as WebViewMessageEvent)} />;
  }

  return (
    <MapView
      ref={web}
      source={source}
      originWhitelist={['*']}
      onMessage={onMessage}
      onError={onError}
      setSupportMultipleWindows={false}
      // Faqat xaritaning o'zi: havola bosilsa ham ilova ichida boshqa sahifa ochilmaydi
      onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url === BASE_URL}
    />
  );
}

type Frame = { contentWindow: { eval: (code: string) => unknown } | null };

/** Faqat web: xarita HTML'i iframe'da. ReactNativeWebView.postMessage o'rniga ota oynaga postMessage */
function WebFrame({ html: page, frame, onMessage }: {
  html: string; frame: RefObject<Frame | null>; onMessage: (data: string) => void;
}) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    const listen = (e: { source: unknown; data: unknown }) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      handler.current(e.data);
    };
    const w = globalThis as unknown as { addEventListener: (t: string, f: typeof listen) => void; removeEventListener: (t: string, f: typeof listen) => void };
    w.addEventListener('message', listen);
    return () => w.removeEventListener('message', listen);
  }, [frame]);
  const shim = '<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,"*")}};</script>';
  const srcDoc = page.replace('<head>', `<head>${shim}`);
  const Iframe = 'iframe' as unknown as ComponentType<Record<string, unknown>>;
  return createElement(Iframe, { ref: frame, srcDoc, title: 'map', style: { border: 0, width: '100%', height: '100%', flex: 1 } });
}

/** Joylashuvga qaytish tugmasi uchun */
export const flyToScript = (p: Point) => `window.flyTo && window.flyTo(${JSON.stringify({ lat: p.latitude, lng: p.longitude })}); true;`;
