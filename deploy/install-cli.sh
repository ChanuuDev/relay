#!/usr/bin/env sh
# Ubuntu 호스트의 relay 명령을 설치한다. 기본 경로는 sudo 권한으로 설치한다.
set -eu
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
bin_dir=${1:-/usr/local/bin}
target=$bin_dir/relay
if [ -L "$target" ] || { [ -e "$target" ] && ! grep -Fxq '# Relay Ubuntu server CLI' "$target"; }; then
  printf '%s\n' '기존 relay 명령이 있어 덮어쓰지 않았습니다. 설치 경로를 확인하세요.' >&2
  exit 1
fi
mkdir -p -- "$bin_dir"
install -m 0755 "$script_dir/relay.sh" "$target"
printf '%s\n' 'Ubuntu relay 명령 설치 완료: relay create-token --name <기기명>'
