import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';

import { colors } from './ui';

const SIZE = 190;
const SCALE = SIZE / 470;                       // ring.png manbada 470 px
const CLOCK = { x: 250 * SCALE, y: 255 * SCALE };
const HAND_WIDTH = 11 * SCALE;
const TICK = { length: 26 * SCALE, offset: 98 * SCALE };

function Hand({ length, angle }: { length: number; angle: Animated.AnimatedInterpolation<string> }) {
  // Blok ikki uzunlikda, soat markazida: burilganda strelka uchi emas, asosi joyida qoladi
  return (
    <Animated.View style={[styles.hand, {
      left: CLOCK.x - length,
      top: CLOCK.y - length,
      width: length * 2,
      height: length * 2,
      transform: [{ rotate: angle }],
    }]}>
      <View style={{ width: HAND_WIDTH, height: length, borderRadius: HAND_WIDTH, backgroundColor: '#fff' }} />
    </Animated.View>
  );
}

const TICKS = [0, 90, 180, 270];

export function AnimatedSplash({ onReady, onDone }: { onReady: () => void; onDone: () => void }) {
  const ring = useRef(new Animated.Value(0)).current;
  const clock = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
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
        step(ring, 450),
        Animated.parallel([step(clock, 200), step(spin, reduced ? 0 : 850)]),
        step(word, 320),
        step(tagline, 260),
        Animated.delay(350),
        step(exit, 280, 0),
      ]).start(({ finished }) => finished && onDone());
    })();
    return () => {
      cancelled = true;
    };
  }, [ring, clock, spin, word, tagline, exit, onReady, onDone]);

  const rise = (value: Animated.Value) => [{
    translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
  }];

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: exit }]}>
      <Animated.View style={{
        width: SIZE,
        height: SIZE,
        opacity: ring,
        transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
      }}>
        <Image source={require('../assets/brand/ring.png')} style={{ width: SIZE, height: SIZE }} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: clock }]}>
          {TICKS.map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const horizontal = deg % 180 !== 0;
            return (
              <View key={deg} style={[styles.tick, {
                left: CLOCK.x + Math.sin(rad) * TICK.offset - (horizontal ? TICK.length : HAND_WIDTH) / 2,
                top: CLOCK.y - Math.cos(rad) * TICK.offset - (horizontal ? HAND_WIDTH : TICK.length) / 2,
                width: horizontal ? TICK.length : HAND_WIDTH,
                height: horizontal ? HAND_WIDTH : TICK.length,
              }]} />
            );
          })}
          <Hand length={59 * SCALE} angle={spin.interpolate({ inputRange: [0, 1], outputRange: ['-140deg', '-50deg'] })} />
          <Hand length={95 * SCALE} angle={spin.interpolate({ inputRange: [0, 1], outputRange: ['-305deg', '55deg'] })} />
          <View style={styles.pin} />
        </Animated.View>
      </Animated.View>
      <Animated.Image
        source={require('../assets/brand/wordmark.png')}
        style={[styles.wordmark, { opacity: word, transform: rise(word) }]}
        resizeMode="contain"
      />
      <Animated.Image
        source={require('../assets/brand/tagline.png')}
        style={[styles.tagline, { opacity: tagline, transform: rise(tagline) }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const PIN = 26 * SCALE;

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  hand: { position: 'absolute', alignItems: 'center' },
  tick: { position: 'absolute', backgroundColor: '#fff', borderRadius: HAND_WIDTH, opacity: 0.9 },
  pin: {
    position: 'absolute',
    left: CLOCK.x - PIN / 2,
    top: CLOCK.y - PIN / 2,
    width: PIN,
    height: PIN,
    borderRadius: PIN,
    backgroundColor: '#fff',
  },
  wordmark: { width: 240, height: 58, marginTop: 28 },
  tagline: { width: 250, height: 23, marginTop: 10 },
});
