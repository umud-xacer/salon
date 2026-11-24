// Mijoz xaritasi WebView ichida: Yandex Maps JS API (kalit serverdan kelsa) yoki OpenStreetMap (Leaflet, kalitsiz).
// Ikkalasida bir xil window API: setMarkers, setMe, flyTo, locateDone — RN tomoni bitta.
// Salon nomlari xaritaga faqat matn sifatida qo'yiladi (textContent), HTML sifatida emas.
import { ComponentType, createElement, RefObject, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { BusinessCard } from './api';

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

// Yandex JS API 2.1. Shartlar: bepul versiya faqat ochiq ilovada; olingan ma'lumot saqlanmaydi (faqat ko'rsatish).
const yandexHtml = (lat: number, lng: number, key: string, top: number) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body,#map{width:100%;height:100%;margin:0;padding:0;background:#eef1f6}
${CTL_CSS(top)}
</style>
<script>const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));</script>
<script src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU" onerror="post({type:'error'})"></script>
</head><body><div id="map"></div>
${CTL_HTML}
<script>${ME_JS}${CTL_JS}
  // Salon nomi matn sifatida: Yandex hint HTML qabul qiladi, shuning uchun belgilar ekranlanadi
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail = setTimeout(() => post({ type: 'error' }), 15000);
  if (!window.ymaps) post({ type: 'error' });
  else ymaps.ready(() => {
    clearTimeout(fail);
    const map = new ymaps.Map('map', { center: [${lat}, ${lng}], zoom: 13, controls: [] },
                              { suppressMapOpenBlock: true, autoFitToViewport: 'always' });
    const markers = new ymaps.GeoObjectCollection();
    map.geoObjects.add(markers);
    let me = null;
    window.setMarkers = (list) => {
      markers.removeAll();
      list.forEach((b) => {
        // Qora yorliq "★ 4,9" (yangi — "Yangi"), yopig'i kulrang; aksiya — pushti va "−20%"; tanlangan — ko'k
        const text = (b.rated ? '\u2605 ' : '') + b.label + (b.promo ? '  \u2212' + b.promo + '%' : '');
        const preset = b.sel ? 'islands#blueStretchyIcon' : b.promo ? 'islands#pinkStretchyIcon'
                     : b.open ? 'islands#blackStretchyIcon' : 'islands#grayStretchyIcon';
        const mark = new ymaps.Placemark([b.lat, b.lng], { hintContent: esc(b.name), iconContent: esc(text) },
                                         { preset, zIndex: b.sel ? 1000 : b.promo ? 500 : 0 });
        mark.events.add('click', (e) => { e.stopPropagation(); post({ type: 'select', id: b.id }); });
        markers.add(mark);
      });
    };
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
  .pin{position:relative;display:inline-flex;align-items:center;gap:4px;padding:6px 11px;border-radius:999px;background:#111114;color:#fff;
       font:700 13px system-ui,sans-serif;white-space:nowrap;box-shadow:0 3px 10px rgba(17,17,20,.32);
       transform:translate(-50%,calc(-100% - 6px));transition:transform .15s ease}
  .pin:after{content:'';position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;
       border-top-color:inherit;border-top-color:#111114}
  .pin .s{color:#F5A623}.pin.closed{background:#8a8a94}.pin.closed:after{border-top-color:#8a8a94}
  .pin .p{margin-left:2px;padding:1px 6px;border-radius:999px;background:#FF3D71;color:#fff;font-size:11px}
  .pin.promo{box-shadow:0 0 0 2px #FF3D71,0 3px 10px rgba(255,61,113,.35)}
  .pin.sel{background:#fff;color:#111114;transform:translate(-50%,calc(-100% - 6px)) scale(1.15);
           box-shadow:0 0 0 2px #111114,0 6px 16px rgba(17,17,20,.35)}
  .pin.sel:after{border-top-color:#111114}
  .me{width:44px;height:44px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}
  .leaflet-tooltip{font:600 12px system-ui,sans-serif}
${CTL_CSS(top)}
</style>
<script>const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="" onerror="post({type:'error'})"></script>
</head><body><div id="map"></div>
${CTL_HTML}
<script>${CTL_JS}
  if (!window.L) post({ type: 'error' });
  const map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], 13);
  window.zoomBy = (d) => (d > 0 ? map.zoomIn() : map.zoomOut());
  wireControls();
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).on('tileerror', () => post({ type: 'tileerror' })).addTo(map);
  const markers = L.layerGroup().addTo(map);
  let meMarker = null;${ME_JS}

  window.setMarkers = (list) => {
    markers.clearLayers();
    list.forEach((b) => {
      const pill = document.createElement('div');
      pill.className = 'pin ' + (b.open ? 'open' : 'closed') + (b.promo ? ' promo' : '') + (b.sel ? ' sel' : '');
      const star = document.createElement('span');
      star.className = 's';
      star.textContent = b.rated ? '★' : '';
      pill.appendChild(star);
      pill.appendChild(document.createTextNode(b.label));
      if (b.promo) {
        const promo = document.createElement('span');
        promo.className = 'p';
        promo.textContent = '−' + b.promo + '%';
        pill.appendChild(promo);
      }
      const icon = L.divIcon({ className: '', html: pill, iconSize: [0, 0], iconAnchor: [0, 0] });
      L.marker([b.lat, b.lng], { icon, zIndexOffset: b.sel ? 1000 : b.promo ? 500 : 0 })
        .on('click', () => post({ type: 'select', id: b.id })).addTo(markers);
    });
  };
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
      label: b.rating_count > 0 ? b.rating_avg.toFixed(1).replace('.', ',') : 'Yangi' }));
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
