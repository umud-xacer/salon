// Kamera orqali shtrix-kod o'qish. Faqat bitta ish qiladi: kod o'qilganda onDetected(matn) chaqiradi.
// Dekoder: brauzerning o'z BarcodeDetector'i (Android Chrome — tez), bo'lmasa @zxing (iPhone Safari, kompyuter).
// @zxing faqat kerak bo'lganda yuklanadi (alohida bo'lak), shuning uchun panelning asosiy hajmi oshmaydi.
// Kamera faqat HTTPS (yoki localhost) da ishlaydi; komponent yopilganda kamera albatta o'chiriladi.
import { useEffect, useRef, useState } from "react";

import { t } from "../i18n";

type Status = "starting" | "scanning" | "denied" | "nocamera" | "insecure" | "error";

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorCtor {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar", "qr_code"];

/** Dekoderni ishga tushiradi, to'xtatish funksiyasini qaytaradi */
async function startDecoder(video: HTMLVideoElement, emit: (text: string) => void): Promise<() => void> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes("ean_13")) {
        const detector = new Native({ formats });
        let alive = true;
        let timer = 0;
        const tick = async () => {
          if (!alive) return;
          try {
            if (video.readyState >= 2) {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            }
          } catch { /* kadr tayyor emas — keyingisida */ }
          if (alive) timer = window.setTimeout(tick, 150);
        };
        void tick();
        return () => { alive = false; window.clearTimeout(timer); };
      }
    } catch { /* o'z dekoderi ishlamadi — @zxing ga o'tamiz */ }
  }
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"), import("@zxing/library"),
  ]);
  const hints = new Map<number, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 120 });
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result) emit(result.getText());
  });
  return () => controls.stop();
}

export function BarcodeScanner({ onDetected }: { onDetected: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handler = useRef(onDetected);
  handler.current = onDetected;
  const [status, setStatus] = useState<Status>("starting");

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopDecoder = () => {};
    let last = { text: "", at: 0 };
    const emit = (text: string) => {
      const now = Date.now();
      if (cancelled || (text === last.text && now - last.at < 1500)) return;     // bitta kod qayta-qayta kelmasin
      last = { text, at: now };
      try { navigator.vibrate?.(60); } catch { /* tebranish yo'q */ }
      handler.current(text);
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(window.isSecureContext ? "nocamera" : "insecure");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError" ? "nocamera" : "error");
        return;
      }
      const video = videoRef.current;
      if (cancelled || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay — foydalanuvchi bosgandan keyin baribir boshlanadi */ }
      if (cancelled) return;
      setStatus("scanning");
      try {
        const stop = await startDecoder(video, emit);
        if (cancelled) stop(); else stopDecoder = stop;
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      stopDecoder();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const problem = {
    denied: t("Kameraga ruxsat berilmagan. Brauzer sozlamalarida shu sayt uchun kamerani yoqing yoki kodni qo'lda kiriting."),
    nocamera: t("Bu qurilmada kamera topilmadi. Kodni qo'lda kiriting yoki USB skanerdan foydalaning."),
    insecure: t("Kamera faqat himoyalangan (https) manzilda ishlaydi. Kodni qo'lda kiriting."),
    error: t("Kamerani ishga tushirib bo'lmadi. Kodni qo'lda kiriting."),
  }[status as Exclude<Status, "starting" | "scanning">];

  if (problem) {
    return <p role="alert" className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">{problem}</p>;
  }
  return (
    <div className="relative overflow-hidden rounded-xl bg-navy">
      <video ref={videoRef} muted playsInline autoPlay className="block aspect-[4/3] w-full object-cover" />
      {/* Mo'ljal ramkasi: kodni shu yerga to'g'rilash kerak */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[38%] -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
      <p className="absolute inset-x-0 bottom-0 bg-navy/70 px-3 py-2 text-center text-xs text-white">
        {status === "starting" ? t("Kamera yoqilmoqda…") : t("Shtrix-kodni ramka ichiga to'g'rilang")}
      </p>
    </div>
  );
}
