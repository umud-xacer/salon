// API bilan yagona aloqa nuqtasi. Access token xotirada, refresh token localStorage'da.
import type { LoginResponse } from "./types";

const BASE = "/api/v1";
const REFRESH_KEY = "chronix.refresh";

let accessToken: string | null = null;
let onSessionLost: () => void = () => {};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

function readRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefresh(token: string | null) {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    // Saqlab bo'lmasa, sessiya faqat shu oynada yashaydi
  }
}

export function storeSession(tokens: { access_token: string; refresh_token: string }) {
  accessToken = tokens.access_token;
  writeRefresh(tokens.refresh_token);
}

export function clearSession() {
  accessToken = null;
  writeRefresh(null);
}

export function hasSession() {
  return accessToken !== null || readRefresh() !== null;
}

async function parseError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  if (detail && typeof detail === "object" && "message" in detail) {
    return new ApiError(res.status, detail.code ?? "error", detail.message);
  }
  // Maydon tekshiruvi xatosi (422): birinchi sababni ko'rsatamiz
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
    return new ApiError(res.status, "validation", detail[0].msg.replace(/^Value error, /, ""));
  }
  return new ApiError(res.status, "error", "So'rov bajarilmadi. Qayta urinib ko'ring.");
}

async function doRefresh(): Promise<boolean> {
  const token = readRefresh();
  if (!token) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) clearSession();
    return false;
  }
  storeSession(await res.json());
  return true;
}

let refreshing: Promise<boolean> | null = null;

// Refresh token bir martalik: bir nechta so'rov ham, ikkita varaq ham uni bir vaqtda ishlatmasin
function refreshOnce(): Promise<boolean> {
  refreshing ??= (navigator.locks ? navigator.locks.request("chronix-refresh", doRefresh) : doRefresh()).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(BASE + path, { ...init, headers });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken && readRefresh()) await refreshOnce();
  let res = await send(path, init);
  if (res.status === 401 && (await refreshOnce())) res = await send(path, init);
  if (res.status === 401) {
    clearSession();
    onSessionLost();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export const loginWithPassword = (phone: string, password: string) =>
  publicPost<LoginResponse>("/auth/login", { phone, password });

export const requestOtp = (phone: string) =>
  publicPost<{ expires_in: number; dev_code: string | null }>("/auth/otp/request", { phone });

export const verifyOtp = (phone: string, code: string) =>
  publicPost<LoginResponse>("/auth/otp/verify", { phone, code });

export async function logout() {
  const token = readRefresh();
  clearSession();
  if (token) {
    await fetch(`${BASE}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    }).catch(() => {});
  }
}
