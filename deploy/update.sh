#!/bin/sh
# GitHub'dagi oxirgi kodni serverga qo'yadi. Migratsiyalar avtomatik bajariladi.
set -eu
cd "$(dirname "$0")"
sh ./backup.sh
git pull --ff-only
sudo docker compose up -d --build
# Disk kichik: eski image va build keshi yig'ilib qolmasin. Volume va baza tegilmaydi
sudo docker image prune -f
sudo docker builder prune -af
sudo docker compose ps
