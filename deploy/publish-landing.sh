#!/bin/sh
# Taqdimot saytini (landing/) kompyuterda quradi va serverga qo'yadi.
# Foydalanish (Git Bash):  sh deploy/publish-landing.sh
# Yangi fayllar avval yonidagi papkaga tushadi, keyin birdaniga almashadi.
set -eu
cd "$(dirname "$0")/.."

SERVER="${SERVER:-ubuntu@13.51.135.5}"
KEY="${KEY:-$HOME/.chronix/asqar.pem}"
KNOWN="${KNOWN:-$HOME/.chronix/known_hosts}"
SSH="ssh -i $KEY -o UserKnownHostsFile=$KNOWN -o BatchMode=yes"

(cd landing && npm ci --no-audit --no-fund >/dev/null && npm run build)

tar -C landing/dist -czf - . | $SSH "$SERVER" '
  set -e
  cd chronix/deploy
  rm -rf landing-dist.new
  mkdir landing-dist.new
  tar -xzf - -C landing-dist.new
  test -s landing-dist.new/index.html
  mkdir -p landing-dist
  find landing-dist -mindepth 1 -delete
  cp -a landing-dist.new/. landing-dist/
  rm -rf landing-dist.new
  du -sh landing-dist
'
