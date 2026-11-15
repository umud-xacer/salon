// UZ | RU almashtirgich (kirish ekrani, sozlamalar). Tanlansa ilova yangi tilda qayta ochiladi.
import { Alert, Pressable, Text, View } from 'react-native';

import { getLang, setLang, t, type Lang } from './i18n';
import { makeStyles } from './theme';

export const LANG_NAMES: Record<Lang, string> = { uz: "O'zbekcha", ru: 'Русский' };

/** `glass` — gradient/rasm ustida (kirish ekrani) */
export function LangSwitch({ glass }: { glass?: boolean }) {
  const lang = getLang();
  const styles = useStyles();
  return (
    <View style={[styles.wrap, glass && styles.glass]} accessibilityRole="radiogroup" accessibilityLabel="Til / Язык">
      {(['uz', 'ru'] as const).map((l) => (
        <Pressable key={l} onPress={() => void setLang(l)} accessibilityRole="radio" accessibilityState={{ selected: lang === l }}
          style={[styles.item, lang === l && styles.on]}>
          <Text style={[styles.text, glass && { color: 'rgba(255,255,255,0.8)' }, lang === l && styles.textOn]}>{l.toUpperCase()}</Text>
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

const useStyles = makeStyles((c) => ({
  wrap: { flexDirection: 'row', alignSelf: 'flex-end', padding: 3, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
  glass: { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.28)' },
  item: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9 },
  on: { backgroundColor: c.cta },
  text: { fontSize: 12, fontWeight: '800', color: c.muted, letterSpacing: 0.5 },
  textOn: { color: c.ctaText },
}));
