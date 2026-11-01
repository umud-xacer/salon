#!/bin/sh
# GitHub'dagi oxirgi kodni serverga qo'yadi. Migratsiyalar avtomatik bajariladi.
set -eu
cd "$(dirname "$0")"
sh ./backup.sh
git pull --ff-only
sudo docker compose up -d --build
sudo docker compose ps
