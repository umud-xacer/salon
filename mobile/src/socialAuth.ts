// Telegram / Google orqali kirish uchun umumiy yordamchilar.
// * pendingLink — Google hisobi hali raqamga bog'lanmagan: raqam (SMS yoki Telegram) tasdiqlanganda
//   shu token yuboriladi va Google hisobi bog'lanadi. Keyingi safar Google bilan bir bosishda kirish.
// * Google native moduli faqat yangi APK/AAB da bor: eski ilovada (OTA bilan kelgan kod) tugma ko'rinmaydi.
import { api, LoginOut } from './api';

let pendingLink: string | null = null;
export const getPendingLink = () => pendingLink;
export const setPendingLink = (v: string | null) => { pendingLink = v; };

// sms: telefon + kod bilan kirish. Server o'chirib qo'yishi mumkin (SMS_LOGIN_ENABLED=false, masalan Eskiz
// hali test rejimida) — u holda kirish faqat Telegram/Google orqali. Eski server javobida bo'lmasa — yoqiq.
export type LoginMethods = { sms: boolean; telegram: boolean; google: boolean };
export type AppInfo = { login_methods?: Partial<LoginMethods>; google_web_client_id?: string | null };

export async function loadLoginMethods(): Promise<{ methods: LoginMethods; googleClientId: string | null }> {
  try {
    const info = await api<AppInfo>('/catalog/app-info');
    const googleClientId = info.google_web_client_id ?? null;
    return {
      methods: {
        sms: info.login_methods?.sms !== false,
        telegram: !!info.login_methods?.telegram,
        google: !!info.login_methods?.google && !!googleClientId && googleAvailable(),
      },
      googleClientId,
    };
  } catch {
    return { methods: { sms: true, telegram: false, google: false }, googleClientId: null };
  }
}

type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleModule | null | undefined;

function loadGoogle(): GoogleModule | null {
  if (google !== undefined) return google;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@react-native-google-signin/google-signin') as GoogleModule;
    // Native modul yo'q bo'lsa (eski APK) chaqiruv xato beradi — oldindan tekshiramiz
    if (typeof m.GoogleSignin?.configure !== 'function') throw new Error('no native');
    google = m;
  } catch {
    google = null;
  }
  return google;
}

export function googleAvailable(): boolean {
  return loadGoogle() !== null;
}

export type GoogleResult = { kind: 'login'; login: LoginOut } | { kind: 'link' } | { kind: 'cancelled' };

export async function signInWithGoogle(webClientId: string): Promise<GoogleResult> {
  const m = loadGoogle();
  if (!m) throw new Error('google_unavailable');
  m.GoogleSignin.configure({ webClientId });
  await m.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await m.GoogleSignin.signIn();
  if (!m.isSuccessResponse(res) || !res.data.idToken) return { kind: 'cancelled' };
  const out = await api<{ need_phone: boolean; link_token: string | null; login: LoginOut | null }>(
    '/auth/google', { method: 'POST', body: { id_token: res.data.idToken } });
  if (out.login) return { kind: 'login', login: out.login };
  setPendingLink(out.link_token);
  return { kind: 'link' };
}
