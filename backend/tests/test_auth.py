"""Kirish: OTP, parol, token aylanishi, sessiyalarni bekor qilish."""
import jwt

from tests.conftest import auth_header, new_phone, otp_login

API = "/api/v1/auth"


def test_otp_registers_new_client(client):
    phone = new_phone()
    r = client.post(f"{API}/otp/request", json={"phone": phone[4:]})           # "91xxxxxxx" ham qabul qilinadi
    assert r.status_code == 200
    code = r.json()["dev_code"]
    r = client.post(f"{API}/otp/verify", json={"phone": phone, "code": code, "full_name": "Ali Valiyev"})
    assert r.status_code == 200
    body = r.json()
    assert body["is_new"] is True and body["user"]["phone"] == phone

    me = client.get(f"{API}/me", headers=auth_header(body)).json()
    assert me["workspace"] == "client" and me["memberships"] == []

    # Ikkinchi kirish — o'sha foydalanuvchi, yangi emas
    again = otp_login(client, phone)
    assert again["is_new"] is False and again["user"]["id"] == body["user"]["id"]


def test_invalid_phone_rejected(client):
    assert client.post(f"{API}/otp/request", json={"phone": "+7 999 123 45 67"}).status_code == 422


def test_otp_code_dies_after_max_attempts(client):
    phone = new_phone()
    code = client.post(f"{API}/otp/request", json={"phone": phone}).json()["dev_code"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert client.post(f"{API}/otp/verify", json={"phone": phone, "code": wrong}).status_code == 401
    # To'g'ri kod ham endi ishlamaydi (brute-force himoyasi)
    r = client.post(f"{API}/otp/verify", json={"phone": phone, "code": code})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "otp_invalid"


def test_otp_rate_limit_in_database(client):
    phone = new_phone()
    for _ in range(3):
        assert client.post(f"{API}/otp/request", json={"phone": phone}).status_code == 200
    r = client.post(f"{API}/otp/request", json={"phone": phone})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "otp_rate_limited"


def test_refresh_rotation_and_reuse_detection(client):
    t1 = otp_login(client, new_phone())
    r = client.post(f"{API}/refresh", json={"refresh_token": t1["refresh_token"]})
    assert r.status_code == 200
    t2 = r.json()
    assert t2["refresh_token"] != t1["refresh_token"]

    # Eski refresh token qayta ishlatildi → o'g'irlik deb hisoblanadi, butun zanjir bekor
    assert client.post(f"{API}/refresh", json={"refresh_token": t1["refresh_token"]}).status_code == 401
    assert client.post(f"{API}/refresh", json={"refresh_token": t2["refresh_token"]}).status_code == 401


def test_logout_revokes_refresh(client):
    t = otp_login(client, new_phone())
    assert client.post(f"{API}/logout", json={"refresh_token": t["refresh_token"]}).status_code == 204
    assert client.post(f"{API}/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401


def test_logout_all_kills_access_tokens(client):
    t = otp_login(client, new_phone())
    assert client.get(f"{API}/me", headers=auth_header(t)).status_code == 200
    assert client.post(f"{API}/logout-all", headers=auth_header(t)).status_code == 204
    assert client.get(f"{API}/me", headers=auth_header(t)).status_code == 401


def test_password_login_and_lockout(client):
    t = otp_login(client, new_phone())
    phone = t["user"]["phone"]
    # Kuchsiz parol rad etiladi
    assert client.post(f"{API}/password", headers=auth_header(t), json={"new_password": "12345678"}).status_code == 422
    assert client.post(f"{API}/password", headers=auth_header(t), json={"new_password": "Kuchli123"}).status_code == 204
    # Parol o'zgargach eski access token yaroqsiz
    assert client.get(f"{API}/me", headers=auth_header(t)).status_code == 401

    ok = client.post(f"{API}/login", json={"phone": phone, "password": "Kuchli123"})
    assert ok.status_code == 200

    for _ in range(5):
        assert client.post(f"{API}/login", json={"phone": phone, "password": "Notogri999"}).status_code == 401
    # Endi to'g'ri parol ham vaqtincha ishlamaydi
    r = client.post(f"{API}/login", json={"phone": phone, "password": "Kuchli123"})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "account_locked"


def test_unknown_phone_same_error_as_wrong_password(client):
    r = client.post(f"{API}/login", json={"phone": new_phone(), "password": "Nimadir123"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "invalid_credentials"


def test_tampered_and_foreign_tokens_rejected(client):
    t = otp_login(client, new_phone())
    header, payload, sig = t["access_token"].split(".")
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {header}.{payload}.{sig[::-1]}"}).status_code == 401

    # Boshqa kalit bilan imzolangan, Super Admin ID'si qo'yilgan token
    fake = jwt.encode({"sub": "1", "ver": 0, "type": "access", "iss": "salon-platform",
                       "iat": 1, "exp": 9999999999}, "boshqa-kalit-" * 4, algorithm="HS256")
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {fake}"}).status_code == 401
    # alg=none
    none_token = jwt.encode({"sub": "1", "ver": 0, "type": "access"}, None, algorithm="none")
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {none_token}"}).status_code == 401
    # Refresh tokenni access sifatida ishlatib bo'lmaydi
    assert client.get(f"{API}/me", headers={"Authorization": f"Bearer {t['refresh_token']}"}).status_code == 401


def test_security_headers(client):
    r = client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
