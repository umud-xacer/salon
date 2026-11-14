#!/bin/sh
# Serverda: asosiy domenni almashtiradi, eski domen taxallus (alias) bo'lib ishlayveradi.
# Foydalanish:  sh deploy/switch-domain.sh chronix.uz ariqalqon.uz
#   1-argument — yangi domen, 2-argument — eski domen (u o'chirilmaydi: eski ilovalar va havolalar ishlayveradi)
# Oldin: yangi domenning @, www, api, ega, admin A yozuvlari shu serverga qarashi va internetda ko'rinishi shart,
# aks holda Caddy HTTPS sertifikatini ololmaydi.
set -eu
NEW="${1:?yangi domen}"
OLD="${2:?eski domen}"
cd "$(dirname "$0")"
ENV=.env

for h in "$NEW" "www.$NEW" "api.$NEW" "ega.$NEW" "admin.$NEW"; do
  ip=$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')
  [ -n "$ip" ] || { echo "XATO: $h DNS'da topilmadi — avval DNS tarqalishini kuting" >&2; exit 1; }
done

cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"
set_var() {   # set_var NOM QIYMAT — bor bo'lsa almashtiradi, yo'q bo'lsa qo'shadi
  if grep -q "^$1=" "$ENV"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV"
  else
    echo "$1=$2" >> "$ENV"
  fi
}
set_var API_DOMAIN "api.$NEW"
set_var API_ALIAS "api.$OLD"
set_var PUBLIC_BASE_URL "https://api.$NEW"
set_var WEB_DOMAIN "www.$NEW"
set_var WEB_ALIAS "admin.$NEW www.$OLD admin.$OLD"
set_var ADMIN_DOMAIN "ega.$NEW"
set_var ADMIN_ALIAS "ega.$OLD"
set_var LANDING_DOMAIN "$NEW"
set_var LANDING_ALIAS "$OLD"
set_var ADMIN_PANEL_HOSTS "[\"ega.$NEW\",\"ega.$OLD\"]"
set_var BUSINESS_PANEL_HOSTS "[\"www.$NEW\",\"admin.$NEW\",\"www.$OLD\",\"admin.$OLD\"]"
set_var ADMIN_PANEL_URL "https://ega.$NEW"
set_var BUSINESS_PANEL_URL "https://www.$NEW"
set_var CORS_ORIGINS "[\"https://api.$NEW\",\"https://www.$NEW\",\"https://admin.$NEW\",\"https://api.$OLD\",\"https://www.$OLD\",\"https://admin.$OLD\"]"

echo "=== .env yangilandi (zaxira: $(ls -t $ENV.bak-* | head -1))"
grep -E "^(API_|WEB_|ADMIN_|LANDING_|PUBLIC_BASE_URL|BUSINESS_PANEL|CORS_ORIGINS)" "$ENV"

# Yangi domen sozlamasi bilan qayta ishga tushirish (Caddy sertifikatlarni o'zi oladi)
sudo docker compose up -d --force-recreate api worker caddy

# Saqlangan rasm manzillari yangi domenga (eski manzil ham ishlayveradi — bu faqat tartib uchun)
sudo docker compose exec -T db psql -U postgres -d chronix -c \
  "UPDATE business_photos SET url = replace(url, 'https://api.$OLD/', 'https://api.$NEW/') WHERE url LIKE 'https://api.$OLD/%';" </dev/null
