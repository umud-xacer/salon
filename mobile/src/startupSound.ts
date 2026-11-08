// Ilova ochilganda qisqa brend ovozi (assets/sounds/startup.wav, scripts/make_startup_sound.py).
//  - AnimatedSplash animatsiyasi bilan bir vaqtda boshlanadi (strelkalar aylanishi -> akkord).
//  - Telefon ovozsiz / tebranish rejimida bo'lsa chalinmaydi: playsInSilentMode = false
//    (iOS va Android tizim qoidasi, expo-audio SDK 58).
//  - Foydalanuvchi Sozlamalarda o'chirib qo'ysa — chalinmaydi (qurilmada saqlanadi).
//  - Boshqa ilovadagi musiqani to'xtatmaydi (mixWithOthers), xato bo'lsa jim o'tib ketadi.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

import * as SecureStore from './secure';

const KEY = 'chronix.startup_sound';
const VOLUME = 0.6;

export function startupSoundEnabled(): boolean {
  try {
    return SecureStore.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export async function setStartupSoundEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, on ? 'on' : 'off').catch(() => {});
}

/** force: Sozlamalarda yoqilganda namuna sifatida (saqlash tugashini kutmasdan) */
export async function playStartupSound(force = false): Promise<void> {
  if (Platform.OS === 'web' || (!force && !startupSoundEnabled())) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
    const player = createAudioPlayer(require('../assets/sounds/startup.wav'));
    player.volume = VOLUME;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      sub.remove();
      try { player.remove(); } catch { /* allaqachon bo'shatilgan */ }
    };
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) release();
    });
    player.play();
    setTimeout(release, 5_000);      // hodisa kelmasa ham xotira bo'shatiladi
  } catch {
    // ovoz chiqmasa ham ilova ochilishi to'xtamasin
  }
}
