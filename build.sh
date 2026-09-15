#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
target="${DEPLOY_HOST:-root@8.216.46.125}"
[[ "$target" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Invalid DEPLOY_HOST' >&2; exit 1; }
ssh_command=ssh
if [[ "${OSTYPE:-}" == msys* ]] && [[ -x /c/Windows/System32/OpenSSH/ssh.exe ]]; then
  ssh_command=/c/Windows/System32/OpenSSH/ssh.exe
fi
ssh_args=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
for command in tar git; do command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }; done
revision=$(git rev-parse --short HEAD 2>/dev/null || printf workspace)
release="$(date -u +%Y%m%dT%H%M%SZ)-${revision}-${RANDOM}"
temporary=$(mktemp -d)
trap 'rm -f -- "$temporary/source.tar.gz"; rmdir -- "$temporary"' EXIT

echo "[1/3] Package formal application: $release"
tar --exclude='apps/api/.venv' --exclude='apps/api/.pytest_cache' --exclude='**/__pycache__' \
  --exclude='apps/web/node_modules' --exclude='apps/web/.npm-tool' --exclude='apps/web/dist' \
  -czf "$temporary/source.tar.gz" AGENTS.md apps/api apps/web contracts docs infra scripts/deploy-formal-remote.sh
echo "[2/3] Upload to $target"
"$ssh_command" "${ssh_args[@]}" "$target" \
  "umask 077; mkdir -p /opt/alpha-hunter-formal/uploads; cat > /opt/alpha-hunter-formal/uploads/$release.tar.gz" \
  < "$temporary/source.tar.gz"
echo '[3/3] Build, migrate, test and deploy formal application'
"$ssh_command" "${ssh_args[@]}" "$target" \
  "set -e; umask 077; mkdir -p /opt/alpha-hunter-formal/releases/$release; tar -xzf /opt/alpha-hunter-formal/uploads/$release.tar.gz -C /opt/alpha-hunter-formal/releases/$release; bash /opt/alpha-hunter-formal/releases/$release/scripts/deploy-formal-remote.sh $release"

printf '\nFormal deployment complete. Keep this tunnel running:\n'
printf 'ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4175:127.0.0.1:4175 %s\n' "$target"
printf 'Then open http://127.0.0.1:4175/. The prototype remains on local/server port 4173.\n'
