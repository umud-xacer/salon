import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { playStartupSound } from './startupSound';
import { colors } from './ui';

// Barcha o'lchamlar chroniximage.jpg (1254x1254) pikselida, oxirgi kadr rasmning o'zi bo'lishi uchun
const IMAGE = 1254;
const MARK = { x: 380, y: 225, size: 470 };     // make_brand_assets.py dagi MARK_BOX
const WORD = { x: 285, y: 705, width: 685, height: 165 };
const TAG = { x: 295, y: 885, width: 665, height: 60 };
const CLOCK = { x: 250, y: 255 };               // MARK ichida
const HAND_WIDTH = 11;
const TICK = { length: 26, offset: 98 };
const PIN = 26;
const TICKS = [0, 90, 180, 270];

const NATIVE_SPLASH_WIDTH = 190;                // app.json dagi imageWidth
const CONTENT_SHARE = 0.84;                     // yozuv ekran kengligining qancha qismini egallaydi
const MAX_CONTENT = 460;
// Vaqt chizig'i, ms: strelkalar aylanadi -> belgi joyiga, yozuv chiqadi -> shior -> to'liq rasm -> qisqa to'xtash -> yo'qoladi
const T = { spin: 900, move: 1380, word: 1320, tagline: 1640, full: 1960, hold: 2200, total: 2480 };

function Hand({ length, angle, k }: { length: number; angle: Animated.AnimatedInterpolation<string>; k: number }) {
  // Blok ikki uzunlikda, soat markazida: burilganda strelka uchi emas, asosi joyida qoladi
  const size = length * k;
  return (
    <Animated.View style={[styles.hand, {
      left: CLOCK.x * k - size,
      top: CLOCK.y * k - size,
      width: size * 2,
      height: size * 2,
      transform: [{ rotate: angle }],
    }]}>
      <View style={{ width: HAND_WIDTH * k, height: size, borderRadius: HAND_WIDTH * k, backgroundColor: '#fff' }} />
    </Animated.View>
  );
}

export function AnimatedSplash({ onReady, onDone }: { onReady: () => void; onDone: () => void }) {
  const { width } = useWindowDimensions();
  // Butun animatsiya BITTA qiymatdan (0 → TOTAL ms) va to'liq native'da: bosqichlar orasida JS kutilmaydi,
  // shuning uchun ilova ochilishda JS band bo'lsa ham animatsiya qotmaydi (avval Animated.sequence edi).
  const time = useRef(new Animated.Value(0)).current;
  // Easing.out(cubic) — native interpolatsiya easing funksiyasini qabul qilmaydi, nuqtalar bilan yaqinlashtiriladi
  const seg = (a: number, b: number, from = 0, to = 1) => {
    const d = b - a;
    const ease = [0, 0.488, 0.784, 0.936, 0.992, 1];
    return time.interpolate({
      inputRange: ease.map((_, n) => a + (d * n) / 5),
      outputRange: ease.map((e) => from + (to - from) * e),
      extrapolate: 'clamp',
    });
  };
  const spin = seg(0, T.spin);
  const move = seg(T.spin, T.move);
  const word = seg(T.spin, T.word);
  const tagline = seg(T.move, T.tagline);
  const full = seg(T.tagline, T.full);
  const exit = seg(T.hold, T.total, 1, 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reduced = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      if (cancelled) return;
      onReady();
      void playStartupSound();         // animatsiya bilan bir vaqtda: strelkalar -> akkord (0.9 s)
      if (reduced) time.setValue(T.hold);   // harakat kamaytirilgan: tayyor kadr, faqat yo'qolishi
      Animated.timing(time, {
        toValue: T.total, duration: reduced ? T.total - T.hold : T.total, easing: Easing.linear,
        useNativeDriver: true, isInteraction: false,
      }).start(({ finished }) => finished && onDone());
    })();
    return () => {
      cancelled = true;
    };
  }, [time, onReady, onDone]);

  const k = (Math.min(width * CONTENT_SHARE, MAX_CONTENT)) / WORD.width;
  const stage = IMAGE * k;
  const markSize = MARK.size * k;

  // Boshlanish holati tizim splash'i bilan bir xil: belgi ekran markazida, 190 kenglikda
  const startX = (IMAGE / 2 - (MARK.x + MARK.size / 2)) * k;
  const startY = (IMAGE / 2 - (MARK.y + MARK.size / 2)) * k;
  const rise = (value: Animated.AnimatedInterpolation<number>) => [{
    translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
  }];
  const pin = PIN * k;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: exit }]}>
      <View style={{ width: stage, height: stage }}>
        <Animated.View style={{
          position: 'absolute',
          left: MARK.x * k,
          top: MARK.y * k,
          width: markSize,
          height: markSize,
          transform: [
            { translateX: move.interpolate({ inputRange: [0, 1], outputRange: [startX, 0] }) },
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: [startY, 0] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [NATIVE_SPLASH_WIDTH / markSize, 1] }) },
          ],
        }}>
          <Image source={require('../assets/brand/ring.png')} style={{ width: markSize, height: markSize }} />
          {TICKS.map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const horizontal = deg % 180 !== 0;
            const long = TICK.length * k;
            const thin = HAND_WIDTH * k;
            return (
              <View key={deg} style={[styles.tick, {
                borderRadius: thin,
                left: (CLOCK.x + Math.sin(rad) * TICK.offset) * k - (horizontal ? long : thin) / 2,
                top: (CLOCK.y - Math.cos(rad) * TICK.offset) * k - (horizontal ? thin : long) / 2,
                width: horizontal ? long : thin,
                height: horizontal ? thin : long,
              }]} />
            );
          })}
          {/* To'liq aylanib, tizim splash'idagi va rasmdagi holatda to'xtaydi */}
          <Hand k={k} length={59} angle={spin.interpolate({ inputRange: [0, 1], outputRange: ['-410deg', '-50deg'] })} />
          <Hand k={k} length={95} angle={spin.interpolate({ inputRange: [0, 1], outputRange: ['-665deg', '55deg'] })} />
          <View style={{
            position: 'absolute',
            left: CLOCK.x * k - pin / 2,
            top: CLOCK.y * k - pin / 2,
            width: pin,
            height: pin,
            borderRadius: pin,
            backgroundColor: '#fff',
          }} />
        </Animated.View>
        <Animated.Image
          source={require('../assets/brand/wordmark.png')}
          style={{
            position: 'absolute',
            left: WORD.x * k,
            top: WORD.y * k,
            width: WORD.width * k,
            height: WORD.height * k,
            opacity: word,
            transform: rise(word),
          }}
        />
        <Animated.Image
          source={require('../assets/brand/tagline.png')}
          style={{
            position: 'absolute',
            left: TAG.x * k,
            top: TAG.y * k,
            width: TAG.width * k,
            height: TAG.height * k,
            opacity: tagline,
            transform: rise(tagline),
          }}
        />
        <Animated.Image
          source={require('../assets/brand/full.jpg')}
          style={{ position: 'absolute', left: 0, top: 0, width: stage, height: stage, opacity: full }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', zIndex: 10, overflow: 'hidden' },
  hand: { position: 'absolute', alignItems: 'center' },
  tick: { position: 'absolute', backgroundColor: '#fff', opacity: 0.9 },
});
