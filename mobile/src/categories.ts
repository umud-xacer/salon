// Yo'nalish (kategoriya) belgilari: slug yoki nom bo'yicha
import { Category } from './api';
import { IconName } from './ui';

const CATEGORY_ICONS: [RegExp, IconName][] = [
  [/barber/i, 'cut-outline'],
  [/pharm|dorixona|apteka/i, 'medical-outline'],
  [/^ent$|otorino|^lor/i, 'ear-outline'],
  [/clinic|klinika|stomat|dent/i, 'medkit-outline'],
  [/spa|massaj|massage/i, 'leaf-outline'],
  [/kosmet|cosmet/i, 'sparkles-outline'],
  [/nail|tirnoq|manik/i, 'hand-left-outline'],
  [/fitness|sport/i, 'barbell-outline'],
  [/salon|beauty|go'zal/i, 'color-wand-outline'],
];

export const categoryIcon = (c: Category): IconName =>
  CATEGORY_ICONS.find(([re]) => re.test(c.slug) || re.test(c.name_uz))?.[1] ?? 'grid-outline';

/** Yo'nalish ranglari: [yorug' fon, yorug' belgi, tungi fon, tungi belgi] */
const TINTS: [RegExp, [string, string, string, string]][] = [
  [/barber/i, ['#ECEDEF', '#2A2D34', 'rgba(255,255,255,0.08)', '#D5D8DE']],
  [/^ent$|otorino|^lor/i, ['#E0F5F1', '#0E7C6B', 'rgba(80,210,190,0.12)', '#7FDCCB']],
  [/clinic|klinika|stomat|dent/i, ['#E3EEFF', '#1A5CE6', 'rgba(127,162,255,0.14)', '#9CB8FF']],
  [/spa|massaj|massage/i, ['#F6EEDF', '#8A6232', 'rgba(232,200,150,0.12)', '#E3C79A']],
  [/pharm|dorixona|apteka/i, ['#E6F4EC', '#0B7A50', 'rgba(95,211,162,0.12)', '#5FD3A2']],
  [/salon|beauty|go'zal|kosmet|nail/i, ['#FDE7F0', '#B0447A', 'rgba(240,120,170,0.14)', '#F59AC1']],
];

export function categoryTint(c: Category, dark: boolean): { bg: string; fg: string } {
  const t = TINTS.find(([re]) => re.test(c.slug) || re.test(c.name_uz))?.[1] ?? ['#EEF1F7', '#3A4250', 'rgba(255,255,255,0.08)', '#C9D0DC'];
  return dark ? { bg: t[2], fg: t[3] } : { bg: t[0], fg: t[1] };
}
