// Face ID / barmoq izi taklifi (prototip "D"). Yoqilsa, ilova ochilganda shaxs tasdiqlanadi.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../src/auth';
import { bioCheck, bioKind, setBioAsked, setBioLock } from '../src/biometric';
import { t } from '../src/i18n';
import { Button, Glass, Icon, makeStyles, Steps, useTheme, useType } from '../src/ui';

function Ring({ delay }: { delay: number }) {
  const { c } = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 2400, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', width: 168, height: 168, borderRadius: 84, borderWidth: 2, borderColor: c.accent,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.35] }) }],
    }} />
  );
}

export default function Biometric() {
  const { setSetup } = useAuth();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const s = useStyles();
  const ty = useType();
  const [kind, setKind] = useState<'face' | 'finger' | null>('face');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bioKind().then(setKind);
  }, []);

  const finish = () => {
    void setBioAsked();
    setSetup(null);
  };

  const enable = async () => {
    setBusy(true);
    if (await bioCheck()) {
      await setBioLock(true);
      setDone(true);
    }
    setBusy(false);
  };

  const name = kind === 'finger' ? t("Barmoq izi") : 'Face ID';
  const perks = [t("Kod kiritish shart emas"), t("Ma'lumotlar faqat telefoningizda"), t("Bronlar va to'lovlar himoyalangan")];

  return (
    <View style={[s.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <View style={[s.blob, { backgroundColor: c.accentSoft }]} />
      <View style={{ height: 44, justifyContent: 'center' }}><Steps step={3} total={3} /></View>
      <View style={s.center}>
        <View style={s.ringBox}>
          <Ring delay={0} />
          <Ring delay={1200} />
          <Glass style={s.circle} intensity={50}>
            <Icon name={done ? 'checkmark-circle-outline' : kind === 'finger' ? 'finger-print-outline' : 'scan-outline'} size={76} color={c.accent} />
          </Glass>
        </View>
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Text style={[ty.h1, { textAlign: 'center' }]}>{done ? t("Tayyor!") : t("Tez va xavfsiz kirish")}</Text>
          <Text style={[ty.body, { color: c.muted, textAlign: 'center', lineHeight: 22 }]}>
            {done
              ? t("Endi ilovani bir qarashda ochasiz. Sozlamalardan istalgan vaqt o'chirish mumkin.")
              : t("Har safar SMS kutmasdan, {a} bilan bir zumda kiring.", { a: name })}
          </Text>
        </View>
        <View style={{ gap: 10, alignSelf: 'stretch' }}>
          {perks.map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={s.tick}><Icon name="checkmark" size={16} color={c.accent} /></View>
              <Text style={[ty.body, { fontWeight: '500' }]}>{p}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 6 }}>
        {done
          ? <Button title={t("Boshlash")} onPress={finish} />
          : <Button title={t("{a} ni yoqish", { a: name })} onPress={enable} busy={busy} disabled={!kind} />}
        {!done && <Button title={t("Keyinroq")} kind="ghost" onPress={finish} />}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: 24, overflow: 'hidden' },
  blob: { position: 'absolute', width: 420, height: 420, borderRadius: 210, left: -15, top: 140 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 34 },
  ringBox: { width: 168, height: 168, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 168, height: 168, borderRadius: 84, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 28, height: 28, borderRadius: 9, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
}));
