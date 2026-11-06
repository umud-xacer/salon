// UZ | RU almashtirgich (kirish ekrani, sozlamalar). Tanlansa ilova yangi tilda qayta ochiladi.
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { getLang, setLang, t, type Lang } from './i18n';
import { colors } from './ui';

export const LANG_NAMES: Record<Lang, string> = { uz: "O'zbekcha", ru: 'Русский' };

export function LangSwitch() {
  const lang = getLang();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Til / Язык">
      {(['uz', 'ru'] as const).map((l) => (
        <Pressable key={l} onPress={() => void setLang(l)} accessibilityRole="radio" accessibilityState={{ selected: lang === l }}
          style={[styles.item, lang === l && styles.on]}>
          <Text style={[styles.text, lang === l && styles.textOn]}>{l.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Profil va sozlamalardan: tizim oynasida tanlash */
export function chooseLanguage() {
  Alert.alert(t('Tilni tanlang'), undefined, [
    { text: LANG_NAMES.uz, onPress: () => void setLang('uz') },
    { text: LANG_NAMES.ru, onPress: () => void setLang('ru') },
    { text: t('Bekor qilish'), style: 'cancel' },
  ]);
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignSelf: 'flex-end', padding: 3, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  item: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  on: { backgroundColor: colors.primary },
  text: { fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.5 },
  textOn: { color: '#fff' },
});
