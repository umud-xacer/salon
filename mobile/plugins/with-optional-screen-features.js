// Play ogohlantirishi: "android.hardware.screen.portrait" talab qilinadi (orientation: portrait sababli
// Android buni avtomatik "required" deb hisoblaydi). Ilova faqat vertikal ochiladi, lekin bu xususiyat
// qurilmada bo'lishi SHART emas — aks holda Play ba'zi planshet/Chromebook/XR qurilmalarni chiqarib tashlaydi.
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURES = ['android.hardware.screen.portrait', 'android.hardware.screen.landscape'];

module.exports = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const list = (manifest['uses-feature'] = manifest['uses-feature'] || []);
    for (const name of FEATURES) {
      const found = list.find((f) => f.$ && f.$['android:name'] === name);
      if (found) found.$['android:required'] = 'false';
      else list.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return cfg;
  });
