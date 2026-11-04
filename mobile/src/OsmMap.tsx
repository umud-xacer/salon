// Mijoz xaritasi WebView ichida: Yandex Maps JS API (kalit serverdan kelsa) yoki OpenStreetMap (Leaflet, kalitsiz).
// Ikkalasida bir xil window API: setMarkers, setMe, flyTo, locateDone — RN tomoni bitta.
// Salon nomlari xaritaga faqat matn sifatida qo'yiladi (textContent), HTML sifatida emas.
import { ComponentType, RefObject, useEffect, useMemo, useRef } from 'react';
import { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { BusinessCard } from './api';

// OSM xarita rasmlari Referer'siz bloklanadi: sahifa shu manzildan ochilgandek ko'rinadi
const BASE_URL = 'https://ariqalqon.uz/';

// WebView klassining turlari React 19 bilan to'g'ri ishlamaydi
const MapView = WebView as unknown as ComponentType<WebViewProps & { ref: RefObject<WebView | null> }>;

export type Bounds = { sw: [number, number]; ne: [number, number] };

type Point = { latitude: number; longitude: number };

type Props = {
  center: Point;
  me?: Point | null;
  businesses: BusinessCard[];
  onBounds: (bounds: Bounds) => void;
  onSelect: (id: number) => void;
  onError: () => void;
  /** "Mening joyim" tugmasi: joylashuvni topib qaytaradi (ruxsat yo'q bo'lsa null) */
  onLocate?: () => Promise<Point | null>;
  /** Bo'lmasa — OpenStreetMap. Yandex yuklanmasa onError chaqiriladi, chaqiruvchi OSM ga o'tkazadi */
  yandexKey?: string | null;
};

// Yandex JS API 2.1. Shartlar: bepul versiya faqat ochiq ilovada; olingan ma'lumot saqlanmaydi (faqat ko'rsatish).
const yandexHtml = (lat: number, lng: number, key: string) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body,#map{width:100%;height:100%;margin:0;padding:0;background:#eef1f6}
  #locate{position:absolute;right:10px;bottom:118px;z-index:2000;width:34px;height:34px;border:0;border-radius:8px;
          background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#1565F5}
  #locate.busy{opacity:.5}
</style>
<script>const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));</script>
<script src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU" onerror="post({type:'error'})"></script>
</head><body><div id="map"></div>
<button id="locate" aria-label="Mening joyim"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
<script>
  // Salon nomi matn sifatida: Yandex hint HTML qabul qiladi, shuning uchun belgilar ekranlanadi
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail = setTimeout(() => post({ type: 'error' }), 15000);
  if (!window.ymaps) post({ type: 'error' });
  else ymaps.ready(() => {
    clearTimeout(fail);
    const map = new ymaps.Map('map', { center: [${lat}, ${lng}], zoom: 13, controls: ['zoomControl'] },
                              { suppressMapOpenBlock: true });
    map.controls.get('zoomControl').options.set({ size: 'small', position: { right: 10, bottom: 30 } });
    const markers = new ymaps.GeoObjectCollection();
    map.geoObjects.add(markers);
    let me = null;
    window.setMarkers = (list) => {
      markers.removeAll();
      list.forEach((b) => {
        const mark = new ymaps.Placemark([b.lat, b.lng], { hintContent: esc(b.name) },
                                         { preset: b.open ? 'islands#blueDotIcon' : 'islands#grayDotIcon' });
        mark.events.add('click', () => post({ type: 'select', id: b.id }));
        markers.add(mark);
      });
    };
    window.setMe = (p) => {
      if (me) map.geoObjects.remove(me);
      me = new ymaps.Placemark([p.lat, p.lng], {}, { preset: 'islands#geolocationIcon', interactive: false });
      map.geoObjects.add(me);
    };
    window.flyTo = (p) => map.setCenter([p.lat, p.lng], 15, { duration: 300 });
    const btn = document.getElementById('locate');
    btn.addEventListener('click', () => { btn.classList.add('busy'); post({ type: 'locate' }); });
    window.locateDone = () => btn.classList.remove('busy');
    const bounds = () => {
      const [sw, ne] = map.getBounds();
      post({ type: 'bounds', sw, ne });
    };
    map.events.add('boundschange', bounds);
    bounds();
    post({ type: 'ready' });
  });
