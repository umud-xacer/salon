#!/bin/sh
# Veb-panelni kompyuterda quradi va serverga qo'yadi: server diski va RAM'i build uchun kichik.
# Foydalanish (Git Bash):  sh deploy/publish-web.sh
# Yangi fayllar avval yonidagi papkaga tushadi, keyin birdaniga almashadi.
set -eu
cd "$(dirname "$0")/.."

SERVER="${SERVER:-ubuntu@13.51.135.5}"
KEY="${KEY:-$HOME/.chronix/asqar.pem}"
KNOWN="${KNOWN:-$HOME/.chronix/known_hosts}"
SSH="ssh -i $KEY -o UserKnownHostsFile=$KNOWN -o BatchMode=yes"

(cd web && npm run build)

tar -C web/dist -czf - . | $SSH "$SERVER" '
  set -e
  cd chronix/deploy
  rm -rf web-dist.new
  mkdir web-dist.new
  tar -xzf - -C web-dist.new
  test -s web-dist.new/index.html
  mkdir -p web-dist
  find web-dist -mindepth 1 -delete
  cp -a web-dist.new/. web-dist/
  rm -rf web-dist.new
  du -sh web-dist
'
