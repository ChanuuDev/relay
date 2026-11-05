#!/usr/bin/env sh
# 도메인은 서버의 비공개 설정에만 저장하고 nginx 템플릿에 반영한다.
set -eu
umask 077
source_file=${1:?nginx template}
target_file=${2:?rendered nginx config}
server_dir=${RELAY_SERVER_DIR:-/srv/relay}
env_file=$server_dir/.env
if [ ! -f "$env_file" ]; then
  printf '%s\n' '서버 환경 파일을 먼저 준비하세요.' >&2
  exit 1
fi
domain=${RELAY_DOMAIN:-}
if [ -z "$domain" ]; then domain=$(sed -n 's/^RELAY_DOMAIN=//p' "$env_file" | tail -n 1); fi
# 기존 서버는 현재 nginx 설정에서 가져와 비공개 환경 파일로 이전한다.
if [ -z "$domain" ] && [ -f "$server_dir/nginx/conf.d/relay.conf" ]; then
  domain=$(awk '$1 == "server_name" { gsub(/;/, "", $2); print $2; exit }' "$server_dir/nginx/conf.d/relay.conf")
fi
if ! printf '%s\n' "$domain" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'; then
  printf '%s\n' 'RELAY_DOMAIN에 서비스 도메인만 지정하세요.' >&2
  exit 2
fi
awk '$0 !~ /^RELAY_DOMAIN=/' "$env_file" > "$env_file.next"
printf 'RELAY_DOMAIN=%s\n' "$domain" >> "$env_file.next"
chmod 600 "$env_file.next"
mv -f "$env_file.next" "$env_file"
sed "s/__RELAY_DOMAIN__/$domain/g" "$source_file" > "$target_file.next"
mv -f "$target_file.next" "$target_file"
