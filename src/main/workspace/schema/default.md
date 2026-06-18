# Wiki 维护规约（默认 schema）

## 1. 摘要页结构
- 每个原始资料生成 1 个 sources/<slug>.md
- 包含 frontmatter（title / source / ingested_at / quality 必填）
- 正文分 3 段：
  - 概要（150 字内）
  - 关键章节（带原文引用页码）
  - 适用场景与限制

## 2. 命名约定
- wiki 页路径用 slug：basename().toLowerCase().replace(/\s+/g, '-')
- 例：JTG 3420-2020.pdf → sources/jtg-3420-2020.md
- 例：客户技术要求.docx → sources/客户技术要求.md（中文保留）

## 3. 交叉引用格式
- 用 [[wiki/path]] 双向链接
- 例：[[concepts/抗渗混凝土]]
- 提到其他资料时必须建立链接

## 4. log 格式
- 每行：`## [YYYY-MM-DD HH:mm] <action> | <subject>`
- action ∈ {ingest, query, lint, write, chat-export}
- 例：`## [2026-06-17 10:30] ingest | JTG 3420-2020.pdf`

## 5. 概念页（concepts/）
- 跨资料的概念汇总，由 LLM 在 ingest 后增量建
- 触发条件：≥2 个 sources 提到同一概念
