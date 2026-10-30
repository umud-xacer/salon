import { ComponentType, RefObject, useEffect, useMemo, useRef } from 'react';
import { WebView, WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { BusinessCard } from './api';

const KEY = process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ?? '';
// Yandex kalit cheklovi Referer bo'yicha: kabinetda shu domenga ruxsat bering yoki cheklov qo'ymang
const BASE_URL = 'https://salon-app.uz/';

// WebView klassining turlari React 19 bilan to'g'ri ishlamaydi
const MapView = WebView as unknown as ComponentType<WebViewProps & { ref: RefObject<WebView | null> }>;

export const hasMapKey = KEY.length > 0;

export type Bounds = { sw: [number, number]; ne: [number, number] };

type Props = {
  center: { latitude: number; longitude: number };
  businesses: BusinessCard[];
  onBounds: (bounds: Bounds) => void;
  onSelect: (id: number) => void;
  onError: () => void;
};

// Yandex JS API WebView ichida: mobil MapKit alohida native SDK va kalit talab qiladi.
// Xaritaga faqat raqamlar uzatiladi, salon nomlari sahifaga kirmaydi (XSS bo'lmasin).
const html = (lat: number, lng: number) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<style>html,body,#map{width:100%;height:100%;margin:0;padding:0}</style>
<script>
  const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
</script>
<script src="https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(KEY)}&lang=ru_RU"
        onerror="post({type:'error'})"></script>
</head><body><div id="map"></div>
<script>
  ymaps.ready(() => {
    const map = new ymaps.Map('map', { center: [${lat}, ${lng}], zoom: 12, controls: ['zoomControl', 'geolocationControl'] });
    const markers = new ymaps.GeoObjectCollection();
    map.geoObjects.add(markers);
    window.setMarkers = (list) => {
      markers.removeAll();
      list.forEach((b) => {
        const mark = new ymaps.Placemark([b.lat, b.lng], {}, { preset: b.open ? 'islands#greenDotIcon' : 'islands#grayDotIcon' });
        mark.events.add('click', () => post({ type: 'select', id: b.id }));
        markers.add(mark);
      });
    };
    const bounds = () => {
      const [sw, ne] = map.getBounds();
      post({ type: 'bounds', sw, ne });
    };
    map.events.add('boundschange', bounds);
    bounds();
  });
</script></body></html>`;

export function YandexMap({ center, businesses, onBounds, onSelect, onError }: Props) {
  const web = useRef<WebView | null>(null);
  // Xarita markazi faqat birinchi ochilganda: keyin foydalanuvchi o'zi suradi
  const source = useMemo(() => ({ html: html(center.latitude, center.longitude), baseUrl: BASE_URL }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const list = businesses.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, open: b.is_open_now }));
    web.current?.injectJavaScript(`window.setMarkers && window.setMarkers(${JSON.stringify(list)}); true;`);
  }, [businesses]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'bounds') onBounds({ sw: m.sw, ne: m.ne });
    else if (m.type === 'select') onSelect(m.id);
    else if (m.type === 'error') onError();
  };

  return (
    <MapView
      ref={web}
      source={source}
      originWhitelist={['*']}
      onMessage={onMessage}
      onError={onError}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith(BASE_URL)}
    />
  );
}
