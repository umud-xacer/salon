#!/bin/sh
# DB-IP Lite (City) bazasini yuklab oladi: IP → shahar/viloyat (hududiy analitika, 061_geo_analytics.sql).
# Litsenziya: CC BY 4.0 — "IP Geolocation by DB-IP" (https://db-ip.com) panelda ko'rsatiladi.
# DB-IP har oy boshida yangi fayl chiqaradi. Serverda cron bilan oyiga bir marta ishga tushiriladi:
#   15 4 3 * *  cd /home/ubuntu/chronix && sh deploy/update-geoip.sh >> deploy/geoip/update.log 2>&1
# API faylni o'zi qayta o'qiydi (10 daqiqada fayl vaqtini tekshiradi) — qayta ishga tushirish shart emas.
set -eu
cd "$(dirname "$0")"
mkdir -p geoip
cd geoip

for month in "$(date +%Y-%m)" "$(date -d "$(date +%Y-%m-01) -1 day" +%Y-%m)"; do
  url="https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz"
  if curl -fsSL --max-time 600 -o dbip.mmdb.gz.tmp "$url"; then
    gunzip -c dbip.mmdb.gz.tmp > dbip.mmdb.tmp
    rm -f dbip.mmdb.gz.tmp
    size=$(stat -c %s dbip.mmdb.tmp)
    # Buzilgan yoki chala fayl ishdagisini almashtirmasin (haqiqiy fayl ~100 MB dan katta)
    if [ "$size" -lt 50000000 ]; then
      echo "$(date -Is) xato: fayl juda kichik ($size bayt), $url"
      rm -f dbip.mmdb.tmp
      exit 1
    fi
    mv -f dbip.mmdb.tmp dbip-city-lite.mmdb
    echo "$(date -Is) yangilandi: $url ($size bayt)"
    exit 0
  fi
  rm -f dbip.mmdb.gz.tmp
done
echo "$(date -Is) xato: DB-IP fayli topilmadi"
exit 1
