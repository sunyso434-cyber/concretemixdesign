## v10.8.0 功能版本 (2026-07-08) - Todo 计划实时面板：用户能"看见" LLM 在想什么

### 背景
老板反馈："项目中的 todo 技能用户完全看不到 LLM 计划了什么，只看到 todo 在跑，用户看不见计划的进度，也看不到具体什么计划。"

后端 `todo_manage` Skill（v9.1.0）实现完整（6 种 action + 内存存储 + 会话隔离），但**前端零组件**。LLM 调 `todo_manage` 时，结果只回到 LLM 自己，前端用户只能从 LLM 流式文本里猜，体验差。

### 方案
最小改动 6 个文件（0 兼容代码）：
- **后端推送**：`todo-manage.js` 在 5 个写操作（create/add/update/complete/clear）完成后，通过 `context.webContents.send('todo:updated', { sessionId, todos, total, completed })` 推事件。`list` 只读不推。
- **IPC 兜底**：[`src/main/ipcHandlers/agentHandler.js`](src/main/ipcHandlers/agentHandler.js) 新增 `ipcMain.handle('todo:list', ...)`，复用 skill 的 list action。
- **preload 暴露**：[`src/main/preload.js`](src/main/preload.js) 新增 `electronAPI.todo.{list, onUpdate, removeUpdateListener}`。
- **TodoPanel 组件**：[`src/renderer/components/TodoPanel.jsx`](src/renderer/components/TodoPanel.jsx) 新建：进度条 + 列表（完成打勾、进行中蓝高亮、待办灰着）+ 优先级 Tag（高/中/低）。
- **集成聊天页**：[`src/renderer/components/SmartDesignChat.jsx`](src/renderer/components/SmartDesignChat.jsx) 在 `StreamingAgentCard` 上方挂 `<TodoPanel sessionId={state.session.currentId} />`，仅对正在 streaming 的消息挂载。

### 端到端数据流
```
LLM 调 todo_manage
  → todo-manage.execute() 修改 _sessionTodos
  → _notifyTodoUpdate(context, sessionId, todos) 推 todo:updated
  → preload 的 todo.onUpdate 回调
  → TodoPanel setTodos → 重渲染
  → 用户看到面板（进度条 + 列表 + 状态可视化）
```

兜底（页面刷新 / 重新挂载）：
```
TodoPanel mount → todo.list(sessionId) → IPC todo:list → 复用 skill list action 返回清单
```

### 关键设计
- **空态不渲染**：`todos.length === 0` 时返回 `null`（不显示空面板）
- **sessionId 过滤**：前端收到事件后按 `payload.sessionId === props.sessionId` 过滤，忽略其他 session 的事件
- **静默容错**：后端 `webContents` 不存在/已销毁/`send` 抛错 — 全部 catch 吞掉，不影响 skill 主流程
- **折叠态**：标题栏始终可见，列表可点折叠，折叠后只剩 `📋 LLM 计划 (2/5) + 进度条`
- **priority 中文标签**：high/medium/low 渲染为 高/中/低，颜色 red/orange/default

### 改动文件
| 文件 | 改动 |
|---|---|
| [`src/main/skills/todo-manage.js`](src/main/skills/todo-manage.js) | 加 `_notifyTodoUpdate` 工具函数 + 5 处写操作插入推送调用 |
| [`src/main/ipcHandlers/agentHandler.js`](src/main/ipcHandlers/agentHandler.js) | 新增 IPC `todo:list`（兜底查询） |
| [`src/main/preload.js`](src/main/preload.js) | 暴露 `todo.list` / `todo.onUpdate` / `todo.removeUpdateListener` |
| [`src/renderer/components/TodoPanel.jsx`](src/renderer/components/TodoPanel.jsx) | 新建（约 160 行） |
| [`src/renderer/components/SmartDesignChat.jsx`](src/renderer/components/SmartDesignChat.jsx) | import + 1 行 JSX 挂载 |
| [`src/main/__tests__/skills/todo-manage.test.js`](src/main/__tests__/skills/todo-manage.test.js) | 新增 9 个推送事件测试 |
| [`tests/todoPanelSubscription.test.js`](tests/todoPanelSubscription.test.js) | 新建 8 个数据流合约测试（无 jsdom 也能跑） |

