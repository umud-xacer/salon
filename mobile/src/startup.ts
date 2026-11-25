import { useEffect, useState } from 'react';

// Ilova ochilish tartibi: kirish animatsiyasi paytida og'ir ishlar (push ro'yxati, ruxsat oynalari, GPS, analitika,
// yangilanish tekshiruvi) boshlanmaydi — aks holda JS band bo'lib, animatsiya "qotib" qoladi (2026-11-25).
// afterSplash() — animatsiya tugagach (yoki u ko'rsatilmasa darhol) bajariladi. Xavfsizlik uchun 5 soniyadan keyin baribir.
let done = false;
let resolve: () => void = () => {};
const ready = new Promise<void>((r) => { resolve = r; });
setTimeout(() => markSplashDone(), 5000);

export function markSplashDone(): void {
  if (done) return;
  done = true;
  resolve();
}

/** Animatsiya tugagach (+ixtiyoriy kechikish) bajariladi */
export function afterSplash(fn: () => void, delayMs = 0): void {
  void ready.then(() => (delayMs ? setTimeout(fn, delayMs) : fn()));
}

export const splashFinished = () => done;

/** Komponent uchun: animatsiya tugadimi (og'ir ro'yxatlar shundan keyin chiziladi — chizish UI oqimini band qiladi) */
export function useSplashDone(): boolean {
  const [ok, setOk] = useState(done);
  useEffect(() => {
    if (done) return;
    let live = true;
    void ready.then(() => live && setOk(true));
    return () => { live = false; };
  }, []);
  return ok;
}
