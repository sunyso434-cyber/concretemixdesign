# 砼智 Concrete Agent

基于 Electron + React 的混凝土配合比智能设计软件，集成 AI Agent 辅助设计与知识库管理。

**当前版本：v0.7.2**

## 核心功能

### AI 智能设计
- **配合比智能设计**：AI Agent 多步编排，自动调用计算/优化/审查技能，支持多轮对话与工具调用
- **LLM 自动路由**：多模型故障自动切换（failover），激活模型优先；前端实时显示当前使用的 LLM，用户可感知路由状态
- **联网搜索 + 学术搜索**：Agent 可调用网页抓取与学术论文检索能力辅助设计
- **上下文压缩**：长对话自动压缩摘要，突破上下文长度限制

### 业务计算
- **配合比计算**：基于 JGJ55 标准的混凝土配合比设计
- **成本优化**：网格搜索寻找最低成本配比
- **规范合规审查**：自动检查配比是否符合规范
- **强度预测**：XGBoost 模型预测 28 天抗压强度（模型存于 `resources/models/`）
- **销售报价**：含泵送费等附加项的报价生成

### 试配闭环与模型训练
- **试配记录**：录入/查询实际试配数据，形成「设计 → 试配 → 复盘」闭环
- **原材料批次管理**：材料批次独立管理，配合比设计与预测使用批次检测值
- **模型重新训练**：基于基座数据 + 试配记录重新训练 XGBoost 模型（28d 强度 / 容重 / 减水剂掺量），TPE 自动调参，训练前自动归档旧版本，支持回滚
- **模型指标**：训练后展示真实 RMSE / R²，预测按 R² 自动调整置信度

### 知识库与文档
- **工作区（Workspace）**：项目管理与文件组织
- **Wiki 知识引擎**：文档入库、全文检索（BM25）、知识图谱抽取与合并、健康检查
- **MinerU 高精度文档解析**（v0.7.0）：云端解析扫描件 PDF、复杂表格/公式/多栏版式、图片、PPT 等，输出 Markdown 自动入库；内置加密 Token（用户可自配覆盖），上云前需用户确认
- **MD 阅读器**（v0.6.x ~ v0.7.1）：应用内 Markdown 查看与编辑，支持多标签、原子保存、外部修改冲突提示；agent 修改报告后已打开的阅读器自动刷新（v0.7.1）
- **Office 文档处理**：通过 OfficeCLI 创建/编辑/读取 docx/xlsx/pptx（Agent 可生成格式化报告）
- **会话归档**：批量归档/恢复/删除历史会话，归档会话只读

### 交互体验
- **Todo 计划面板**：实时显示 Agent 任务清单与进度
- **历史消息自动加载**：滚动到顶自动加载更多历史
- **批量管理模式**：材料/方案的批量操作

### 手机远程版（Android App）
- **砼智移动版**：Flutter 独立 App，通过腾讯云中转**端到端连回电脑端**，随时随地用手机指挥 AI
- **功能**：Agent 对话（流式输出）、发图上传、确认弹窗、历史会话、工作区切换，电脑与手机**双向实时同步**
- **零配置**：电脑端应用**启动即自动启用远程 + 自动连隧道**（frpc 内置，失败自动重连）；服务器地址/连接密钥写死默认值，其他用户装上即可用
- **连接链路**：手机 `wss://www.concreteagent.cloud/concrete/ws` → 腾讯云（Caddy 终结 TLS + frps 隧道服务）→ frp 隧道 → 电脑端
- **连接方式**：手机 App 扫码（电脑端「远程连接」面板二维码）配对 → 输入密码登录（密码在面板可重置查看）
- **安全**：配对（扫码）+ 密码双认证；电脑端远程服务仅监听本机 127.0.0.1，公网暴露只经加密隧道与正规域名证书

## 快速开始

```bash
# 安装依赖
npm install

# 终端 1：启动 Vite 前端服务
npm run dev

# 终端 2：启动 Electron 桌面应用
npm run electron:dev

# 运行全量测试
npm test

# 只构建前端产物
npm run build

# 构建 Windows 安装包和便携版
npm run electron:build

# （手机端）构建 Android APK
cd Android-concreteagent && flutter build apk --release
```

