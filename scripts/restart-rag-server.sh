#!/usr/bin/env bash
# Stop any rag-server on PIFLOW_RAG_PORT, then start pnpm dev:server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PIFLOW_RAG_PORT:-3847}"

if [ -f "$ROOT/.env" ]; then
  line="$(grep -E '^PIFLOW_RAG_PORT=' "$ROOT/.env" | tail -1 || true)"
  if [ -n "$line" ]; then
    PORT="${line#PIFLOW_RAG_PORT=}"
    PORT="${PORT//\"/}"
    PORT="${PORT//\'/}"
  fi
fi

pids_on_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti :"${PORT}" 2>/dev/null | sort -u
  fi
}

stop_rag_server() {
  local killed=0
  local pid

  while read -r pid; do
    [ -z "$pid" ] && continue
    echo "[restart-rag-server] stopping pid $pid (port $PORT)"
    kill "$pid" 2>/dev/null || true
    killed=1
  done < <(pids_on_port || true)

  # tsx watch may still be running without holding the port yet
  if pkill -f "apps/rag-server.*tsx watch" 2>/dev/null; then
    echo "[restart-rag-server] stopped tsx watch (rag-server)"
    killed=1
  fi

  if [ "$killed" -eq 1 ]; then
    sleep 1
  else
    echo "[restart-rag-server] no running instance on port $PORT"
  fi
}

stop_rag_server
cd "$ROOT"
exec pnpm dev:server
