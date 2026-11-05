#!/usr/bin/env sh
# Relay Ubuntu server CLI
set -eu

usage() {
  printf '%s\n' '사용법: relay create-token --name <기기명> [--json]' '토큰 원문은 생성할 때 한 번만 표시됩니다.'
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  create-token) shift ;;
  *) usage >&2; exit 2 ;;
esac

name=''
json=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      if [ "$#" -lt 2 ] || [ -n "$name" ]; then usage >&2; exit 2; fi
      name=$2
      shift 2
      ;;
    --json) json=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
case "$name" in
  *[![:space:]]*) ;;
  *) printf '%s\n' '토큰 이름을 --name으로 입력하세요.' >&2; exit 2 ;;
esac

server_dir=${RELAY_SERVER_DIR:-/srv/relay}
if [ ! -f "$server_dir/compose.yml" ]; then
  printf '%s\n' 'Relay 서버의 compose.yml을 찾지 못했습니다. 서버 설치 경로를 RELAY_SERVER_DIR로 지정하세요.' >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Docker와 Compose를 먼저 설치하세요.' >&2
  exit 1
fi

set -- docker compose --project-directory "$server_dir" -f "$server_dir/compose.yml" exec -T relay-api node dist/cli.js token create --name "$name"
if [ "$json" -eq 1 ]; then set -- "$@" --json; fi
exec "$@"
