## v1.0.0 新增"质量诊断"方法论技能 (2026-07-10)

### 背景
老板提出新增混凝土质量管理技能的需求：能识别图片、向用户问诊、结合工作区 wiki 做原理分析、出处理建议和预防措施。

### 方案演进
经过 5 轮方案讨论，最终定型为**单一 md 格式 soft skill**：

1. ❌ 蓝图编排 + 方法论知识层（混合方案）→ 老板追问"md 不行吗"后放弃
2. ❌ 蓝图技能（过度设计）→ 蓝图是项目专门为配合比设计做的，张冠李戴
3. ✅ **md soft skill**（一个技能搞定）→ LLM 看到质量问题自动应用方法论

### 新增内容
- 文件：`C:\Users\sunys\.concrete-mixdesign\skills\quality_diagnose.md`（10.3KB / 311 行）
- 类别：custom
- 触发方式：soft（方法论注入 system prompt）

### 核心方法论
- **13 种缺陷分类**：A 组看图 5 种 + B 组综合推理 5 种 + C 组性能类 3 种
- **12 项通用项**：所有缺陷都收的"标配"信息
- **13 类专项项**：按缺陷类型动态加
- **问诊式对话**：一次一问、允许"不清楚"（B 引导回忆 + C 教用户查 + 跳过标注）
- **wiki 7 嵌入点**：看图后/收通用项时/粗判后/综合推理/根因分析/出处理建议/出预防措施
- **内部推理方法**：第一性原理分析（Step 6）+ 对抗式审查（Step 8），**不展示在报告中**
- **7 段报告 + 置信度**：信息完整度、缺陷概况、类型判断、根因分析、短期处理、长期预防、参考依据

### 关键设计决策
- 报告简洁专业，方法论严谨（过程严谨、呈现简洁）
- 保留置信度评分（高/中/低），让老板/客户判断诊断靠不靠谱
- 触发关键词：混凝土质量、缺陷诊断、问题分析、裂缝原因等
- 复用现有零件：analyze_concrete_image、ask_user、DynamicContextProvider

### 历史归档
- 旧 version_log.md（1129 行）已归档为 `version_log_20260710.md`

---

## v10.10.12 修复版本 (2026-07-10) - agent 流式大段输出导致渲染进程崩 → 白屏

### 背景
老板 2026-07-10 反馈：聊着聊着就白屏了，agent 正在大段输出，F12 进不去控制台。
（实际上生产模式默认 DevTools 是关的，按 F12 无反应是正常的；白屏是真实 bug。）

### 根因
- React 18.2 + `react-markdown` 在流式输出场景的经典 OOM 模式
- agent 每条 IPC delta（可能几 ms 一条）都会更新 `state.agent.replyText`
- `<ReactMarkdown>{agentReplyText}</ReactMarkdown>` 每次 props 变化都会**重新解析整个 markdown 字符串**
- 文本越长越慢，到几万字时 React 进入 reconcile 长任务 + `react-markdown` parser 占满主线程
- 极端情况渲染进程崩溃（render-process-gone）→ 白屏
- 影响两个组件：
  - [src/renderer/components/SmartDesignChat.jsx:186](src/renderer/components/SmartDesignChat.jsx#L186) MessageContent（消息列表里的主显示）
  - [src/renderer/components/StreamingAgentCard.jsx:517](src/renderer/components/StreamingAgentCard.jsx#L517) StreamingAgentCard（流式卡片）

### 修复
用 React 18 原生 `useDeferredValue` 把高频 IPC 更新自动降速，让 React 在空闲时再处理 markdown 解析：
- **SmartDesignChat.jsx:179** — `const deferredReplyText = useDeferredValue(agentReplyText)`
- **SmartDesignChat.jsx:189** — `<ReactMarkdown>{deferredReplyText || item.content}</ReactMarkdown>`
- **StreamingAgentCard.jsx:434** — `const deferredReplyText = useDeferredValue(agentReplyText)`
- **StreamingAgentCard.jsx:521** — `<ReactMarkdown>{deferredReplyText}</ReactMarkdown>`

### 为什么选 useDeferredValue 而不是 throttle / debounce
- React 18 官方 API，无需手写定时器
- 自动跟随渲染优先级，CPU 忙时自动让位
- 不破坏 streaming 体验（不像 debounce 会顿一下）
- 0 额外依赖、~5 行代码

### 版本号同步（CLAUDE.md 第 7 条）
- ✅ [package.json:3](package.json#L3) `version: 10.10.11` → `10.10.12`
- ✅ [package.json:74](package.json#L74) `output: dist-10.10.11` → `dist-10.10.12`
- ✅ [src/renderer/pages/WorkspacePage.jsx:152](src/renderer/pages/WorkspacePage.jsx#L152) 顶栏 `v10.10.11` → `v10.10.12`
- ✅ `main.js` BrowserWindow title 无版本号（无需改）
- ✅ `index.html` title "砼智" 无版本号（无需改）

### 验证
- `npx vite build` exit 0，3937 modules transformed，13.22s
- 无 JSX / hook 语法错误
- useDeferredValue 是 React 18.2 内置 API，已被 React 自身测试覆盖

### 边缘情况（已确认）
- `agentReplyText === ''` → deferred 也是 `''`，渲染空 markdown + 光标
- `agentReplyText === undefined` → fallback 到 `item.content`
- 流式结束（done 状态）→ deferred 立即追上最终值，显示完整文本
- 快速切换会话 → 组件卸载时 deferred 自动清理，无内存泄漏

### 后续可选优化（未做）
- 老板生产模式想看 DevTools 报错：把 [main.js:260-264](main.js#L260-L264) 的 dev-only 判断去掉（老板目前未要求，本次未改）
- 极端长 markdown（>10 万字）：加虚拟滚动 / 长度截断
- timeline 数组过大：StreamingAgentCard 当前每次 map 重渲染所有块，加 `React.memo` 可进一步优化

### 打包记录 (v10.10.12) (2026-07-10)
- 改 2 个文件 + 2 个版本号文件（package.json + WorkspacePage.jsx）
- 平台：win32 x64，Electron 28.3.3
- vite build exit 0，3937 modules，10.67s
- electron-builder 24.13.3，exit 0
- 产物：
  - `dist-10.10.12/砼智 Setup 10.10.12.exe`（NSIS 安装包，x64）
  - `dist-10.10.12/砼智-10.10.12-portable-x64.exe`（便携版，x64）
