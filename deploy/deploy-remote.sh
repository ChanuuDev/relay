#!/usr/bin/env bash
# 서버에서 Actions가 부른다: 첫 줄로 GHCR 토큰을 stdin에서 읽고, 이미지를 받아 다시 띄운다.
#   echo "$TOKEN" | bash /srv/relay/deploy-remote.sh ghcr.io/<owner>/relay-api:<tag> <github actor>
# docker 명령은 stdin을 /dev/null로 돌려 스크립트 입력을 삼키지 않게 한다.
set -euo pipefail
IMAGE="${1:?image}"
ACTOR="${2:?actor}"
IFS= read -r TOKEN
cd /srv/relay
chmod +x backup.sh 2>/dev/null || true
sudo sh /srv/relay/install-cli.sh
/usr/local/bin/relay --help </dev/null

# 도메인은 비공개 환경 파일 또는 기존 nginx 설정에서 읽는다.
sh /srv/relay/render-nginx.sh nginx/relay.conf.new nginx/relay.conf.new
RELAY_DOMAIN=$(sed -n 's/^RELAY_DOMAIN=//p' .env | tail -n 1)
if sudo test -f "certbot/conf/live/$RELAY_DOMAIN/fullchain.pem"; then
  mv -f nginx/relay.conf.new nginx/conf.d/relay.conf
  if ! docker compose exec -T nginx nginx -t </dev/null >/dev/null 2>&1; then
    echo "nginx 설정 검사 실패" >&2; exit 1
  fi
  docker compose exec -T nginx nginx -s reload </dev/null >/dev/null 2>&1
else
  rm -f nginx/relay.conf.new
fi

printf '%s' "$TOKEN" | docker login ghcr.io -u "$ACTOR" --password-stdin
unset TOKEN
# 고른 이미지 태그를 .env에 남겨 두어 나중에 compose up을 다시 해도 같은 이미지를 쓴다.
grep -v '^RELAY_API_IMAGE=' .env > .env.next || true
echo "RELAY_API_IMAGE=${IMAGE}" >> .env.next
mv .env.next .env && chmod 600 .env
docker compose pull relay-api </dev/null >/dev/null 2>&1
docker compose up -d --remove-orphans </dev/null
docker logout ghcr.io </dev/null >/dev/null
docker image prune -f </dev/null >/dev/null

for i in $(seq 1 40); do
  if docker compose exec -T relay-api wget -qO- http://127.0.0.1:3000/api/v1/health </dev/null >/dev/null 2>&1; then
    if sudo test -f "certbot/conf/live/$RELAY_DOMAIN/fullchain.pem"; then
      if ! curl -fsS --max-time 10 "https://$RELAY_DOMAIN/api/v1/health" >/dev/null 2>&1; then
        echo "HTTPS health 확인 실패" >&2; exit 1
      fi
    fi
    echo "relay-api healthy"
    docker compose ps --format "table {{.Service}}\t{{.Status}}" </dev/null
    exit 0
  fi
  sleep 2
done
echo "relay-api did not become healthy"
docker compose logs --tail 50 relay-api </dev/null
exit 1
