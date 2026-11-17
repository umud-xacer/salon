// Budilnik bloklangan ekran ustida ochilishi va ekranni yoqishi.
// Ilgari asosiy oynaga doimiy showWhenLocked/turnScreenOn berilardi — butun ilova qulf ustida ko'rinardi.
// Endi bu kodda (modules/chronix-alarm: ChronixAlarmPackage) faqat chronix://alarm havolasi uchun yoqiladi.
// Plagin eski prebuild natijasida qolgan atributlarni olib tashlaydi.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    delete activity.$['android:showWhenLocked'];
    delete activity.$['android:turnScreenOn'];
    return cfg;
  });
