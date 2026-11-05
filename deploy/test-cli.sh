#!/usr/bin/env sh
# Docker 대신 인자를 기록하는 실행 파일로 호스트 CLI·설치 동작을 검증한다.
set -eu
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/relay-cli-test.XXXXXX")
cleanup() {
  case "$test_dir" in
    "${TMPDIR:-/tmp}"/relay-cli-test.*) rm -rf -- "$test_dir" ;;
    *) exit 1 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$test_dir/tools" "$test_dir/server dir" "$test_dir/bin"
touch "$test_dir/server dir/compose.yml"
cat > "$test_dir/tools/docker" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$@" > "$RELAY_CLI_TEST_CAPTURE"
printf '%s\n' '{"token":"test-only"}'
exit "${RELAY_CLI_TEST_EXIT:-0}"
EOF
chmod +x "$test_dir/tools/docker"
export PATH="$test_dir/bin:$test_dir/tools:$PATH"
export RELAY_SERVER_DIR="$test_dir/server dir"
export RELAY_CLI_TEST_CAPTURE="$test_dir/args"
cd "$test_dir"

sh "$script_dir/install-cli.sh" "$test_dir/bin" >/dev/null
sh "$script_dir/install-cli.sh" "$test_dir/bin" >/dev/null
name='office pc;$(touch injected)'
relay create-token --name "$name" --json > result
cat > expected <<EOF
compose
--project-directory
$RELAY_SERVER_DIR
-f
$RELAY_SERVER_DIR/compose.yml
exec
-T
relay-api
node
dist/cli.js
token
create
--name
$name
--json
EOF
cmp expected "$RELAY_CLI_TEST_CAPTURE"
grep -Fq '"token":"test-only"' result
test ! -e injected
rm "$RELAY_CLI_TEST_CAPTURE"
relay --help >/dev/null
test ! -e "$RELAY_CLI_TEST_CAPTURE"
for invalid in 'missing' 'blank' 'unknown'; do
  code=0
  case "$invalid" in
    missing) relay create-token --name > result 2>&1 || code=$? ;;
    blank) relay create-token --name '   ' > result 2>&1 || code=$? ;;
    unknown) relay create-token --name office --extra > result 2>&1 || code=$? ;;
  esac
  test "$code" -eq 2
  test ! -e "$RELAY_CLI_TEST_CAPTURE"
done
code=0
RELAY_CLI_TEST_EXIT=7 relay create-token --name office > result 2>&1 || code=$?
test "$code" -eq 7
mkdir other
printf '%s\n' 'another CLI' > other/relay
if sh "$script_dir/install-cli.sh" "$test_dir/other" > result 2>&1; then exit 1; fi
test "$(cat other/relay)" = 'another CLI'
code=0
RELAY_SERVER_DIR="$test_dir/missing" relay create-token --name office > result 2>&1 || code=$?
test "$code" -eq 1
mkdir -p "$RELAY_SERVER_DIR/nginx/conf.d"
printf '%s\n' 'KEEP_FIELD=1' > "$RELAY_SERVER_DIR/.env"
printf '%s\n' 'server_name service.example.invalid;' > "$RELAY_SERVER_DIR/nginx/conf.d/relay.conf"
sh "$script_dir/render-nginx.sh" "$script_dir/nginx/relay.conf" rendered.conf > result
test ! -s result
grep -Fq 'server_name service.example.invalid;' rendered.conf
grep -Fq 'RELAY_DOMAIN=service.example.invalid' "$RELAY_SERVER_DIR/.env"
grep -Fxq 'KEEP_FIELD=1' "$RELAY_SERVER_DIR/.env"
grep -Fq '$host' rendered.conf
if grep -Fq '__RELAY_DOMAIN__' rendered.conf; then exit 1; fi
RELAY_DOMAIN=other.example.invalid sh "$script_dir/render-nginx.sh" "$script_dir/nginx/relay.http.conf" rendered.conf > result
test ! -s result
grep -Fq 'server_name other.example.invalid;' rendered.conf
code=0
RELAY_DOMAIN='invalid; domain' sh "$script_dir/render-nginx.sh" "$script_dir/nginx/relay.conf" rendered.conf > result 2>&1 || code=$?
test "$code" -eq 2
sh -n "$script_dir/relay.sh" "$script_dir/install-cli.sh" "$script_dir/deploy-remote.sh"
printf '%s\n' 'Ubuntu CLI: 설치·재설치·인자 보존·입력 검사·실패 전파·기존 명령 보존 통과'