</script></body></html>`;

const html = (lat: number, lng: number) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<style>
  html,body,#map{width:100%;height:100%;margin:0;padding:0;background:#eef1f6}
  .pin{width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;
       box-shadow:0 2px 6px rgba(1,13,73,.35)}
  .pin.open{background:#1565F5}.pin.closed{background:#8a8fa0}
  .me{width:16px;height:16px;border-radius:50%;background:#1565F5;border:3px solid #fff;box-shadow:0 0 0 6px rgba(21,101,245,.25)}
  .leaflet-tooltip{font:600 12px system-ui,sans-serif}
  .locate a{display:flex!important;align-items:center;justify-content:center;color:#1565F5}
  .locate a.busy{opacity:.5}
</style>
<script>const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="" onerror="post({type:'error'})"></script>
</head><body><div id="map"></div>
<script>
  if (!window.L) post({ type: 'error' });
  const map = L.map('map', { zoomControl: false }).setView([${lat}, ${lng}], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Joylashuv tugmasi: +/- ustida, xuddi shu ko'rinishda
  const Locate = L.Control.extend({ options: { position: 'bottomright' }, onAdd() {
    const box = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate');
    const a = L.DomUtil.create('a', '', box);
    a.href = '#'; a.title = 'Mening joyim'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Mening joyim');
    a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
      + 'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); a.classList.add('busy'); post({ type: 'locate' }); });
    window.locateDone = () => a.classList.remove('busy');
    return box;
  } });
  new Locate().addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).on('tileerror', () => post({ type: 'tileerror' })).addTo(map);
  const markers = L.layerGroup().addTo(map);
  let meMarker = null;

  window.setMarkers = (list) => {
    markers.clearLayers();
    list.forEach((b) => {
      const icon = L.divIcon({ className: '', html: '<div class="pin ' + (b.open ? 'open' : 'closed') + '"></div>',
                               iconSize: [30, 30], iconAnchor: [15, 30] });
      const label = document.createElement('span');
      label.textContent = b.name;
      L.marker([b.lat, b.lng], { icon }).bindTooltip(label, { direction: 'top', offset: [0, -30] })
        .on('click', () => post({ type: 'select', id: b.id })).addTo(markers);
    });
  };
  window.setMe = (p) => {
    if (meMarker) meMarker.remove();
    meMarker = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16] }),
                                          interactive: false }).addTo(map);
  };
  window.flyTo = (p) => map.setView([p.lat, p.lng], 15);

  const bounds = () => {
    const b = map.getBounds();
    post({ type: 'bounds', sw: [b.getSouth(), b.getWest()], ne: [b.getNorth(), b.getEast()] });
  };
  map.on('moveend', bounds);
  bounds();
  post({ type: 'ready' });
</script></body></html>`;

export function OsmMap({ center, me, businesses, onBounds, onSelect, onError, onLocate, yandexKey }: Props) {
  const web = useRef<WebView | null>(null);
  const ready = useRef(false);
  const latest = useRef({ businesses, me });
  latest.current = { businesses, me };
  // Xarita markazi faqat birinchi ochilganda: keyin foydalanuvchi o'zi suradi
  const source = useMemo(() => ({
    html: yandexKey ? yandexHtml(center.latitude, center.longitude, yandexKey) : html(center.latitude, center.longitude),
    baseUrl: BASE_URL,                               // Yandex kaliti shu Referer bilan cheklanadi
  }), [yandexKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (code: string) => web.current?.injectJavaScript(`${code}; true;`);
  const pushMarkers = () => {
    const list = latest.current.businesses.map((b) => ({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, open: b.is_open_now }));
    run(`window.setMarkers && window.setMarkers(${JSON.stringify(list)})`);
    const p = latest.current.me;
    if (p) run(`window.setMe && window.setMe(${JSON.stringify({ lat: p.latitude, lng: p.longitude })})`);
  };

  // Xarita tayyor bo'lmaguncha belgilar yuborilmaydi: aks holda ular yo'qolib qoladi
  useEffect(() => {
    if (ready.current) pushMarkers();
  }, [businesses, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMessage = (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'ready') {
      ready.current = true;
      pushMarkers();
    } else if (m.type === 'bounds') onBounds({ sw: m.sw, ne: m.ne });
    else if (m.type === 'select') onSelect(m.id);
    else if (m.type === 'error') onError();
    else if (m.type === 'locate') {
      (onLocate ? onLocate() : Promise.resolve(latest.current.me ?? null))
        .then((p) => {
          if (!p) return;
          run(`window.setMe && window.setMe(${JSON.stringify({ lat: p.latitude, lng: p.longitude })})`);
          run(flyToScript(p));
        })
        .catch(() => {})
        .finally(() => run('window.locateDone && window.locateDone()'));
    }
  };

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

/** Joylashuvga qaytish tugmasi uchun */
export const flyToScript = (p: Point) => `window.flyTo && window.flyTo(${JSON.stringify({ lat: p.latitude, lng: p.longitude })}); true;`;
