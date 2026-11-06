#!/usr/bin/env bash
# 서버에서 Actions가 부른다: 첫 줄로 GHCR 토큰을, 둘째 줄로 브라우저 모드 화면 도메인(없으면 빈 줄)을 stdin에서 읽고, 이미지를 받아 다시 띄운다.
#   printf '%s\n%s\n' "$TOKEN" "$WEB_DOMAIN" | bash /srv/relay/deploy-remote.sh ghcr.io/<owner>/relay-api:<tag> <github actor>
# docker 명령은 stdin을 /dev/null로 돌려 스크립트 입력을 삼키지 않게 한다. 도메인은 로그에 적지 않는다.
set -euo pipefail
IMAGE="${1:?image}"
ACTOR="${2:?actor}"
IFS= read -r TOKEN
IFS= read -r WEB_DOMAIN || WEB_DOMAIN=""
cd /srv/relay
chmod +x backup.sh 2>/dev/null || true
sudo sh /srv/relay/install-cli.sh
/usr/local/bin/relay --help </dev/null

reload_nginx() {
  if ! docker compose exec -T nginx nginx -t </dev/null >/dev/null 2>&1; then
    echo "nginx 설정 검사 실패" >&2; return 1
  fi
  docker compose exec -T nginx nginx -s reload </dev/null >/dev/null 2>&1
}

# 도메인은 비공개 환경 파일 또는 기존 nginx 설정에서 읽는다.
sh /srv/relay/render-nginx.sh nginx/relay.conf.new nginx/relay.conf.new
RELAY_DOMAIN=$(sed -n 's/^RELAY_DOMAIN=//p' .env | tail -n 1)
if sudo test -f "certbot/conf/live/$RELAY_DOMAIN/fullchain.pem"; then
  mv -f nginx/relay.conf.new nginx/conf.d/relay.conf
  reload_nginx
else
  rm -f nginx/relay.conf.new
fi

# 브라우저 모드 화면: 새 빌드를 releases/<태그>에 풀고 current 링크만 바꾼다(nginx가 ./web을 마운트해 current를 내려준다). 최근 3개만 남긴다.
TAG="${IMAGE##*:}"
mkdir -p web/releases
if [ -f web.tgz ]; then
  rm -rf "web/releases/$TAG"
  mkdir -p "web/releases/$TAG"
  tar -xzf web.tgz -C "web/releases/$TAG"
  ln -sfn "releases/$TAG" web/current.next
  mv -Tf web/current.next web/current
  rm -f web.tgz
  find web/releases -mindepth 1 -maxdepth 1 -type d ! -name "$TAG" -printf '%T@ %p\n' | sort -rn | tail -n +3 | cut -d' ' -f2- | xargs -r rm -rf
fi
# 화면 도메인은 Actions 비밀(둘째 줄)이나 비공개 환경 파일에서 읽는다. 없으면(3) 브라우저 모드를 쓰지 않는 서버다.
# 인증서가 없으면 ACME만 받는 1단계 설정으로 먼저 발급받고 2단계 설정으로 바꾼다. relay-api의 CORS 허용 목록도 같은 출처로 맞춘다.
WEB_READY=0
web_code=0
RELAY_WEB_DOMAIN="$WEB_DOMAIN" sh /srv/relay/render-web-nginx.sh nginx/relay-web.conf.new nginx/relay-web.conf.rendered || web_code=$?
if [ "$web_code" -eq 0 ]; then
  RELAY_WEB_DOMAIN=$(sed -n 's/^RELAY_WEB_DOMAIN=//p' .env | tail -n 1)
  if ! sudo test -f "certbot/conf/live/$RELAY_WEB_DOMAIN/fullchain.pem"; then
    sh /srv/relay/render-web-nginx.sh nginx/relay-web.http.conf.new nginx/conf.d/relay-web.conf
    reload_nginx || { rm -f nginx/conf.d/relay-web.conf; exit 1; }
    if ! docker compose run --rm --no-deps --entrypoint certbot certbot certonly --webroot -w /var/www/certbot -d "$RELAY_WEB_DOMAIN" \
      --register-unsafely-without-email --agree-tos --no-eff-email --non-interactive </dev/null >/dev/null 2>&1; then
      echo "브라우저 모드 화면 인증서를 받지 못했습니다(DNS가 이 서버를 가리키는지 확인)." >&2
    fi
  fi
  if sudo test -f "certbot/conf/live/$RELAY_WEB_DOMAIN/fullchain.pem"; then
    mv -f nginx/relay-web.conf.rendered nginx/conf.d/relay-web.conf
    reload_nginx
    WEB_READY=1
  else
    rm -f nginx/relay-web.conf.rendered
  fi
elif [ "$web_code" -ne 3 ]; then
  exit "$web_code"
fi
rm -f nginx/relay-web.conf.new nginx/relay-web.http.conf.new

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
    if [ "$WEB_READY" -eq 1 ]; then
      if ! curl -fsS --max-time 10 "https://$RELAY_WEB_DOMAIN/build.json" >/dev/null 2>&1 || ! curl -fsS --max-time 10 "https://$RELAY_WEB_DOMAIN/api/v1/health" >/dev/null 2>&1; then
        echo "브라우저 모드 화면 확인 실패" >&2; exit 1
      fi
      echo "browser web ready"
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
