---
name: record_trial_test
description: 记录混凝土试配实测数据。当用户口述配合比参数和实测强度/坍落度/容重时，调用此技能录入试配记录。触发词："记录试配"、"试配记录"、"录入试配"
trigger_mode: soft
category: recording
version: 1.0.0
---

# record_trial_test

## 功能
将用户口述的配合比信息和实测值录入 TrialTestRecord 表，并自动计算与 XGBoost 预测值的偏差分析。

## 触发条件
用户在对话中提到以下关键词时自动触发：
- "记录试配"
- "试配记录"
- "录入试配"
- "保存试配"
- "新增试配"

## 执行流程

### 1. 解析用户输入
从用户自然语言描述中提取以下参数：

**必填参数：**
- `water_binder_ratio` (number): 水胶比
- `cement_amount` (number): 水泥用量 (kg/m³)
- `trialTestedStrength` (number): 实测 28d 强度 (MPa)
- `trialTestedSlump` (number): 实测坍落度 (mm)

**可选参数：**
- `fly_ash_dosage` (number): 粉煤灰掺量 (%)
- `slag_dosage` (number): 矿渣粉掺量 (%)
- `lithium_slag_dosage` (number): 锂渣掺量 (%)
- `composite_powder_dosage` (number): 复合粉掺量 (%)
- `sand_ratio` (number): 砂率 (%)
- `water_amount` (number): 用水量 (kg/m³)
- `superplasticizer_dosage` (number): 减水剂设计掺量 (%)
- `slump` (number): 设计坍落度 (mm)
- `trialTestedDensity` (number): 实测容重 (kg/m³)
- `trialTestedDosage` (number): 实测减水剂掺量 (%)
- `trialOperator` (string): 试配操作人员
- `trialNotes` (string): 备注

**批次关联（可选）：**
- `cementBatchId` (integer): 水泥批次ID
- `flyAshBatchId` (integer): 粉煤灰批次ID
- `slagBatchId` (integer): 矿渣粉批次ID
- `lithiumSlagBatchId` (integer): 锂渣批次ID
- `compositePowderBatchId` (integer): 复合粉批次ID
- `sandBatchId` (array): 砂批次ID数组
- `stoneBatchId` (array): 石批次ID数组
- `superplasticizerBatchId` (integer): 减水剂批次ID
- `mixDesignId` (integer): 关联配合比方案ID

### 2. 调用保存
通过 IPC 调用 `trialtest:create` 将数据保存到数据库。

### 3. 返回结果
向用户展示保存结果，包括：
- 试配记录ID
- 自动计算的偏差分析结果（如有）：
  - 强度预测值与实测值偏差
  - 坍落度偏差
  - 容重偏差
- 确认保存成功

## 示例对话

用户："记录试配，水胶比0.45，水泥360，粉煤灰掺量20%，实测强度42.5，坍落度185"

系统：自动识别参数 → 调用 trialtest:create → 返回保存结果 + 偏差分析