打包产物输出到 `dist-<版本号>/`，包含 NSIS 安装包、便携版和解压版；手机 APK 输出到 `Android-concreteagent/build/app/outputs/flutter-apk/app-release.apk`。

## 技术栈

- **桌面框架**：Electron
- **前端**：React + Ant Design + Vite
- **AI 服务**：多 LLM 自动路由（DeepSeek / Minimax / Kimi 等，支持 failover 故障切换）
- **数据库**：SQLite（Sequelize ORM）
- **机器学习**：XGBoost 强度预测（模型序列化为 JSON，纯 JS 推理）
- **文档处理**：OfficeCLI（docx/xlsx/pptx 读写）
- **手机端**：Flutter（Android App，`Android-concreteagent/`）
- **远程隧道**：frp（frpc 内置随应用分发，云端 frps + Caddy 终结 TLS）
- **测试**：Jest（桌面）/ Flutter test（手机）

## 项目结构

```
src/
├── main/                    # 主进程
│   ├── agent/               # Agent 基础设施（编排/策略/工具/系统提示）
│   ├── skills/              # 应用级技能（业务计算 JS 模块）
│   ├── services/            # 业务服务层（LLM/搜索/记忆/压缩等）
│   ├── ipcHandlers/         # IPC 接口
│   ├── workspace/           # 工作区与 Wiki 知识引擎
│   ├── officecli/           # Office 文档处理桥接
│   ├── db/                  # 数据库模型
│   └── migrations/          # 数据库迁移
├── renderer/                # 渲染进程（React UI）
│   ├── pages/               # 页面（工作区/材料/方案/设置）
│   └── components/          # 组件（聊天/Agent/报告/导入导出等）
├── shared/                  # 主进程与渲染进程共享代码
└── ...
resources/
├── models/                  # XGBoost 模型文件
├── officecli/               # OfficeCLI 二进制（按平台分目录）
└── frpc/                    # frp 客户端二进制（远程隧道，随应用分发）
Android-concreteagent/       # 手机端 Flutter App（砼智移动版）
```

## 技能系统说明

本项目存在两套独立的"技能"体系：

### 应用级技能（业务计算）

- **位置**：`src/main/skills/`（内置）+ `~/.concrete-mixdesign/skills/`（用户自建）
- **格式**：JavaScript 代码模块
- **用途**：混凝土配合比计算、成本优化、规范审查等核心业务
- **执行方式**：代码计算，LLM 只负责决定调用哪个技能，不参与计算过程

核心技能：

| 技能 | 功能 |
|------|------|
| `calculate_mix_design` | 配合比计算 |
| `optimize_mix_cost` | 成本优化（网格搜索） |
| `check_compliance` | 规范合规审查 |
| `predict_performance` | XGBoost 强度预测 |
| `calculate_sales_quote` | 销售报价生成 |
| `retrain_model` | 模型重新训练（TPE 调参，自动归档回滚） |
| `parse_with_mineru` | MinerU 高精度文档解析（v0.7.0） |
| `record_trial_test` | 试配记录录入 |
| `material_batch_manage` | 原材料批次管理 |
| `workspace_writeFile` | 写 Markdown 报告到 reports/（支持 payload 整文件 / patches 局部修改） |

### Agent 工具体系

Agent 运行时可调用的工作区/文档/搜索工具（如 `workspace_writeFile`、`create_office_file`、`edit_office_file`、`workspace_lint`、`web_fetch` 等），由 Agent 编排器统一注册与执行，实现多步工具调用完成复杂任务。

## 配置

- **LLM 配置**：在应用内「设置 → LLM 管理」添加多个模型（API Key / Base URL / 模型名），可激活默认模型
- **OfficeCLI**：首次打包时自动包含，无需手动安装
- **数据存储**：用户数据存于 `~/.concrete-mixdesign/`

## 版本记录

详见 [version_log.md](version_log.md)。