### 测试
- ✅ `todo-manage.test.js` 42/42 全绿（33 旧 + 9 新推送测试）
- ✅ `todoPanelSubscription.test.js` 8/8 全绿（mount 拉取 / sessionId 过滤 / unmount 注销 / payload 形状 / 多次更新 / 失败容错）
- ✅ 相关模块回归（agentHandler / errorCodes / errorClassifier）72/73 全绿（1 个 `abortBehavior` 测试是 pre-existing 失败，与本次改动无关，git stash 验证过）

### 边缘情况覆盖
- LLM 没调 todo_manage → 面板不渲染
- LLM 调 create 后立刻 complete 全部 → 进度条 100%，列表全打勾
- LLM 调 clear → 面板消失
- 用户切会话 → 新 sessionId 重新拉清单
- 用户刷新页面 → mount 时 `todo.list` 拉兜底数据
- webContents 已销毁（关闭中）→ 推送静默跳过
- IPC 通道断 → catch 吞掉，不影响 skill 返回
- 事件 payload.sessionId 不匹配 → 前端忽略
- 同一 session 多次 update → 事件按顺序覆盖（最新事件赢）

### 设计文档
- spec：[`docs/superpowers/specs/2026-07-08-todo-panel-design.md`](docs/superpowers/specs/2026-07-08-todo-panel-design.md)
- plan：[`docs/superpowers/plans/2026-07-08-todo-panel-plan.md`](docs/superpowers/plans/2026-07-08-todo-panel-plan.md)

