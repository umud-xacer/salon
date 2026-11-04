"""Panellarni domen bo'yicha ajratish (foydalanuvchi talabi, 2026-11-04).

  ega.ariqalqon.uz  — faqat Super Admin
  www.ariqalqon.uz  — direktorlar va xodimlar (Super Admin bu yerda kira olmaydi)
  api.ariqalqon.uz  — mobil ilova (cheklov yo'q)

Veb-panel API'ni o'z domeni orqali chaqiradi (Caddy /api ni uzatadi, Host o'zgarmaydi), shuning uchun
server so'rov qaysi paneldan kelganini Host bo'yicha aniq biladi. Ro'yxatlar bo'sh bo'lsa (dev, testlar) — cheklov yo'q.
"""
from fastapi import HTTPException, Request

from app.core.config import get_settings


def _host(request: Request) -> str:
    return (request.headers.get("host") or "").split(":")[0].strip().lower()


def check_panel(request: Request, is_superadmin: bool) -> None:
    s = get_settings()
    host = _host(request)
    if host in s.admin_panel_hosts and not is_superadmin:
        raise HTTPException(403, detail={
            "code": "wrong_panel",
            "message": f"Bu Super Admin paneli. Salon paneliga kiring: {s.business_panel_url}"})
    if host in s.business_panel_hosts and is_superadmin:
        raise HTTPException(403, detail={
            "code": "wrong_panel",
            "message": f"Super Admin bu yerdan kirmaydi. Boshqaruv paneli: {s.admin_panel_url}"})
