#!/usr/bin/env bash
set -Eeuo pipefail
release="${1:?Release ID required}"
[[ "$release" =~ ^[a-zA-Z0-9-]+$ ]] || { echo 'Invalid release ID' >&2; exit 1; }

app_root=/opt/alpha-hunter-formal
release_dir="$app_root/releases/$release"
shared_dir="$app_root/shared"
shared_env="$shared_dir/.env"
[[ -f "$release_dir/infra/compose.yaml" ]] || { echo 'Release is incomplete' >&2; exit 1; }

mkdir -p "$shared_dir"
if [[ ! -f "$shared_env" ]]; then
  umask 077
  db_password=$(openssl rand -hex 32)
  {
    printf 'DB_PASSWORD=%s\n' "$db_password"
    printf 'APP_PORT=4175\n'
    printf 'AGENT_ALLOWED_BASE_URLS=https://api.openai.com/v1\n'
  } > "$shared_env"
fi
chmod 600 "$shared_env"
set -a
. "$shared_env"
set +a

exec 9>"$app_root/deploy.lock"
flock -w 300 9 || { echo 'Another formal deployment is running' >&2; exit 1; }
previous=$(readlink -f "$app_root/current" 2>/dev/null || true)
if [[ "$previous" != "$app_root/releases/"* || ! -f "$previous/infra/compose.yaml" ]]; then previous=''; fi
switched=0
test_database="alpha_test_${release//-/}"
test_database="${test_database:0:60}"

compose() {
  local source_dir="$1"; shift
  local source_version
  source_version=$(basename "$source_dir")
  APP_VERSION="$source_version" docker compose --project-name alpha-hunter-formal \
    --project-directory "$source_dir" --env-file "$shared_env" \
    -f "$source_dir/infra/compose.yaml" "$@"
}
cleanup_test_database() {
  compose "$release_dir" exec -T db dropdb --if-exists -U alpha "$test_database" >/dev/null 2>&1 || true
}
failure() {
  local code=$?
  trap - ERR
  cleanup_test_database
  if [[ "$switched" == 1 && -n "$previous" ]]; then
    echo 'Formal deployment failed; restoring previous application images.' >&2
    compose "$previous" up -d --wait --wait-timeout 90 || echo 'ROLLBACK FAILED: inspect Compose logs.' >&2
  fi
  exit "$code"
}
trap failure ERR
trap cleanup_test_database EXIT

docker compose version
compose "$release_dir" pull db redis
compose "$release_dir" build --pull api web
docker run --rm --network none "alpha-hunter-api:$release" python -m pytest tests app/agent/tests -q

compose "$release_dir" up -d --wait --wait-timeout 90 db redis
compose "$release_dir" exec -T db createdb -U alpha "$test_database"
compose "$release_dir" run --rm \
  -e "TEST_DATABASE_URL=postgresql+psycopg://alpha:${DB_PASSWORD}@db:5432/$test_database" \
  api python -m pytest tests/test_postgres.py -q
cleanup_test_database

switched=1
compose "$release_dir" up -d --wait --wait-timeout 120
health=$(curl --fail --silent --show-error http://127.0.0.1:4175/api/health)
[[ "$health" == *'"status":"ok"'* ]]
count=$(curl --fail --silent http://127.0.0.1:4175/api/indices | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[[ "$count" == 19 ]]
curl --fail --silent --output /dev/null http://127.0.0.1:4175/

[[ -z "$previous" ]] || ln -sfn "$previous" "$app_root/previous"
ln -sfn "$release_dir" "$app_root/current"
echo "Healthy formal release: $release"
echo "$health"
compose "$release_dir" ps
