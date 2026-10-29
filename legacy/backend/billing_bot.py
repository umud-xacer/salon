"""
SalonPro Billing Bot — Telegram orqali Click/Payme to'lov
"""
import asyncio, logging, httpx, json, base64
from datetime import date

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("billing_bot")

user_states = {}  # chat_id -> state


# ══════════════════════ DB HELPERS ══════════════════════
def get_bot_config():
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        def _g(k):
            s = db.query(models.SystemSettings).filter(models.SystemSettings.key == k).first()
            return s.value if s else ""
        return {
            "token": _g("billing_bot_token"), "chat_id": _g("billing_bot_chat_id"),
            "click_merchant": _g("click_merchant_id"), "click_service": _g("click_service_id"),
            "payme_merchant": _g("payme_merchant_id"),
            "app_base_url": _g("app_base_url"),
        }
    finally:
        db.close()


def get_tariffs():
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        return [{"id": t.id, "name": t.name, "plan": t.plan, "price": t.price, "duration_days": t.duration_days}
                for t in db.query(models.Tariff).filter(models.Tariff.is_active == True).order_by(models.Tariff.price).all()]
    finally:
        db.close()


def find_salon_by_phone(phone):
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        clean = phone.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        if clean.startswith("8"): clean = "+998" + clean[1:]
        if not clean.startswith("+"): clean = "+" + clean
        last9 = clean[-9:] if len(clean) >= 9 else clean
        for s in db.query(models.Salon).all():
            sc = (s.phone or "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
            if sc and sc[-9:] == last9:
                dl = None
                if s.expires_at:
                    try: dl = (date.fromisoformat(s.expires_at) - date.today()).days
                    except: pass
                return {"id": s.id, "name": s.name, "phone": s.phone, "is_active": s.is_active,
                        "expires_at": s.expires_at, "plan": s.plan, "days_left": dl, "owner_name": s.owner_name}
        return None
    finally:
        db.close()


def find_salon_by_chat(chat_id):
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        s = db.query(models.Salon).filter(models.Salon.admin_chat_id == str(chat_id)).first()
        if not s: return None
        dl = None
        if s.expires_at:
            try: dl = (date.fromisoformat(s.expires_at) - date.today()).days
            except: pass
        return {"id": s.id, "name": s.name, "phone": s.phone, "is_active": s.is_active,
                "expires_at": s.expires_at, "plan": s.plan, "days_left": dl, "owner_name": s.owner_name}
    finally:
        db.close()


def link_chat(salon_id, chat_id):
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        s = db.query(models.Salon).filter(models.Salon.id == salon_id).first()
        if s: s.admin_chat_id = str(chat_id); db.commit(); return True
        return False
    finally:
        db.close()


def create_pending_payment(salon_id, tariff_id, provider):
    """Pending to'lov yaratish — foydalanuvchi to'lagach confirm bo'ladi."""
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        tariff = db.query(models.Tariff).filter(models.Tariff.id == tariff_id).first()
        if not tariff: return None
        txn = models.Transaction(
            salon_id=salon_id, tariff_id=tariff.id,
            amount=tariff.price, provider=provider,
            status="pending", tariff_name=tariff.name,
            duration_days=tariff.duration_days,
            note=f"{provider.upper()} orqali kutilmoqda",
        )
        db.add(txn); db.commit(); db.refresh(txn)
        return {"txn_id": txn.id, "amount": tariff.price, "tariff_name": tariff.name,
                "duration_days": tariff.duration_days, "plan": tariff.plan}
    finally:
        db.close()


def confirm_payment(txn_id):
    """To'lov callback orqali tasdiqlanganini tekshirish (manual confirm qilmaydi)."""
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        txn = db.query(models.Transaction).filter(models.Transaction.id == txn_id).first()
        if not txn:
            return None
        if txn.status != "completed":
            return {"pending": True, "provider": txn.provider}
        salon = db.query(models.Salon).filter(models.Salon.id == txn.salon_id).first()
        if not salon:
            return None
        today = date.today()
        new_exp = today
        if salon.expires_at:
            try:
                new_exp = date.fromisoformat(salon.expires_at)
            except Exception:
                pass
        return {"salon_name": salon.name, "salon_id": salon.id, "tariff_name": txn.tariff_name,
                "amount": txn.amount, "new_expires": str(new_exp),
                "days_left": (new_exp - today).days, "provider": txn.provider, "today": str(today)}
    finally:
        db.close()


def get_payments(salon_id, limit=5):
    from database import SessionLocal
    import models
    from sqlalchemy import desc
    db = SessionLocal()
    try:
        txns = db.query(models.Transaction).filter(
            models.Transaction.salon_id == salon_id,
        ).order_by(desc(models.Transaction.created_at)).limit(limit).all()
        return [{"tariff": t.tariff_name, "amount": t.amount, "date": str(t.created_at)[:10],
                 "provider": t.provider, "status": t.status} for t in txns]
    finally:
        db.close()


def generate_click_url(config, amount, salon_id, txn_id):
    merchant = config.get("click_merchant") or "DEMO"
    service = config.get("click_service") or "DEMO"
    return_url = (config.get("app_base_url") or "https://t.me/SalonProBillingBot").rstrip("/")
    return (f"https://my.click.uz/services/pay?"
            f"service_id={service}&merchant_id={merchant}"
            f"&amount={int(amount)}&transaction_param={txn_id}"
            f"&return_url={return_url}")


def generate_payme_url(config, amount, salon_id, txn_id):
    merchant = config.get("payme_merchant") or "DEMO"
    # Payme tijorat format: base64 encoded params
    params = f"m={merchant};ac.order_id={txn_id};a={int(amount * 100)}"
    encoded = base64.b64encode(params.encode()).decode()
    return f"https://checkout.paycom.uz/{encoded}"


# ══════════════════════ TELEGRAM BOT ══════════════════════
class BillingBot:
    def __init__(self, token):
        self.token = token
        self.base = f"https://api.telegram.org/bot{token}"
        self.offset = 0

    async def send(self, chat_id, text, markup=None):
        data = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                "disable_web_page_preview": True}
        if markup: data["reply_markup"] = json.dumps(markup)
        async with httpx.AsyncClient(timeout=15) as c:
            await c.post(f"{self.base}/sendMessage", json=data)

    async def answer_cb(self, cb_id, text=""):
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(f"{self.base}/answerCallbackQuery",
                         json={"callback_query_id": cb_id, "text": text[:200]})

    async def get_updates(self):
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{self.base}/getUpdates",
                           params={"offset": self.offset, "timeout": 20})
            data = r.json()
            if data.get("ok") and data.get("result"):
                for u in data["result"]:
                    self.offset = u["update_id"] + 1
                return data["result"]
            return []

    def status_text(self, s):
        st = "🟢 Faol" if s["is_active"] else "🔴 Bloklangan"
        dl = ""
        if s["days_left"] is not None:
            if s["days_left"] < 0: dl = "\n⛔ Muddati o'tgan!"
            elif s["days_left"] <= 3: dl = f"\n⚠️ Faqat {s['days_left']} kun qoldi!"
            else: dl = f"\n⏳ {s['days_left']} kun qoldi"
        return (f"━━━━━━━━━━━━━━━━━━━━\n"
                f"🏪 {s['name']}\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"👤 Egasi: {s.get('owner_name','—')}\n"
                f"📞 Tel: {s.get('phone','—')}\n"
                f"📊 Status: {st}\n"
                f"📋 Tarif: {s['plan'].upper()}\n"
                f"📅 Muddat: {s['expires_at'] or '—'}{dl}\n"
                f"━━━━━━━━━━━━━━━━━━━━")

    # ─── MESSAGE HANDLER ───
    async def handle_msg(self, msg):
        cid = msg["chat"]["id"]
        text = msg.get("text", "").strip()
        name = msg["chat"].get("first_name", "")
        salon = find_salon_by_chat(cid)

        if text == "/start":
            if salon:
                await self.send(cid,
                    f"👋 Assalomu alaykum, <b>{name}</b>!\n\n"
                    f"{self.status_text(salon)}\n\n"
                    f"📌 <b>Menyu:</b>",
                    markup={"inline_keyboard": [
                        [{"text": "💳 To'lov qilish", "callback_data": "tariffs"}],
                        [{"text": "📊 Status", "callback_data": "status"},
                         {"text": "📃 Tarix", "callback_data": "history"}],
                        [{"text": "❓ Yordam", "callback_data": "help"}],
                    ]})
            else:
                user_states[cid] = "phone"
                await self.send(cid,
                    f"👋 <b>{name}</b>, xush kelibsiz!\n\n"
                    f"🏪 <b>SalonPro Billing Bot</b>\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n\n"
                    f"Saloningizni topish uchun SalonPro\n"
                    f"dasturida ro'yxatdan o'tgan <b>telefon\n"
                    f"raqamingizni</b> kiriting:\n\n"
                    f"📱 Masalan: <code>+998901234567</code>")

        elif user_states.get(cid) == "phone":
            phone = text
            if msg.get("contact"): phone = msg["contact"].get("phone_number", "")
            found = find_salon_by_phone(phone)
            if found:
                link_chat(found["id"], cid)
                user_states.pop(cid, None)
                await self.send(cid,
                    f"✅ <b>Muvaffaqiyatli ulandi!</b>\n\n"
                    f"{self.status_text(found)}\n\n"
                    f"💳 To'lov qilish uchun pastdagi\ntugmani bosing:",
                    markup={"inline_keyboard": [
                        [{"text": "💳 To'lov qilish", "callback_data": "tariffs"}],
                        [{"text": "📊 Status", "callback_data": "status"}],
                    ]})
            else:
                await self.send(cid,
                    f"❌ <b>Salon topilmadi!</b>\n\n"
                    f"Bu raqam bilan ro'yxatdan o'tilmagan.\n"
                    f"Qayta kiriting: <code>+998XXXXXXXXX</code>")

        elif text == "/pay": await self.show_tariffs(cid)
        elif text == "/status": await self.show_status(cid)
        elif text == "/history": await self.show_history(cid)
        elif text == "/help": await self.show_help(cid)

    async def show_tariffs(self, cid):
        salon = find_salon_by_chat(cid)
        if not salon:
            user_states[cid] = "phone"
            await self.send(cid, "📱 Avval telefon raqamingizni kiriting:")
            return
        tariffs = get_tariffs()
        if not tariffs:
            await self.send(cid, "⚠️ Tariflar mavjud emas."); return
        txt = (f"📋 <b>Tarif tanlang</b>\n"
               f"━━━━━━━━━━━━━━━━━━━━\n"
               f"🏪 {salon['name']}\n\n")
        btns = []
        for t in tariffs:
            if t["price"] > 0:
                txt += f"▫️ {t['name']} — <b>{int(t['price']):,}</b> so'm\n   ⏱ {t['duration_days']} kun\n\n"
                btns.append([{"text": f"💳 {t['name']} • {int(t['price']):,} so'm", "callback_data": f"sel_{t['id']}"}])
        btns.append([{"text": "🔙 Orqaga", "callback_data": "menu"}])
        await self.send(cid, txt, markup={"inline_keyboard": btns})

    async def show_status(self, cid):
        salon = find_salon_by_chat(cid)
        if not salon: await self.send(cid, "⚠️ /start bosing."); return
        await self.send(cid, f"📊 <b>Obuna holati</b>\n\n{self.status_text(salon)}",
            markup={"inline_keyboard": [
                [{"text": "💳 To'lov qilish", "callback_data": "tariffs"}],
                [{"text": "🔙 Menyu", "callback_data": "menu"}],
            ]})

    async def show_history(self, cid):
        salon = find_salon_by_chat(cid)
        if not salon: await self.send(cid, "⚠️ /start bosing."); return
        pays = get_payments(salon["id"])
        if not pays:
            await self.send(cid, "📃 Hali to'lov amalga oshirilmagan.",
                markup={"inline_keyboard": [[{"text": "💳 To'lov qilish", "callback_data": "tariffs"}]]})
            return
        txt = f"📃 <b>To'lovlar tarixi</b>\n━━━━━━━━━━━━━━━━━━━━\n\n"
        for i, p in enumerate(pays, 1):
            icon = "✅" if p["status"] == "completed" else "⏳"
            prov = "🟢 Click" if "click" in p["provider"] else "🔵 Payme" if "payme" in p["provider"] else "⚪ " + p["provider"]
            txt += f"{icon} {p['tariff']}\n   💵 {int(p['amount']):,} so'm | {prov}\n   📅 {p['date']}\n\n"
        await self.send(cid, txt, markup={"inline_keyboard": [[{"text": "🔙 Menyu", "callback_data": "menu"}]]})

    async def show_help(self, cid):
        await self.send(cid,
            "❓ <b>Yordam</b>\n"
            "━━━━━━━━━━━━━━━━━━━━\n\n"
            "🔹 /start — Botni boshlash\n"
            "🔹 /pay — To'lov qilish\n"
            "🔹 /status — Obuna holati\n"
            "🔹 /history — To'lovlar tarixi\n\n"
            "<b>To'lov qanday ishlaydi?</b>\n"
            "1️⃣ Tarifni tanlang\n"
            "2️⃣ Click yoki Payme tanlang\n"
            "3️⃣ To'lov sahifasiga o'ting\n"
            "4️⃣ Karta raqamingizni kiriting\n"
            "5️⃣ To'lov tasdiqlangach salon ochildi!\n\n"
            "📞 Muammo: admin bilan bog'laning",
            markup={"inline_keyboard": [[{"text": "🔙 Menyu", "callback_data": "menu"}]]})

    # ─── CALLBACK HANDLER ───
    async def handle_cb(self, cb):
        cid = cb["message"]["chat"]["id"]
        data = cb.get("data", "")
        cbid = cb["id"]

        if data == "menu":
            await self.answer_cb(cbid)
            salon = find_salon_by_chat(cid)
            if salon:
                await self.send(cid, f"🏠 <b>Bosh menyu</b>\n\n{self.status_text(salon)}",
                    markup={"inline_keyboard": [
                        [{"text": "💳 To'lov qilish", "callback_data": "tariffs"}],
                        [{"text": "📊 Status", "callback_data": "status"},
                         {"text": "📃 Tarix", "callback_data": "history"}],
                        [{"text": "❓ Yordam", "callback_data": "help"}],
                    ]})

        elif data == "tariffs":
            await self.answer_cb(cbid); await self.show_tariffs(cid)

        elif data == "status":
            await self.answer_cb(cbid); await self.show_status(cid)

        elif data == "history":
            await self.answer_cb(cbid); await self.show_history(cid)

        elif data == "help":
            await self.answer_cb(cbid); await self.show_help(cid)

        elif data.startswith("sel_"):
            # Tarif tanlandi → to'lov usulini ko'rsat
            tid = data.split("_")[1]
            tariffs = get_tariffs()
            t = next((x for x in tariffs if str(x["id"]) == tid), None)
            if not t: await self.answer_cb(cbid, "Tarif topilmadi"); return
            await self.answer_cb(cbid)
            await self.send(cid,
                f"💳 <b>To'lov usulini tanlang</b>\n"
                f"━━━━━━━━━━━━━━━━━━━━\n\n"
                f"📋 Tarif: <b>{t['name']}</b>\n"
                f"💵 Summa: <b>{int(t['price']):,} so'm</b>\n"
                f"⏱ Muddat: {t['duration_days']} kun\n\n"
                f"Quyidagi to'lov usullaridan birini\ntanlang:",
                markup={"inline_keyboard": [
                    [{"text": "🟢 Click orqali to'lash", "callback_data": f"pay_click_{tid}"}],
                    [{"text": "🔵 Payme orqali to'lash", "callback_data": f"pay_payme_{tid}"}],
                    [{"text": "🔙 Tariflar", "callback_data": "tariffs"}],
                ]})

        elif data.startswith("pay_"):
            # To'lov usuli tanlandi → link yaratish
            parts = data.split("_")
            provider = parts[1]
            tid = int(parts[2])
            salon = find_salon_by_chat(cid)
            if not salon: await self.answer_cb(cbid, "Salon topilmadi"); return
            await self.answer_cb(cbid, "⏳ To'lov yaratilmoqda...")

            # Pending tranzaksiya yaratish
            result = create_pending_payment(salon["id"], tid, provider)
            if not result:
                await self.send(cid, "❌ Xato. Qayta urinib ko'ring."); return

            # Click/Payme to'lov linkini yaratish
            config = get_bot_config()
            if provider == "click":
                url = generate_click_url(config, result["amount"], salon["id"], result["txn_id"])
                prov_icon = "🟢"
                prov_name = "Click"
            else:
                url = generate_payme_url(config, result["amount"], salon["id"], result["txn_id"])
                prov_icon = "🔵"
                prov_name = "Payme"

            await self.send(cid,
                f"🧾 <b>To'lov hisob-fakturasi</b>\n"
                f"━━━━━━━━━━━━━━━━━━━━\n\n"
                f"🏪 Salon: <b>{salon['name']}</b>\n"
                f"📋 Tarif: <b>{result['tariff_name']}</b>\n"
                f"💵 Summa: <b>{int(result['amount']):,} so'm</b>\n"
                f"{prov_icon} Usul: <b>{prov_name}</b>\n"
                f"🆔 Tranzaksiya: #{result['txn_id']}\n\n"
                f"━━━━━━━━━━━━━━━━━━━━\n"
                f"👇 Quyidagi tugmani bosib {prov_name}\n"
                f"sahifasiga o'ting va karta raqamingizni\n"
                f"kiritib to'lovni amalga oshiring:\n",
                markup={"inline_keyboard": [
                    [{"text": f"{prov_icon} {prov_name} da to'lash →", "url": url}],
                    [{"text": "✅ To'ladim — tasdiqlash", "callback_data": f"done_{result['txn_id']}"}],
                    [{"text": "❌ Bekor qilish", "callback_data": "menu"}],
                ]})

            # Pending xabar user_states ga saqlash
            user_states[f"txn_{cid}"] = result["txn_id"]

        elif data.startswith("done_"):
            # Foydalanuvchi "To'ladim" dedi → tasdiqlash
            txn_id = int(data.split("_")[1])
            await self.answer_cb(cbid, "⏳ Tekshirilmoqda...")
            result = confirm_payment(txn_id)
            current_salon = find_salon_by_chat(cid)
            if result and current_salon and result.get("salon_id") != current_salon.get("id"):
                await self.send(cid, "⛔ Bu tranzaksiya sizning saloningizga tegishli emas.")
                return
            if result and not result.get("pending"):
                prov = "🟢 Click" if "click" in result["provider"] else "🔵 Payme"
                await self.send(cid,
                    f"✅ <b>To'lov tasdiqlandi!</b>\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n\n"
                    f"🏪 {result['salon_name']}\n"
                    f"📋 {result['tariff_name']}\n"
                    f"💵 <b>{int(result['amount']):,} so'm</b>\n"
                    f"{prov}\n\n"
                    f"📅 To'lov sanasi: <b>{result['today']}</b>\n"
                    f"📅 Keyingi to'lov: <b>{result['new_expires']}</b>\n"
                    f"⏳ Qolgan: <b>{result['days_left']} kun</b>\n\n"
                    f"✨ Admin panelingiz faollashtirildi!\n"
                    f"Ishlashingiz mumkin.",
                    markup={"inline_keyboard": [
                        [{"text": "📊 Status", "callback_data": "status"},
                         {"text": "📃 Tarix", "callback_data": "history"}],
                        [{"text": "🏠 Menyu", "callback_data": "menu"}],
                    ]})
                # SuperAdminga xabar
                config = get_bot_config()
                if config["chat_id"]:
                    await self.send(int(config["chat_id"]),
                        f"💰 <b>Yangi to'lov qabul qilindi!</b>\n"
                        f"━━━━━━━━━━━━━━━━━━━━\n"
                        f"🏪 {result['salon_name']}\n"
                        f"📋 {result['tariff_name']}\n"
                        f"💵 <b>{int(result['amount']):,} so'm</b>\n"
                        f"{prov}\n"
                        f"📅 {result['today']} → {result['new_expires']}")
            else:
                provider_name = "Click/Payme"
                if result and result.get("provider"):
                    provider_name = "Click" if result["provider"] == "click" else "Payme" if result["provider"] == "payme" else result["provider"]
                await self.send(cid,
                    "⚠️ <b>To'lov hali provayder tomonidan tasdiqlanmadi</b>\n\n"
                    f"{provider_name} callbacki kelgach to'lov avtomatik aktivlashadi.\n"
                    "Iltimos, 10-30 soniyadan keyin qayta tekshiring.",
                    markup={"inline_keyboard": [
                        [{"text": "✅ To'ladim — tasdiqlash", "callback_data": f"done_{txn_id}"}],
                        [{"text": "🔙 Menyu", "callback_data": "menu"}],
                    ]})

    async def run(self):
        logger.info("🤖 SalonPro Billing Bot ishga tushdi!")
        while True:
            try:
                updates = await self.get_updates()
                for u in updates:
                    if "message" in u: await self.handle_msg(u["message"])
                    elif "callback_query" in u: await self.handle_cb(u["callback_query"])
            except Exception as e:
                logger.error(f"Xato: {e}")
                await asyncio.sleep(5)


async def main():
    config = get_bot_config()
    if not config["token"]:
        print("❌ Bot token topilmadi! SuperAdmin → Sozlamalar → Token kiriting.")
        return
    print("🤖 SalonPro Billing Bot ishga tushmoqda...")
    bot = BillingBot(config["token"])
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
