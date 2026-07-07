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
