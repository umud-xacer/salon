#!/bin/sh
# Mijozlar platformasini (market/, chronix.uz) kompyuterda quradi va serverga qo'yadi.
# Foydalanish (Git Bash):  sh deploy/publish-market.sh
# Yangi fayllar avval yonidagi papkaga tushadi, keyin birdaniga almashadi.
set -eu
cd "$(dirname "$0")/.."

SERVER="${SERVER:-ubuntu@13.51.135.5}"
KEY="${KEY:-$HOME/.chronix/asqar.pem}"
KNOWN="${KNOWN:-$HOME/.chronix/known_hosts}"
SSH="ssh -i $KEY -o UserKnownHostsFile=$KNOWN -o BatchMode=yes"

(cd market && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build)

tar -C market/dist -czf - . | $SSH "$SERVER" '
  set -e
  cd chronix/deploy
  rm -rf market-dist.new
  mkdir market-dist.new
  tar -xzf - -C market-dist.new
  test -s market-dist.new/index.html
  mkdir -p market-dist
  find market-dist -mindepth 1 -delete
  cp -a market-dist.new/. market-dist/
  rm -rf market-dist.new
  du -sh market-dist
'
