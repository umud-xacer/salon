#!/bin/sh
# Yangi Ubuntu serverda bir marta:  API_DOMAIN=... ESKIZ_EMAIL=... ESKIZ_PASSWORD=... sh deploy/setup.sh
# Keyingi yangilanishlar:           sh deploy/update.sh
set -eu
cd "$(dirname "$0")"

: "${API_DOMAIN:?API_DOMAIN kerak}"
: "${ESKIZ_EMAIL:?ESKIZ_EMAIL kerak}"
: "${ESKIZ_PASSWORD:?ESKIZ_PASSWORD kerak}"

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi

# Mavjud .env ga tegilmaydi: parol almashsa bazaga kirib bo'lmay qoladi
if [ ! -f .env ]; then
  gen() { openssl rand -hex 32; }
  sed -e "s|^API_DOMAIN=.*|API_DOMAIN=$API_DOMAIN|" \
      -e "s|__API_DOMAIN__|$API_DOMAIN|g" \
      -e "s|__POSTGRES__|$(gen)|g" \
      -e "s|__API__|$(gen)|g" \
      -e "s|__AUTH__|$(gen)|g" \
      -e "s|__WORKER__|$(gen)|g" \
      -e "s|__JWT__|$(gen)|g" \
      -e "s|__ESKIZ_EMAIL__|$ESKIZ_EMAIL|g" \
      -e "s|__ESKIZ_PASSWORD__|$ESKIZ_PASSWORD|g" \
      .env.example > .env
  chmod 600 .env
fi

sudo docker compose up -d --build
sudo docker compose ps

# Har kuni 03:00 da baza zaxirasi
BACKUP="$(pwd)/backup.sh"
( sudo crontab -l 2>/dev/null | grep -v "$BACKUP" || true; echo "0 3 * * * sh $BACKUP" ) | sudo crontab -
