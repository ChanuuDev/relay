#!/usr/bin/env bash
# 매일 03:00 호스트 cron이 부른다: 0 3 * * * /srv/relay/backup.sh >> /srv/relay/backups/backup.log 2>&1
# PostgreSQL을 pg_dump(-Fc)로 받아 14일 보관하고, 일요일에는 원격 파일 폴더를 tar로 묶어 4주 보관한다.
set -euo pipefail
cd /srv/relay
stamp="$(date +%F)"
mkdir -p backups
docker compose exec -T postgres pg_dump -Fc -U relay relay > "backups/relay-${stamp}.dump.tmp"
mv "backups/relay-${stamp}.dump.tmp" "backups/relay-${stamp}.dump"
find backups -name 'relay-*.dump' -mtime +14 -delete
if [ "$(date +%u)" = "7" ]; then
  tar -czf "backups/files-${stamp}.tar.gz.tmp" --exclude='./.trash' -C files .
  mv "backups/files-${stamp}.tar.gz.tmp" "backups/files-${stamp}.tar.gz"
  find backups -name 'files-*.tar.gz' -mtime +28 -delete
fi
echo "$(date -Is) backup ok: relay-${stamp}.dump ($(du -h "backups/relay-${stamp}.dump" | cut -f1))"
