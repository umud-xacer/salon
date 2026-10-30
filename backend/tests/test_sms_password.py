"""Eskiz integratsiyasi (tarmoqsiz) va parolni tiklash."""
import httpx
import pytest
from pydantic import SecretStr

from app.core.config import get_settings
from app.services import sms
from tests.conftest import auth_header, new_phone, otp_login

AUTH = "/api/v1/auth"
PASSWORD = "YangiParol123"


@pytest.fixture()
def eskiz(monkeypatch):
    """Eskiz'ga so'rovlarni ushlab turadi; `sms_status` bilan javobni boshqaramiz."""
    calls = {"login": 0, "sms": [], "sms_status": [200]}

    def fake_post(url, data=None, headers=None, timeout=None):
        request = httpx.Request("POST", url)
        if url.endswith("/auth/login"):
            calls["login"] += 1
            return httpx.Response(200, json={"data": {"token": f"tok{calls['login']}"}}, request=request)
        calls["sms"].append({"data": data, "auth": headers["Authorization"]})
        return httpx.Response(calls["sms_status"].pop(0) if calls["sms_status"] else 200, json={}, request=request)

    s = get_settings()
    monkeypatch.setattr(sms, "_token", None)
    monkeypatch.setattr(sms.httpx, "post", fake_post)
    monkeypatch.setattr(s, "sms_provider", "eskiz")
    monkeypatch.setattr(s, "eskiz_email", "test@example.uz")
    monkeypatch.setattr(s, "eskiz_password", SecretStr("x"))
    return calls


def test_eskiz_sends_otp_without_plus(eskiz):
    sms.send_otp("+998901112233", "123456")
    sms.send_otp("+998901112233", "654321")
    assert eskiz["login"] == 1                                  # token qayta ishlatiladi
    d = eskiz["sms"][0]["data"]
    assert d["mobile_phone"] == "998901112233" and "123456" in d["message"] and d["from"] == "4546"
    assert eskiz["sms"][0]["auth"] == "Bearer tok1"


def test_eskiz_relogins_once_on_expired_token(eskiz):
    eskiz["sms_status"] = [401, 200]
    sms.send_otp("+998901112233", "123456")
    assert eskiz["login"] == 2 and eskiz["sms"][1]["auth"] == "Bearer tok2"


def test_eskiz_failure_raises(eskiz):
    eskiz["sms_status"] = [500]
    with pytest.raises(sms.SmsError) as e:
        sms.send_otp("+998901112233", "123456")
    assert "123456" not in str(e.value)


def test_otp_api_reports_sms_failure(client, eskiz):
    eskiz["sms_status"] = [500]
    r = client.post(f"{AUTH}/otp/request", json={"phone": new_phone()})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "sms_unavailable"


def test_real_provider_does_not_expose_code(client, eskiz):
    r = client.post(f"{AUTH}/otp/request", json={"phone": new_phone()})
    assert r.status_code == 200 and r.json()["dev_code"] is None


def user_with_password(client):
    phone = new_phone()
    tokens = otp_login(client, phone)
    assert client.post(f"{AUTH}/password", headers=auth_header(tokens),
                       json={"new_password": "EskiParol123"}).status_code == 204
    return phone


def test_password_reset_flow(client):
    phone = user_with_password(client)
    old = client.post(f"{AUTH}/login", json={"phone": phone, "password": "EskiParol123"}).json()

    code = client.post(f"{AUTH}/password/forgot", json={"phone": phone}).json()["dev_code"]
    assert code
    r = client.post(f"{AUTH}/password/reset", json={"phone": phone, "code": code, "new_password": PASSWORD})
    assert r.status_code == 204, r.text

    assert client.post(f"{AUTH}/login", json={"phone": phone, "password": "EskiParol123"}).status_code == 401
    assert client.post(f"{AUTH}/login", json={"phone": phone, "password": PASSWORD}).status_code == 200
    # Eski sessiyalar bekor, kod ikkinchi marta ishlamaydi
    assert client.get(f"{AUTH}/me", headers=auth_header(old)).status_code == 401
    assert client.post(f"{AUTH}/refresh", json={"refresh_token": old["refresh_token"]}).status_code == 401
    assert client.post(f"{AUTH}/password/reset", json={"phone": phone, "code": code,
                                                       "new_password": "BoshqaParol123"}).status_code == 401


def test_reset_rejects_wrong_code_and_weak_password(client):
    phone = user_with_password(client)
    code = client.post(f"{AUTH}/password/forgot", json={"phone": phone}).json()["dev_code"]
    wrong = "000000" if code != "000000" else "111111"
    assert client.post(f"{AUTH}/password/reset", json={"phone": phone, "code": wrong,
                                                       "new_password": PASSWORD}).status_code == 401
    assert client.post(f"{AUTH}/password/reset", json={"phone": phone, "code": code,
                                                       "new_password": "123"}).status_code == 422
    assert client.post(f"{AUTH}/login", json={"phone": phone, "password": "EskiParol123"}).status_code == 200


@pytest.mark.parametrize("who", ["unknown", "no_password", "superadmin"])
def test_forgot_gives_no_code_and_same_answer(client, who):
    phone = "+998900000001" if who == "superadmin" else new_phone()
    if who == "no_password":
        otp_login(client, phone)
    r = client.post(f"{AUTH}/password/forgot", json={"phone": phone})
    assert r.status_code == 200 and r.json()["sent"] is True and r.json()["dev_code"] is None
