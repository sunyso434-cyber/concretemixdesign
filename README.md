# 混凝土配合比设计系统

基于 Electron + React 的混凝土配合比智能设计软件，集成 AI Agent 辅助设计。

## 技能系统说明

本项目存在两套完全独立的"技能"体系，**本质不同，互不关联**：

### 应用级技能（业务计算）

- **位置**：`src/main/skills/`（内置）+ `~/.concrete-mixdesign/skills/`（用户自建）
- **格式**：JavaScript 代码模块
- **用途**：混凝土配合比计算、成本优化、规范审查等核心业务
- **执行方式**：代码计算，LLM 只负责决定调用哪个技能，不参与计算过程
- **数量**：内置 18 个技能

核心技能包括：
| 技能 | 功能 |
|------|------|
| `calculate_mix_design` | 配合比计算 |
| `optimize_mix_cost` | 成本优化（网格搜索） |
| `check_compliance` | 规范合规审查 |
| `predict_performance` | XGBoost 强度预测 |
| `calculate_sales_quote` | 销售报价生成 |

### Agent 级指令（编码辅助）

- **位置**：`.claude/skills/`、`.agents/skills/` 等目录
- **格式**：Markdown 文件（SKILL.md）
- **用途**：告诉 AI 编码助手如何操作 Office 文档（docx、pdf、pptx）
- **与业务无关**：这些是开发辅助工具，不参与配合比计算

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 构建打包
npm run build
```

## 技术栈

- **桌面框架**：Electron
- **前端**：React + Ant Design
- **AI 服务**：DeepSeek API
- **数据库**：SQLite（Sequelize ORM）
- **机器学习**：ONNX Runtime（XGBoost 强度预测）

## 项目结构

```
src/
├── main/                    # 主进程
│   ├── skills/              # 应用级技能（JS 代码）
│   ├── agent/               # Agent 基础设施
│   │   ├── SkillRegistry.js    # 技能注册与发现
│   │   ├── SkillExecutor.js    # 技能执行引擎
│   │   ├── SchemaValidator.js  # 参数校验
│   │   ├── ContextProvider.js  # 上下文注入
│   │   └── AgentOrchestrator.js # 多步 Agent 编排
│   ├── services/            # 业务服务层
│   ├── ipcHandlers/         # IPC 接口
│   └── db/                  # 数据库模型
├── renderer/                # 渲染进程（React UI）
└── ...
```

## 版本

当前版本：4.1.0
