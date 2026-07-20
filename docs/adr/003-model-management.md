# ADR-003：本地模型管理与国内镜像下载

**状态**：已接受  
**日期**：2026-07-01

## 背景

仓库内 `models/bge-m3/` 来自 `BAAI/bge-m3`（sentence-transformers / PyTorch），仅有 tokenizer 与 config，**无权重**，且格式与 `@huggingface/transformers` 所需的 **Xenova/bge-m3 ONNX** 不兼容。

国内开发环境访问 `huggingface.co` 不稳定，需要默认使用镜像并在缺失时自动下载。

## 决策

1. 以 [`models/manifest.json`](../models/manifest.json) 登记所有运行时模型及 `requiredFiles`
2. 嵌入模型使用 **`Xenova/bge-m3`**，本地路径 `models/Xenova/bge-m3/`（ONNX fp16）
3. 生成模型使用 **`PleIAs/Pleias-RAG-1B-gguf`**，本地路径 `models/Pleias-RAG-1B/`
4. 默认镜像 **`https://hf-mirror.com`**；Transformers.js 通过 `env.remoteHost` 配置（不依赖 `HF_ENDPOINT` 自动生效）
5. `ModelManager.ensure()` 在 rag-server 启动与 `pnpm models:ensure` 脚本中执行；支持 `force` 重新下载
6. 废弃 `models/bge-m3/`，开发任务中迁移至正确路径

## 理由

- 单一 manifest 便于校验、CI 与 UI 展示下载进度
- 本地优先 + 镜像回退，兼顾离线开发与国内网络
- 明确区分 BAAI PyTorch 与 Xenova ONNX，避免误用仓库内残留文件

## 后果

- 需实现 `ModelManager` 与 `scripts/models-ensure.ts`
- 大文件（GGUF ~2.4 GB）不入 git；`.gitignore` 忽略权重，保留 manifest/README
- Phase 2 补充设置页「重新下载模型」UI
