import { requireOptionalNativeModule } from 'expo';

type ChronixAlarm = {
  show(title: string, body: string, url: string): Promise<void>;
  canUseFullScreen(): Promise<boolean>;
  openFullScreenSettings(): Promise<void>;
  // Eski APK'da yo'q (ixtiyoriy chaqiriladi): budilnik yopilgach ilova qulf ustida ko'rinmasin
  releaseLockScreen?(): Promise<void>;
};

// Expo Go va iOS'da yo'q: u yerda oddiy push ishlaydi
export const ChronixAlarmModule = requireOptionalNativeModule<ChronixAlarm>('ChronixAlarm');
