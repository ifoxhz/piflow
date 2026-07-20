#!/usr/bin/env bash
# 在 GPU 服务器（T640 / 10.0.0.7）上运行，部署 Pleias-RAG-1B 到 Ollama
set -euo pipefail

MODEL_DIR="${HOME}/models/pleias-rag-1b"
GGUF_URL="${GGUF_URL:-https://hf-mirror.com/PleIAs/Pleias-RAG-1B-gguf/resolve/main/Pleias-RAG-1B.gguf}"

mkdir -p "$MODEL_DIR"
cd "$MODEL_DIR"

if [[ ! -f Pleias-RAG-1B.gguf ]]; then
  echo "Downloading Pleias-RAG-1B.gguf (~2.3GB)..."
  wget -c "$GGUF_URL" -O Pleias-RAG-1B.gguf
fi

cat > Modelfile <<'EOF'
FROM ./Pleias-RAG-1B.gguf

PARAMETER temperature 0
PARAMETER top_p 0.95
PARAMETER num_ctx 4096
PARAMETER num_predict 600
PARAMETER stop "#END#"
PARAMETER stop "<|answer_end|>"
EOF

ollama create pleias-rag-1b -f Modelfile

echo ""
echo "Done. Verify:"
echo "  ollama list"
echo "  ollama run pleias-rag-1b"
