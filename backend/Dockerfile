FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini .
COPY app ./app
COPY migrations ./migrations
COPY sql ./sql

# Ilova root sifatida ishlamaydi
RUN useradd --system --no-create-home chronix && mkdir -p /media && chown chronix /media
USER chronix

EXPOSE 8000
# Forwarded sarlavhalari faqat Caddy'dan keladi: api porti tashqariga ochilmagan
# Bitta jarayon: 2 ta jarayon sinab ko'rildi (2026-11-14) — 1 GB serverda tezlik oshmadi, xotira esa ~4 barobar
# ko'p band bo'ldi. Kattaroq serverga o'tilganda "--workers", "2" qo'shiladi.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
