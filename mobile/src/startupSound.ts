// Ilova ochilganda qisqa brend ovozi (assets/sounds/startup_*.wav, scripts/make_startup_sound.py).
//  - Uch xil ovoz: Iliq (asosiy), Yengil, Kristall — Sozlamalarda tanlanadi va eshitib ko'riladi.
//  - Fayl ilova ishga tushishi bilan oldindan tayyorlanadi (prepareStartupSound, _layout.tsx), splash
//    animatsiyasi boshlanganda faqat play() qilinadi: ochilishdagi og'ir paytda yuklash ovozni bo'lmasin.
//  - Telefon tebranish/ovozsiz rejimida bo'lsa chalinmaydi: playsInSilentMode = false (TZ talabi).
//  - Sozlamalarda o'chirilsa chalinmaydi. Boshqa ilova musiqasini to'xtatmaydi (mixWithOthers).
//  - Fayllar OTA bilan kelgan (APK ichida emas) — downloadFirst bilan avval telefonga yuklanadi.
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

import * as SecureStore from './secure';

const KEY = 'chronix.startup_sound';
const KIND_KEY = 'chronix.startup_sound_kind';
const VOLUME = 0.85;

const SOUNDS = {
  warm: require('../assets/sounds/startup_warm.wav'),
  soft: require('../assets/sounds/startup_soft.wav'),
  crystal: require('../assets/sounds/startup_crystal.wav'),
} as const;

export type StartupSoundKind = keyof typeof SOUNDS;
export const STARTUP_SOUND_KINDS: StartupSoundKind[] = ['warm', 'soft', 'crystal'];

/**
 *  'played'   — ovoz chalina boshladi
 *  'silent'   — tizim chalishga yo'l qo'ymadi (telefon tebranish/ovozsiz rejimda)
 *  'disabled' — Sozlamalarda o'chirilgan
 *  'error'    — fayl yoki audio tizimi xatosi
 */
export type StartupSoundResult = 'played' | 'silent' | 'disabled' | 'error';

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

export function startupSoundKind(): StartupSoundKind {
  try {
    const saved = SecureStore.getItem(KIND_KEY);
    return saved && saved in SOUNDS ? (saved as StartupSoundKind) : 'warm';
  } catch {
    return 'warm';
  }
}

export async function setStartupSoundKind(kind: StartupSoundKind): Promise<void> {
  await SecureStore.setItemAsync(KIND_KEY, kind).catch(() => {});
}

let prepared: { kind: StartupSoundKind; player: AudioPlayer } | null = null;

function create(kind: StartupSoundKind): AudioPlayer {
  const player = createAudioPlayer(SOUNDS[kind], { downloadFirst: true });
  player.volume = VOLUME;
  return player;
}

function release(player: AudioPlayer) {
  try { player.remove(); } catch { /* allaqachon bo'shatilgan */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ilova ishga tushishi bilan (splash'dan oldin) chaqiriladi: fayl yuklanib, pleer tayyor turadi */
export function prepareStartupSound(): void {
  if (Platform.OS === 'web' || prepared || !startupSoundEnabled()) return;
  try {
    const kind = startupSoundKind();
    const player = create(kind);
    prepared = { kind, player };
    // Splash ko'rsatilmasa (masalan, budilnik bilan ochilganda) — pleer xotirada qolib ketmasin
    setTimeout(() => {
      if (prepared?.player === player) {
        prepared = null;
        release(player);
      }
    }, 15_000);
  } catch {
    prepared = null;
  }
}

export async function playStartupSound(
  opts: { force?: boolean; kind?: StartupSoundKind; check?: boolean } = {},
): Promise<StartupSoundResult> {
  if (Platform.OS === 'web' || (!opts.force && !startupSoundEnabled())) return 'disabled';
  const kind = opts.kind ?? startupSoundKind();
  let player: AudioPlayer | null = null;
  try {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
    if (prepared && prepared.kind === kind) {
      player = prepared.player;
      prepared = null;
    } else {
      player = create(kind);
    }
    for (let i = 0; i < 40 && !player.isLoaded; i++) await sleep(75);      // ko'pi bilan 3 s
    if (!player.isLoaded) {
      release(player);
      return 'error';
    }
    const p = player;
    p.play();
    setTimeout(() => release(p), 4_000);                                   // ovoz 2.6 s
    if (!opts.check) return 'played';
    // Sozlamalardagi tekshiruv: haqiqatan chalina boshladimi
    for (let i = 0; i < 15; i++) {
      await sleep(100);
      if (p.playing || p.currentTime > 0) return 'played';
    }
    return 'silent';
  } catch {
    if (player) release(player);
    return 'error';
  }
}
