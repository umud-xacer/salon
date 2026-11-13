#!/bin/sh
# Server zaxiralarini noutbukka ko'chiradi: server diski yo'qolsa ham baza va rasmlar saqlanib qoladi.
# Foydalanish (Git Bash):  sh deploy/pull-backup.sh
#   - bazaning hali ko'chirilmagan barcha kunlik zaxiralari (deploy/backups/*.dump)
#   - yuklangan rasmlar (media) — bitta arxiv, har safar yangilanadi
# Noutbukda oxirgi KEEP_DAYS kunlik zaxira saqlanadi. Serverda hech narsa o'zgarmaydi.
set -eu

SERVER="${SERVER:-ubuntu@13.51.135.5}"
KEY="${KEY:-$HOME/.chronix/asqar.pem}"
KNOWN="${KNOWN:-$HOME/.chronix/known_hosts}"
DEST="${DEST:-$HOME/ChronixZaxira}"
KEEP_DAYS="${KEEP_DAYS:-60}"
SSH="ssh -i $KEY -o UserKnownHostsFile=$KNOWN -o BatchMode=yes -o ConnectTimeout=20"

mkdir -p "$DEST/baza" "$DEST/media"

# Bugungi holat ham olinsin: avval serverda yangi zaxira yaratiladi (bir necha soniya)
if [ "${FRESH:-1}" = "1" ]; then
  $SSH "$SERVER" 'sudo sh ~/chronix/deploy/backup.sh'   # zaxira papkasi root'niki (cron ham root nomidan)
fi

new=0
for name in $($SSH "$SERVER" 'ls ~/chronix/deploy/backups/' | grep '^chronix-.*\.dump$'); do
  [ -s "$DEST/baza/$name" ] && continue
  # Avval vaqtinchalik nom: uzilib qolgan yarim fayl to'liq zaxira deb hisoblanmasin
  $SSH "$SERVER" "sudo cat ~/chronix/deploy/backups/$name" > "$DEST/baza/$name.part"
  want=$($SSH "$SERVER" "sudo stat -c %s ~/chronix/deploy/backups/$name")
  got=$(wc -c < "$DEST/baza/$name.part" | tr -d ' ')
  if [ "$want" != "$got" ]; then
    rm -f "$DEST/baza/$name.part"
    echo "XATO: $name to'liq ko'chmadi ($got / $want bayt)" >&2
    exit 1
  fi
  mv "$DEST/baza/$name.part" "$DEST/baza/$name"
  new=$((new + 1))
done

# Rasmlar: Docker tomidan to'g'ridan-to'g'ri arxiv
$SSH "$SERVER" 'sudo tar -C /var/lib/docker/volumes/deploy_media/_data -czf - .' > "$DEST/media/media.tar.gz.part"
tar -tzf "$DEST/media/media.tar.gz.part" > /dev/null
mv "$DEST/media/media.tar.gz.part" "$DEST/media/media.tar.gz"

find "$DEST/baza" -name 'chronix-*.dump' -mtime +"$KEEP_DAYS" -delete

last=$(ls "$DEST/baza" | grep '\.dump$' | sort | tail -1)
echo "Yangi ko'chirilgan zaxiralar: $new"
echo "Jami: $(ls "$DEST/baza" | grep -c '\.dump$') ta baza zaxirasi, oxirgisi: $last"
echo "Rasmlar arxivi: $(wc -c < "$DEST/media/media.tar.gz" | tr -d ' ') bayt"
echo "Joyi: $DEST"
