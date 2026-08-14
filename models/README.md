# 本地模型目录

piFlow 运行时模型清单见 [`manifest.json`](./manifest.json)。应用启动时会校验所需文件，**缺失则自动从国内镜像下载**。

## 当前状态

| 路径 | 说明 |
|------|------|
| `models/Xenova/bge-m3/` | Transformers.js ONNX 嵌入模型 |
| `models/Pleias-RAG-1B/` | Pleias-RAG-1B GGUF 生成模型 |

> 旧目录 `models/bge-m3/`（BAAI PyTorch 残留）已删除，勿再使用。

请使用项目提供的下载脚本重新拉取，或手动从镜像站下载。

## 国内镜像（推荐）

| 用途 | 地址 |
|------|------|
| Hugging Face 镜像（主） | https://hf-mirror.com |
| 环境变量（CLI 工具） | `export HF_ENDPOINT=https://hf-mirror.com` |
| Transformers.js 代码配置 | `env.remoteHost = 'https://hf-mirror.com'` |

> Transformers.js **不会自动读取** `HF_ENDPOINT`，须在 `pipeline()` 调用前设置 `env.remoteHost`（见架构文档 §4.7）。

## 手动下载

### BGE-M3（Xenova/bge-m3，fp16）

```bash
# 使用 huggingface-cli + 镜像
export HF_ENDPOINT=https://hf-mirror.com
huggingface-cli download Xenova/bge-m3 \
  --local-dir models/Xenova/bge-m3 \
  --include "config.json" "tokenizer*.json" "*.model" "onnx/model_fp16.onnx"
```

或使用 `hfd`（hf-mirror 推荐工具）：

```bash
export HF_ENDPOINT=https://hf-mirror.com
hfd Xenova/bge-m3 --tool aria2c -x 4 --local-dir models/Xenova/bge-m3
```

### Pleias-RAG-1B GGUF

```bash
export HF_ENDPOINT=https://hf-mirror.com
huggingface-cli download PleIAs/Pleias-RAG-1B-gguf \
  Pleias-RAG-1B.gguf \
  --local-dir models/Pleias-RAG-1B
```

## 目录结构（目标）

```
models/
├── manifest.json
├── README.md
├── Xenova/
│   └── bge-m3/              # Transformers.js ONNX
│       ├── config.json
│       ├── tokenizer.json
│       └── onnx/
│           └── model_fp16.onnx
└── Pleias-RAG-1B/
    └── Pleias-RAG-1B.gguf
```

## 生产环境缓存

打包发布后，用户数据目录由壳注入（`PIFLOW_DATA_DIR`），Windows 便携版为：

- Windows: `%APPDATA%\piFlow\`（模型亦可随便携包 `models/` 分发）

开发阶段优先使用仓库内 `models/` 目录（`env.localModelPath` 指向项目根）。