### 版本号同步（按 CLAUDE.md 规则 7）
- ✅ `package.json` version: 10.7.9 → 10.8.0
- ✅ `package.json` build.output: `dist-10.7.9` → `dist-10.8.0`
- ✅ [`src/renderer/pages/WorkspacePage.jsx:152`](src/renderer/pages/WorkspacePage.jsx#L152) `topbar-version`: v10.7.9 → v10.8.0
- ⚠️ main.js BrowserWindow 没显式 setTitle（依赖 package.json `productName` = "砼智"），无需改
- ⚠️ `index.html` `<title>` 写死"砼智"（无版本号），无需改
- ✅ grep 复查 10.7.9 在源码区已无匹配（仅剩测试文件里引用历史场景的注释，不应改）

### 打包
本次已 `npm run electron:build` 打包完成：
- 输出目录：`dist-10.8.0/`
- `dist-10.8.0/砼智 Setup 10.8.0.exe` — NSIS 安装版（**140M**，约 145.9MB → 140M，比 v10.7.9 略小）
- `dist-10.8.0/砼智-10.8.0-portable-x64.exe` — Portable 免安装版（**139M**）
- `dist-10.8.0/win-unpacked/` — 免安装解压目录

vite 打包提示：WorkspacePage 拆出独立 chunk 后（`WorkspacePage-CNNmkUzL.js 2,322.17 kB`）仍超过 500kB 警告阈值，是 echart/sequelize/sqlite3/xlsx 等重依赖的固有体积，不影响功能。后续如需优化可走 dynamic import 拆 SettingsPage 内的子页面（待老板指示）。

---

## v10.7.9 修复版本 (2026-07-08) - 减水剂掺量 fmAdjustment 不应叠加 strengthDosage 梯度

### 背景
老板反馈：v10.7.8 实测 C30/C40/C50/C60 配合比，finalDosage 梯度是 0.4%/10 强度（不是 0.2%）。

老板追问："目标细度模数只用来计算砂的比例；计算砂的外加剂影响用的实际细度模数哦"

### 根因
[`src/main/services/MixDesignService/MixDesignService_Aggregate.js:360`](src/main/services/MixDesignService/MixDesignService_Aggregate.js#L360) v10.7.7 把 `baseFinenessModulus` 写成了 `targetFinenessModulus`：

```js
const baseFinenessModulus = targetFinenessModulus  // ← BUG
```

`targetFinenessModulus` 是**强度等级的目标**（C30=2.8, C40=3.0, C50=3.0, C60=3.2）。
`fmAdjustment = (targetFM - 砂 FM) × 系数`，所以跨档（C30→C40）时 fmAdjustment 跟着台阶式变化：

| 等级 | targetFM | 砂FM=2.81 | fmAdjustment |
|:---:|:---:|:---:|:---:|
| C30 | 2.8 | 2.81 | -0.01 |
| C40 | 3.0 | 2.81 | +0.19 |
| C50 | 3.0 | 2.81 | +0.19 |
| C60 | 3.2 | 2.81 | +0.39 |

跟 strengthDosage 的 0.2%/10 强度**叠加**，导致 finalDosage 梯度 = 0.4%/10 强度。

### 老板语义（正确）
- `targetFinenessModulus` → 用来计算砂的**比例**（`calculateOptimalFineAggregateRatio`）
- 外加剂掺量的微调基准 → 应该是用户配置的 `targetFinenessModulusBase`（默认 2.7），跟 [`MixDesignService_Database.js:160-162`](src/main/services/MixDesignService/MixDesignService_Database.js#L160) 里的 `baseFm` 一致

### 改动（最小 1 行 + 注释）
[`MixDesignService_Aggregate.js:355-374`](src/main/services/MixDesignService/MixDesignService_Aggregate.js#L355)：

```js
// 修复（v10.7.9）：用 tempSettings.targetFinenessModulusBase（默认 2.7）当基准
const baseFinenessModulus = parseFloat(tempSettings?.targetFinenessModulusBase) || 2.7
```

### 修复后行为

| 等级 | strengthDosage | fmAdjustment（基准 2.7） | finalDosage | 差 |
|:---:|:---:|:---:|:---:|:---:|
| C30 | 2.0% | (2.7-2.81)/0.1 × 0.1 = -0.11 | 1.89 | — |
| C40 | 2.2% | -0.11（不变） | 2.09 | +0.20 ✓ |
| C50 | 2.4% | -0.11 | 2.29 | +0.20 ✓ |
| C60 | 2.6% | -0.11 | 2.49 | +0.20 ✓ |

**finalDosage 梯度 = 0.2%/10 强度**，跟 strengthDosage 梯度一致，符合 v10.7.7 设计意图。

### 验证
- ✅ `superplasticizerDosage.test.js` 27/27 全绿（24 旧 + 3 新）
  - 场景 F：各级 strengthDosage 差 0.2%/5强度
  - 场景 G：fmAdjustment 不跨强度变化（核心 bug 验证）
  - 场景 H：用户显式覆盖 base=2.8 → fmAdjustment 相应改变
- ✅ `MixDesignOptimizer/MixDesignService_Database_Override/MixDesignService_Aggregate_Cement` 全套 62/62 全绿
- ✅ `verify-superplasticizer-rule-v2.js` 端到端 24/24 通过

### 不破坏的部分
- `targetFinenessModulus` 仍用于砂配比计算（`calculateOptimalFineAggregateRatio`）
- 减水率公式仍用 `strengthDosage`（不受 fmAdjustment 影响，v10.7.7 已设计）
- 用户显式覆盖 `targetFinenessModulusBase` 仍生效（场景 H 验证）

### commit
- `511bd1d` fix(aggregate): fmAdjustment 基准用 targetFinenessModulusBase（不叠加 strengthDosage 梯度）

### 打包结果（2026-07-08）
- 打包时间：vite 10.86s + electron-builder ~3min，全过程 exit 0
- 输出目录：`dist-10.7.9/`
- 产物：
  - `dist-10.7.9/砼智 Setup 10.7.9.exe` — NSIS 安装版（**145.9 MB**）
  - `dist-10.7.9/砼智-10.7.9-portable-x64.exe` — Portable 免安装版（**145.5 MB**）
  - `dist-10.7.9/win-unpacked/` — 免安装解压目录

---

## v10.7.8 修复版本 (2026-07-08) - JGJ55 skill 清空单点掺量走派生（v10.7.7 半截同步兜底）

### 背景
v10.7.7 改 schema/DEFAULTS 让单点掺量"不填走派生"，**但写入路径没改**——老板 DB 里有历史单点覆盖值（`superplasticizerDosage_C40 = 2.9`，锂渣专用外加剂时代遗留），AI 想清空走派生时三个错误路径全死（详见下方"故障链"）。

### 故障链（chat_history ID 1673~1681 反查）
1. ❌ `update_jgj55_param(value=null)` → `PARAM_MISSING`（value 必填）
2. ❌ `batch_update_jgj55_params(params=...)` → `PARAM_MISSING`（参数名错了，是 `updates` 不是 `params`）
3. ❌ `batch_update_jgj55_params(updates=[{value:""}])` → `OUT_OF_RANGE`（空串 coerce 成 0，违反 min=1）
- 3 次失败，AI 没退路，会话停了，bug 留在 DB 里至今

### 根因
JGJ55 skill 的"读"语义改了（schema 描述"不填=派生"），**"写"路径没动**——`validateValue` 不接受 null/空串，`update_jgj55_param` 的 `value` 仍 `required: true`。

### 改动（最小）
1. **`validateValue`**（`src/main/skills/jgj55-params.js` 60-71 行）：加 null/空串/未定义分支 → 返回 `{ ok: true, value: null }`（语义：清空）
2. **`update_jgj55_param`**：去掉 `required: ['name','value']`，改为 `required: ['name']`；value 允许 null；execute 中 value===null 走 `deleteParam` 而非 `setParam`（避免 `String(null)="null"` 写进 DB）
3. **新增 `clear_jgj55_param(name)` skill**：专门清单个参数走默认/派生
4. **`batch_update_jgj55_params`**：复用新 validateValue，value===null 走 deleteParam
5. **配套测试**（`src/main/__tests__/skills/jgj55-params.test.js`）：8 个新 case 覆盖所有清空路径

### 验证
- ✅ `jgj55-params.test.js` 18/18 全绿（10 个原有 + 8 个新）
- ✅ `verify-superplasticizer-rule-v2.js` 端到端 24/24 通过
- ✅ git stash 验证：18 个 pre-existing 失败（workspace/LearningService/WikiEngine/snapshot）和本修复无关

### 现场清理（老板手动）
新装的 v10.7.8 后，老板可以选一种方式清掉历史脏数据 `superplasticizerDosage_C40 = 2.9`：
1. **app 内**："系统设置 → JGJ55 参数 → 减水剂掺量 — C40" 清空它
2. **调新 skill**：AI 助理调 `clear_jgj55_param({name: "superplasticizerDosage_C40"})`
3. **DB 直清**：`DELETE FROM systemParams WHERE paramName='superplasticizerDosage_C40';`

清掉后 C40 派生 = 2.0 + (40-30)/5×0.1 = **2.2%**（不再 2.79%）

### 不破坏的部分
- 原有 5 件套 skill 完全兼容（schema 描述更新、`value` 仍接受数字）
- v10.7.7 的"单点 > 派生"优先级逻辑不变
- 端到端 24 个 case 全部通过

### commit
- `b74b75f` fix(jgj55-skill): 支持清空单点掺量走默认/派生（v10.7.7 半截同步兜底）

### 打包结果（2026-07-08）
- 打包时间：vite 10.82s + electron-builder ~3min，全过程 exit 0
- 输出目录：`dist-10.7.8/`
- 产物：
  - `dist-10.7.8/砼智 Setup 10.7.8.exe` — NSIS 安装版（**145.9 MB**）
  - `dist-10.7.8/砼智-10.7.8-portable-x64.exe` — Portable 免安装版（**145.5 MB**）
  - `dist-10.7.8/win-unpacked/` — 免安装解压目录
- 平台：Windows x64（NSIS + portable）
- Node/Electron：electron@28.3.3
- electron-builder：24.13.3

---

## v10.7.7 (2026-07-08) - 减水剂掺量新规则（基准+派生） + 标题栏版本号同步

### 打包结果（2026-07-08）
- 打包时间：v11.24s（vite build） + ~3min（electron-builder）
- 输出目录：`dist-10.7.7/`
- 产物：
  - `dist-10.7.7/砼智 Setup 10.7.7.exe` — NSIS 安装版（**140 MB**）
  - `dist-10.7.7/砼智-10.7.7-portable-x64.exe` — Portable 免安装版（**139 MB**）
  - `dist-10.7.7/win-unpacked/` — 免安装解压目录
- 平台：Windows x64（NSIS + portable）
- Node/Electron：electron@28.3.3
- electron-builder：24.13.3

### 标题栏版本号同步（老板 2026-07-08 强调）
- 修复点：[`src/renderer/pages/WorkspacePage.jsx:152`](src/renderer/pages/WorkspacePage.jsx#L152) `topbar-version` 写死 v9.0.0（落后多个版本）→ 改 v10.7.7
- 同步加进 CLAUDE.md 第 7 条规则（"版本号同步"）
- 扫描确认：HTML title 标签和 BrowserWindow title 都没有版本号硬编码（HTML title 是"砼智"纯文字，BrowserWindow 用 `titleBarStyle: 'hidden'` 走自定义 topbar），所以只改这一处
- 其他 v\d+\.\d+\.\d+ 匹配项均为代码注释中的历史版本号，不影响用户

### 老板 2026-07-08 决策

### 老板 2026-07-08 决策
替换旧规则（每个强度等级独立硬编码默认值 1.6%-2.2%）。新规则核心：

- **C30 基准掺量** = 减水剂材料 `recommendedDosage`（兜底 1.8%）
- **等级掺量**：用户单点指定 > 从 C30 基准派生（±0.1%/5强度）
- **减水率公式**：`waterReducingRate + (strengthDosage - 材料推荐) / 0.1 × waterReducingRatePer01Dosage`
- **砂石 MB/细度模数 微调产生的掺量变化不影响减水率**（老板规则）
- **没选减水剂材料** → 掺量=0, 减水率=0, 用水量不修正

### 三个独立概念（不要混）
| 概念 | 来源 | 作用 |
|------|------|------|
| 材料推荐掺量 | `Material.recommendedDosage` | 减水率公式的"基准"（厂家标定） |
| C30 基准掺量 | 优先级: 用户覆盖 > 材料推荐 > 1.8% 兜底 | 决定 C20-C50 派生 |
| 各等级使用掺量 | 用户单点 > C30 基准 / 派生公式 | 配合比实际用 |

### 涉及 8 个文件改动
1. `src/main/services/MixDesignService/MixDesignService_WaterRatio.js` — 新增 `getC30Baseline`，重写 `getSuperplasticizerDosageByStrength` 透传材料
2. `src/main/services/MixDesignService/MixDesignService_Aggregate.js` — 透传材料 + 没选材料短路 + 减水率公式改用 `strengthDosage`（不含砂石微调）
3. `src/main/services/MixDesignService/MixDesignService_Database.js` — 主流程透传 + 没选材料时减水率=0
4. `src/main/services/MixDesignService/index.js` — facade 透传
5. `src/main/services/MixDesignOptimizer.js` — 阶段 2-4 透传 `defaultSp`
6. `src/main/services/SystemService.js` — 默认种子表更新（删 6 个加 1 个基准）
7. `src/main/skills/jgj55-params.js` — schema + DEFAULTS 同步
8. `src/renderer/config/paramConfig.js` — UI 标签区分基准/单点/派生
9. `src/renderer/main.jsx` — 浏览器复刻版同步

### 新增 3 个文件
- `src/main/services/MixDesignService/__tests__/superplasticizerDosage.test.js` — 24 个单元测试
- `tests/manual/verify-superplasticizer-rule-v2.js` — 端到端验证脚本（6 个真实场景，24 个断言）
- `docs/superpowers/specs/2026-07-08-superplasticizer-dosage-rule-v2.md` — 新规则说明

### 同步更新的 spec/plan
- `docs/superpowers/specs/2026-07-04-jgj55-skill-and-settings-cleanup-spec.md` — 参数表 + DEFAULTS
- `docs/superpowers/specs/2026-07-04-cost-optimizer-v2-design.md` — 函数签名
- `docs/superpowers/plans/2026-05-08-code-structure-refactor-implementation.md` — API 表

### 验证
- ✅ 单元测试 24/24 通过
- ✅ 端到端验证 24/24 通过
- ✅ 现有 MixDesignService 测试 63/63 通过（无破坏）

### 行为变化（破坏性）
- 调 C30 基准过去只影响 C30 → 现在影响**全部派生等级**（C20-C50）
- 减水率公式用 `strengthDosage`（不含砂石微调），不再用 `finalDosage`
- 没选减水剂材料 → 整步骤短路（掺量=0, 减水率=0）
- 函数签名变更：`getSuperplasticizerDosageByStrength(strength, superplasticizerMaterial, tempSettings)`、`calculateSuperplasticizerDosage(strength, fineAggregateMaterial, superplasticizerMaterial, tempSettings)` 等

### 不破坏的部分
- 已存在 DB 里的存量用户掺量值仍然生效（向后兼容）
- `Material.waterReducingRatePer01Dosage` 字段已存在（默认 2.0），新规则直接用

### commit
- `73f5221` feat(配合比): 减水剂掺量新规则（基准+派生）

---



### 老板二次反馈打脸（v10.7.6 第一版修复失效）
老板反映："我装了 v10.7.6，仍然给我加入锂渣 20%。" 立刻 grep 验证主流程：

- `_firstLayerFilter` 在 [MixDesignOptimizer.js:750](src/main/services/MixDesignOptimizer.js#L750) **没人调用**——孤儿函数
- 真正的 task 生成在 [_stage2Filter @ 677-698](src/main/services/MixDesignOptimizer.js#L677-L698) — **同样的 bug 没修！**
- 主流程：`optimizeMixDesign` → `_stage2Filter` → `_stage3Refine` → ...

### v10.7.6 第二版修复
- [_stage2Filter @ 685 后](src/main/services/MixDesignOptimizer.js#L685-L691) 加同样的过滤：
  ```js
  if ((flyAsh > 0 && !flyAshMat) ||
      (slag > 0 && !slagMat) ||
      (lithiumSlag > 0 && !lithiumSlagMat) ||
      (compositePowder > 0 && !compositePowderMat)) continue
  ```
- 同步给 [_firstLayerFilter](src/main/services/MixDesignOptimizer.js#L813-L820) 加同样过滤（孤儿函数也修，避免未来调用者踩同样的雷）
- 测试 [MixDesignOptimizer_EmptyAdmixture.test.js](src/main/__tests__/services/MixDesignOptimizer_EmptyAdmixture.test.js) 新增 _stage2Filter 用例（覆盖主流程入口），原有 2 个用例仍有效
- **services + skills 全套 270/270 全绿**
- 老板之前看到的 workspace/LearningService 失败是**预存的，与本修复无关**（已通过 git stash 在 master 上复现确认）

### 这次的反思
- **测试要在主流程入口写，而不是在孤儿函数上**：_firstLayerFilter 没被调用，写 100 个测试也救不了 v10.7.6 第一版老板看到的现场
- **patch 之前先 grep 验证函数是否被调用**——一句话就能避免这种"patch 在错地方"的事故

### 打包
- `dist-10.7.6/砼智 Setup 10.7.6.exe` — NSIS 安装版
- `dist-10.7.6/砼智-10.7.6-portable-x64.exe` — 便携版
- 打包耗时：vite 13.40s + electron-builder ~5min，全程 exit 0

---

## v10.7.6 修复版本 (2026-07-07) - 空掺合料"幽灵用量" bug（老板实测反馈）+ JGJ55 减水剂上限扩大

### 打包
- `dist-10.7.6/砼智 Setup 10.7.6.exe` — NSIS 安装版（145.9 MB）
- `dist-10.7.6/砼智-10.7.6-portable-x64.exe` — 便携版（145.5 MB）
- 打包耗时：vite 11.81s + electron-builder ~5min，全过程 exit 0
- commit 信息：`chore: 升版 v10.7.6（JGJ55 减水剂上限扩大 + 空掺合料幽灵用量 bug 修复）`

---

## v10.7.6 修复版本 (2026-07-07) - 空掺合料"幽灵用量" bug（老板实测反馈）

### 背景
老板调 `optimize_mix_cost`，**没传 `lithiumSlagIds`**（甚至显式传 `[]`），但 `bestSolution.materials.lithiumSlag` 仍产出 50.14 kg 锂渣。AI 在对话里**诚实**地说"我没传"，**老板最初怀疑 AI 撒谎**。

### 真假验证（用老板真实 DB 反查 tool_calls）
去 `C:/Users/sunys/AppData/Roaming/concrete-mixdesign/concrete-mixdesign.db` 的 `chat_history.toolCalls` JSON 列反查 `session-1783427576610-n01o`：

| AI 实际传的 `lithiumSlagIds` | 结果 lithiumSlag (kg) |
|------------------------------|----------------------|
| `[84]` | 50.14（理应） |
| **无字段** | **50.14** ⚠️ |
| **`[]`**（显式空数组） | **50.14** ⚠️⚠️ |

**AI 没撒谎**，是 skill/optimizer 的代码 bug。

### 根因（双层漏洞叠加）
1. **[src/main/services/MixDesignOptimizer.js:807-815](src/main/services/MixDesignOptimizer.js#L807-L815)** 任务生成循环 `_firstLayerFilter`：
   - `_getMaterialList([])` 返回 `[null]`（设计上 material 空时标 null）
   - 但内层掺量循环 `for (const lithiumSlag of _lr)` 仍然枚举 [0, 5, 10, 15, 20]
   - **`(mat===null && dosage>0)` 的组合照样被 push 进 tasks**

2. **[src/main/services/MixDesignService/MixDesignService_Database.js:391](src/main/services/MixDesignService/MixDesignService_Database.js#L391)** 用量计算：
   ```js
   lithiumSlag: cementitiousAmount * lithiumSlagPercentage,
   ```
   只用掺量百分比，**完全不校验 `materials.lithiumSlag` 是否为有效对象**——所以 null 材料 + 5% 掺量，照样算出非 0 kg。

### 修复（最小改动）
在 [src/main/services/MixDesignOptimizer.js:813-820](src/main/services/MixDesignOptimizer.js#L813-L820) 加一行过滤：

```js
// 修复（v10.7.6）：掺合料材料为 null 但掺量 > 0 时跳过该任务
if ((flyAsh > 0 && !flyAshMat) ||
    (slag > 0 && !slagMat) ||
    (lithiumSlag > 0 && !lithiumSlagMat) ||
    (compositePowder > 0 && !compositePowderMat)) continue
```

**为什么修在 task 生成层而非 calculator 层**：
- 一处修复覆盖 4 类掺合料
- 跳过的是 task 而不是污染结果——不浪费下游计算
- 数据库侧不需动（其业务逻辑"只按掺量算用量"是合理的，null 检查应该发生在 optimizer 边界）

### 验证
- **新增 [src/main/__tests__/services/MixDesignOptimizer_EmptyAdmixture.test.js](src/main/__tests__/services/MixDesignOptimizer_EmptyAdmixture.test.js)**：
  - 测试 1：未传 lithiumSlag 时，bestSolution 不应含 lithiumSlag > 0 — 修复前**红灯**（40.37kg 污染），修复后**绿灯**
  - 测试 2：未传 flyAsh/slag 时同理 — 覆盖同一修复路径
- **回归**：services + skills 全套 **269/269 全绿**，43 个 test suite，2 snapshots

### 老板的反思教训（已加入我的不再犯计划）
1. 后续再遇到"AI 说 vs 代码做"冲突时，**先去 DB 反查 `chat_history.toolCalls`** —— AI 的"我没做"自陈**永远不能当事实依据**
2. task generation 层是**最容易漏校验的"边界"**——所有从用户输入/DB 查询映射到内部数据结构的地方，都要问"什么是空？"而不是假设有值

---

## v10.7.5 调整版本 (2026-07-07) - JGJ55 减水剂掺量上限扩大 2.5% → 5.0%

### 背景
老板反馈：系统设置中 JGJ55 标准限制了各等级混凝土减水剂推荐掺量的上下限（1.0-2.5%），范围过小，无法满足高减水率场景。

### 变更内容
**仅扩大上限，不动下限和默认值**（不破坏存量数据）：

| 文件 | 项 | 变更 |
|------|-----|------|
| `src/renderer/config/paramConfig.js` | `superplasticizerDosage_C20` ~ `C50`（7 项） | `max: 2.5` → `max: 5.0` |
| `src/main/skills/jgj55-params.js` | `JGJ55_SCHEMA.superplasticizerDosage_C20` ~ `C50`（7 项） | `max: 2.5` → `max: 5.0` |

### 为什么改两个文件
- `paramConfig.js` 是 ESM，前端渲染设置页面用
- `jgj55-params.js` 是 CommonJS 内联副本，agent skill 校验参数范围用
- 两份独立维护，必须同步改：否则前端能拖到 5%，AI 校验那边会被 OUT_OF_RANGE 打回

### 不动的部分
- 默认值 1.6-2.2% 保持不变
- `waterReducingRatePer01Dosage` 范围 0.5-2.5% 不动（独立参数，与掺量上限无直接联动）
- 已存储在 DB 里的存量用户值不被覆盖（`setParam` 只在用户主动拖动时写）

### 验证
- 两个文件中所有 7 项（C20-C50）均 `min: 1.0, max: 5.0, step: 0.1` ✓
- `waterReducingRatePer01Dosage` 仍是 `max: 2.5`（未被误改）✓
- `jgj55-params.test.js` 仅按参数名查 schema，不依赖具体范围值，无需更新

### 历史归档
本文件因超过 1000 行（已达 7445 行），按 CLAUDE.md 第 5 条规则归档旧日志为 `version_log_20260707.md`。

---
