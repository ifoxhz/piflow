# ADR-002：文档解析采用 pdf-oxide + Docling 分层策略

**状态**：已接受  
**日期**：2026-07-01

## 背景

BlueLamp 需要从 PDF、DOCX、Markdown 等格式摄取文档并分块，供 BGE-M3 嵌入与 Pleias 引用溯源。需在解析质量、运行时依赖与 Tauri + Node Sidecar 架构之间取得平衡。

## 决策

采用 **分层路由**，而非单一解析库：

| 路径 | 库 | 运行时 |
|------|-----|--------|
| txt / md / html | 内置 + `packages/core` chunker | Node |
| 简单 PDF | **pdf-oxide** → Markdown → core chunker | Node |
| 复杂 PDF / DOCX / 扫描件 | **Docling** + `HybridChunker` | Python Sidecar |

Phase 1 实现 pdf-oxide + 文本格式；Docling 在 Phase 2 接入。

## 理由

1. **pdf-oxide** 有官方 Node N-API 绑定，预编译多平台二进制，与 Node Sidecar 架构一致，PDF 提取极快
2. **Docling** 在版面理解、OCR、表格、多格式和内置 `HybridChunker`（含 bbox/页码元数据）上明显更强，适合 Pleias 引用溯源
3. 全量 Docling 会增加 Python 依赖与模型体积；全量 pdf-oxide 无法处理扫描 PDF 与复杂 Word
4. 分层路由让 MVP 保持纯 Node，质量不足时再启用 Docling

## 后果

- 需实现 `Ingestion Router` 与统一 `ParsedDocument` / `Chunk` 模型
- Phase 2 需维护 `apps/docling-sidecar` 及跨平台 Python 打包
- 分块逻辑分两路：core chunker（pdf-oxide）与 Docling HybridChunker

## 备选方案（未采用）

| 方案 | 放弃原因 |
|------|----------|
| 仅 pdf-parse + mammoth | 版面与表格质量不足 |
| 仅 Docling | MVP 过重，强依赖 Python |
| DocMarrow（纯 TS） | 生态与复杂 PDF 能力不如 Docling，用户未选用 |
