import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';

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
  const spin = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const full = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    const step = (value: Animated.Value, duration: number, toValue = 1) =>
      Animated.timing(value, { toValue, duration, useNativeDriver: true, easing: Easing.out(Easing.cubic) });

    (async () => {
      const reduced = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      if (cancelled) return;
      onReady();
      Animated.sequence([
        step(spin, reduced ? 0 : 900),
        Animated.parallel([step(move, reduced ? 0 : 480), step(word, 420)]),
        step(tagline, 260),
        step(full, 320),
        Animated.delay(500),
        step(exit, 280, 0),
      ]).start(({ finished }) => finished && onDone());
    })();
    return () => {
      cancelled = true;
    };
  }, [spin, move, word, tagline, full, exit, onReady, onDone]);

  const k = (Math.min(width * CONTENT_SHARE, MAX_CONTENT)) / WORD.width;
  const stage = IMAGE * k;
  const markSize = MARK.size * k;

  // Boshlanish holati tizim splash'i bilan bir xil: belgi ekran markazida, 190 kenglikda
  const startX = (IMAGE / 2 - (MARK.x + MARK.size / 2)) * k;
  const startY = (IMAGE / 2 - (MARK.y + MARK.size / 2)) * k;
  const rise = (value: Animated.Value) => [{
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
