#!/usr/bin/env bash
# Sync Windows working tree into the WSL Linux clone and start rag-server + Vite.
set -euo pipefail

SRC=/mnt/d/dev/raglamp
DST=/home/yong/workspace/github/raglamp

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
hash -r

echo "== node $(node -v)  pnpm $(pnpm -v) =="

if [[ ! -d "$SRC" ]]; then
  echo "Windows repo not mounted: $SRC" >&2
  exit 1
fi

mkdir -p "$DST"
rsync -a \
  --exclude node_modules \
  --exclude .data \
  --exclude .git \
  --exclude dist-windows \
  --exclude .tmp-extract-test \
  --exclude apps/desktop/src-tauri/target \
  --exclude apps/rag-server/dist \
  --exclude packages/core/dist \
  --exclude packages/pg-actions/dist \
  "$SRC/" "$DST/"

cd "$DST"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# Browser on Windows cannot reach WSL :3847; Vite proxies /api → rag-server.
if grep -q '^VITE_RAG_SERVER_URL=' .env; then
  sed -i 's|^VITE_RAG_SERVER_URL=.*|VITE_RAG_SERVER_URL=/api|' .env
else
  echo 'VITE_RAG_SERVER_URL=/api' >> .env
fi

if [[ "${SKIP_INSTALL:-}" != "1" ]]; then
  pnpm install
fi

# Rebuild shared packages so rag-server/desktop resolve @bluelamp/core canvas types.
pnpm --filter @bluelamp/core build
pnpm --filter @bluelamp/pg-actions build || true

free_port() {
  local port=$1
  local pids
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)
  if [[ -n "$pids" ]]; then
    echo "Stopping listeners on :$port ($pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

free_port 3847
free_port 1420

echo "== starting rag-server :3847 and Vite :1420 =="
echo "UI:  http://localhost:1420"
echo "API: http://127.0.0.1:3847/health"

pnpm --parallel --filter @bluelamp/rag-server --filter @bluelamp/desktop dev
