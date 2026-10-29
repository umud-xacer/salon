@echo off
cd /d %~dp0backend

echo ====================================
echo   SalonPro SaaS v2.0 - Ishga tushish
echo ====================================

echo.
echo [1/3] Kutubxonalar tekshirilmoqda...
pip install -q python-jose[cryptography] passlib[bcrypt] python-multipart fastapi uvicorn sqlalchemy httpx

echo.
echo [2/3] Database yangilanmoqda...
python migrate_saas.py

echo.
echo [3/3] Server ishga tushmoqda...
echo.
echo Panellar:
echo   Admin      -^> http://localhost:8000/
echo   Login      -^> http://localhost:8000/login/
echo   SuperAdmin -^> http://localhost:8000/superadmin/
echo   Reception  -^> http://localhost:8000/reception/
echo   Ustalar    -^> http://localhost:8000/ustalar/
echo.
echo Demo loginlar:
echo   superadmin / admin123
echo   admin      / salon123
echo   reception  / rec123
echo ====================================

python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
pause
