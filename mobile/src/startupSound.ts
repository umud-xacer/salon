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
const VOLUME = 0.9;

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

/**
 * Natija (Sozlamalardagi tekshiruv uchun):
 *  'played'   — ovoz chalina boshladi
 *  'silent'   — tizim chalishga yo'l qo'ymadi (telefon tebranish/ovozsiz rejimda: Android'da
 *               expo-audio ringerMode != NORMAL bo'lsa play() ni o'tkazib yuboradi)
 *  'disabled' — Sozlamalarda o'chirilgan
 *  'error'    — fayl yoki audio tizimi xatosi
 */
export type StartupSoundResult = 'played' | 'silent' | 'disabled' | 'error';

/** force: Sozlamalarda yoqilganda namuna sifatida (saqlash tugashini kutmasdan) */
export async function playStartupSound(force = false): Promise<StartupSoundResult> {
  if (Platform.OS === 'web' || (!force && !startupSoundEnabled())) return 'disabled';
  try {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
    // Fayl OTA bilan kelgan (APK ichida emas): avval telefonga yuklab olinadi (downloadFirst), so'ng
    // pleer tayyor bo'lgach chalinadi. Yuklanmagan pleerda play() jimgina hech narsa qilmaydi.
    const player = createAudioPlayer(require('../assets/sounds/startup.wav'), { updateInterval: 100, downloadFirst: true });
    player.volume = VOLUME;
    for (let i = 0; i < 40 && !player.isLoaded; i++) {
      await new Promise((r) => setTimeout(r, 75));       // ko'pi bilan 3 s
    }
    if (!player.isLoaded) {
      try { player.remove(); } catch { /* bo'shatilgan */ }
      return 'error';
    }
    let released = false;
    let started = false;
    let failed = false;
    const release = () => {
      if (released) return;
      released = true;
      sub.remove();
      try { player.remove(); } catch { /* allaqachon bo'shatilgan */ }
    };
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.playing || s.currentTime > 0) started = true;
      if ((s as { error?: string | null }).error) failed = true;
      if (s.didJustFinish) release();
    });
    player.play();
    setTimeout(release, 5_000);      // hodisa kelmasa ham xotira bo'shatiladi
    // Fayl yuklanib chalina boshlashini 1.5 s gacha kutamiz
    for (let i = 0; i < 15 && !started && !failed; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!released && (player.playing || player.currentTime > 0)) started = true;
    }
    if (started) return 'played';
    release();
    return failed ? 'error' : 'silent';
  } catch {
    // ovoz chiqmasa ham ilova ochilishi to'xtamasin
    return 'error';
  }
}
