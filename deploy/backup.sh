#!/bin/sh
# Baza zaxirasi: deploy/backups ichida, oxirgi 14 kuni saqlanadi.
# Bu zaxira serverning o'zida turadi, server yo'qolsa u ham yo'qoladi.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
FILE="backups/chronix-$(date +%Y%m%d-%H%M%S).dump"
sudo docker compose exec -T db pg_dump -U postgres -Fc chronix > "$FILE"
[ -s "$FILE" ] || { rm -f "$FILE"; echo "Zaxira bo'sh chiqdi" >&2; exit 1; }
find backups -name 'chronix-*.dump' -mtime +14 -delete
