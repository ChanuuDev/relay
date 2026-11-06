#!/usr/bin/env sh
# 브라우저 모드 화면 도메인을 서버의 비공개 설정에만 저장하고 nginx 템플릿에 반영한다.
#   RELAY_WEB_DOMAIN=<도메인> sh render-web-nginx.sh <템플릿> <출력>   (값이 없으면 .env의 RELAY_WEB_DOMAIN)
# 화면이 다른 출처에서 이 서버를 부를 수 있게 relay-api의 CORS 허용 목록(RELAY_CORS_ORIGINS)도 같은 출처로 맞춘다.
# 도메인이 없으면 아무것도 하지 않고 3으로 끝난다(브라우저 모드를 쓰지 않는 서버).
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
domain=${RELAY_WEB_DOMAIN:-}
if [ -z "$domain" ]; then domain=$(sed -n 's/^RELAY_WEB_DOMAIN=//p' "$env_file" | tail -n 1); fi
if [ -z "$domain" ]; then exit 3; fi
if ! printf '%s\n' "$domain" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'; then
  printf '%s\n' 'RELAY_WEB_DOMAIN에 화면 도메인만 지정하세요.' >&2
  exit 2
fi
awk '$0 !~ /^(RELAY_WEB_DOMAIN|RELAY_CORS_ORIGINS)=/' "$env_file" > "$env_file.next"
printf 'RELAY_WEB_DOMAIN=%s\nRELAY_CORS_ORIGINS=https://%s\n' "$domain" "$domain" >> "$env_file.next"
chmod 600 "$env_file.next"
mv -f "$env_file.next" "$env_file"
sed "s/__RELAY_WEB_DOMAIN__/$domain/g" "$source_file" > "$target_file.next"
mv -f "$target_file.next" "$target_file"
