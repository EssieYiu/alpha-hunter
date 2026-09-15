#!/usr/bin/env bash
set -Eeuo pipefail
release="${1:?Release ID required}"
[[ "$release" =~ ^[a-zA-Z0-9-]+$ ]] || { echo 'Invalid release ID' >&2; exit 1; }
root=/opt/alpha-hunter
directory="$root/releases/$release"
[[ -f "$directory/Dockerfile" && -f "$directory/compose.yaml" ]] || exit 1
exec 9>"$root/deploy.lock"
flock -w 180 9 || { echo 'Another deployment is still running' >&2; exit 1; }
previous=$(readlink -f "$root/current" 2>/dev/null || true)
if [[ "$previous" != "$root/releases/"* || ! -f "$previous/.env.deploy" ]]; then previous=''; fi
candidate="alpha-hunter-check-$release"
switched=0
compose() { local dir="$1"; shift; docker compose --project-name alpha-hunter --project-directory "$dir" --env-file "$dir/.env.deploy" -f "$dir/compose.yaml" "$@"; }
cleanup() { docker rm -f "$candidate" >/dev/null 2>&1 || true; }
failure() {
  local code=$?
  trap - ERR
  cleanup
  if [[ "$switched" == 1 && -n "$previous" ]]; then
    echo 'Deployment failed; restoring previous image.' >&2
    if compose "$previous" up -d --wait --wait-timeout 60; then echo 'Previous version restored.' >&2
    else echo 'ROLLBACK FAILED: inspect docker compose logs on server.' >&2; fi
  elif [[ "$switched" == 1 ]]; then
    compose "$directory" down || true
    echo 'First deployment failed; no previous release exists.' >&2
  fi
  exit "$code"
}
trap failure ERR
trap cleanup EXIT
cd "$directory"
docker compose version
docker pull node:22-alpine
base=$(docker image inspect node:22-alpine --format '{{index .RepoDigests 0}}')
printf '%s\n' "$base" > base-image.txt
docker build --build-arg "NODE_IMAGE=$base" --build-arg "APP_VERSION=$release" -t "alpha-hunter:$release" .
printf 'APP_IMAGE=alpha-hunter:%s\n' "$release" > .env.deploy
chmod 600 .env.deploy
docker run -d --name "$candidate" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true "alpha-hunter:$release" >/dev/null
healthy=0
for ((attempt=0; attempt<30; attempt++)); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$candidate")
  if [[ "$status" == healthy ]]; then healthy=1; break; fi
  if [[ "$status" == unhealthy ]]; then break; fi
  sleep 2
done
[[ "$healthy" == 1 ]] || { docker logs "$candidate"; false; }
cleanup
switched=1
compose "$directory" up -d --wait --wait-timeout 60
response=$(curl --fail --silent --show-error http://127.0.0.1:4173/health)
[[ "$response" == *"\"version\":\"$release\""* ]]
curl --fail --silent --output /dev/null http://127.0.0.1:4173/
[[ -z "$previous" ]] || ln -sfn "$previous" "$root/previous"
ln -sfn "$directory" "$root/current"
echo "Healthy release: $release"
echo "$response"
compose "$directory" ps
# Retain release directories/images for rollback; never prune other projects.
