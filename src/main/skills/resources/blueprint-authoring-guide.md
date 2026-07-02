# 蓝图技能创作规范（Blueprint Authoring Guide）

本文档给 LLM 阅读，用于在同一对话内生成"蓝图技能包"（meta.yaml + blueprint.yaml + tables/*.json）。

> **调用协议**：当用户明确表达要"创建/新建一个蓝图（blueprint）技能"时，你应当先阅读本指南，再基于当前对话上下文（规范、材料、约束）一次性生成完整蓝图，最后调用 `create_skill(format='blueprint', rawBlueprint='...')` 落盘。

---

## 一、总体输出格式

**必须**按下列分段格式输出完整蓝图。段与段之间以 `=== <文件名> ===` 分隔。除分段头和文件内容外，**不得输出任何解释文字、Markdown 代码围栏、闲聊**。

```
=== meta.yaml ===
<YAML 内容>
=== blueprint.yaml ===
<YAML 内容>
=== tables/<表名>.json ===
<JSON 内容>
```

- 至少要有 `meta.yaml` 和 `blueprint.yaml` 两段
- `tables/*.json` 段按需附加，可以有 0 到多个
- 生成完成后，把上述整段作为 `rawBlueprint` 参数传给 `create_skill`

---

## 二、meta.yaml 结构

```yaml
name: "自密实混凝土配合比设计"        # 中文名，向用户展示
description: "按 JGJ/T 283-2012 设计自密实混凝土配合比"
version: "1.0.0"
concrete_type: "self_compacting"       # normal | self_compacting | permeable | lightweight | high_strength ...
author: "用户创建"
created_at: "2026-07-02"
parameters:
  - name: strength_grade                # 变量名，英文/下划线
    label: "强度等级"                  # 中文标签，向用户展示
    type: select                        # string | number | select
    required: true
    options: ["C30", "C35", "C40", "C45", "C50"]
  - name: slump_flow_grade
    label: "扩展度等级"
    type: select
    required: true
    options: ["SF1", "SF2", "SF3"]
    default: "SF2"
  - name: slump
    label: "坍落度(mm)"
    type: number
    required: false
    min: 500
    max: 850
    default: 700
```

**规则**：
- `parameters[].name` 与 blueprint.yaml 中 `input.from` 一一对应
- `type: select` 时必须给 `options`
- 尽量给合理的 `default`，用于试算

---

## 三、blueprint.yaml 结构

```yaml
steps:
  - type: input
    var: fcu_k
    from: "strength_grade"
    value_map: { C30: 30, C35: 35, C40: 40, C45: 45, C50: 50 }
    default: 30
  # ... 其他步骤
```

- 顶层只有 `steps` 数组
- 每个步骤是一个操作对象，仅允许下列 7 种类型之一

---

## 四、7 种原子操作（严格限定）

### 1. `input` — 从用户参数读值

```yaml
- type: input
  var: fcu_k              # 结果变量名
  from: "strength_grade"  # 对应 meta.parameters 的 name
  value_map:              # 可选，将字符串枚举映射为数字
    C30: 30
    C35: 35
  default: 30             # 可选，参数缺失时的兜底值
```

### 2. `const` — 固定常数

```yaml
- type: const
  var: alpha_a
  value: 0.53
```

### 3. `material` — 从原材料库读取材料属性

```yaml
- type: material
  var: cement_strength
  material_query:
    category: "水泥"                    # 见下表白名单
    property: "compressiveStrength28d"  # 见下表字段白名单
    # requirements: [...]              # 可选过滤条件（数组）
```

**category 白名单**（**只允许这 8 个中文字符串**）：
- `水泥`
- `细骨料`
- `粗骨料`
- `粉煤灰`
- `矿渣粉`
- `锂渣`
- `复合粉`
- `减水剂`

**property 白名单**（按 category 分组，只允许下列字段）：

| category | 允许的 property |
|----------|-----------------|
| 水泥 | density, fineness, waterContent, specificSurfaceArea, stability, initialSettingTime, finalSettingTime, flexuralStrength3d, flexuralStrength28d, compressiveStrength3d, compressiveStrength28d, cementHeat3d, cementHeat7d, specification, manufacturer |
| 细骨料 | specification, manufacturer, density, mudContent, mbValue, sieve_4_75, sieve_2_36, sieve_1_18, sieve_0_60, sieve_0_30, sieve_0_15, finenessModulus |
| 粗骨料 | specification, manufacturer, density, mudContent, crushingValue, needleFlakeContent, sieve_37_5, sieve_31_5, sieve_26_5, sieve_19_0, sieve_16_0, sieve_9_50, sieve_4_75, sieve_2_36, grading |
| 粉煤灰 | specification, manufacturer, density, fineness, lossOnIgnition, waterDemandRatio, activityIndex28d, influenceFactor_10~50, cementitiousFactor_10~50 |
| 矿渣粉 | specification, manufacturer, density, specificSurfaceArea, lossOnIgnition, fluidityRatio, activityIndex7d, activityIndex28d, influenceFactor_10~50, cementitiousFactor_10~50 |
| 锂渣 | specification, manufacturer, density, specificSurfaceArea, lossOnIgnition, waterDemandRatio, activityIndex28d, influenceFactor_10~50, cementitiousFactor_10~50 |
| 复合粉 | specification, manufacturer, density, specificSurfaceArea, lossOnIgnition, fluidityRatio, activityIndex7d, activityIndex28d, influenceFactor_10~50, cementitiousFactor_10~50 |
| 减水剂 | specification, manufacturer, recommendedDosage, density, waterReducingRate, solidContent |

**硬约束**：
- **禁止**在 `material_query` 里写 `name` 字段（材料 ID/name 由运行时填入）
- `category` 和 `property` 都是**大小写敏感的完全匹配**

### 4. `formula` — 数学表达式

```yaml
- type: formula
  var: wb_raw
  expr: "(alpha_a * fb) / (fcu_o + alpha_a * 0.20 * fb)"
```

**允许的运算符**：`+ - * / **`
**允许的函数**：`round`, `max`, `min`, `sqrt`, `abs`
**其他标识符**必须是**已在前面步骤中定义过的变量**。

⚠️⚠️ **硬约束（最容易犯错的一条）**：
> **`formula.var` 绝对不能出现在 `expr` 中**，即**禁止自引用**。
> 如需在已有变量基础上"迭代/微调"，请使用**新变量名**。

**错误示范**（会导致校验失败）：
```yaml
# ❌ 错误：var=wb 出现在 expr 里
- type: formula
  var: wb
  expr: "min(wb, 0.45)"
```

**正确示范**（用多阶段变量命名）：
```yaml
- type: formula
  var: wb_raw          # 第一阶段：鲍罗米原始计算
  expr: "(0.53 * fb) / (fcu_o + 0.53 * 0.20 * fb)"
- type: formula
  var: wb_capped       # 第二阶段：规范上限约束
  expr: "min(wb_raw, 0.45)"
- type: formula
  var: wb_final        # 第三阶段：向下取整到 0.01
  expr: "round(wb_capped * 100) / 100"
- type: output
  var: wb_final
  name: "水胶比"
  precision: 3
```

**推荐命名后缀**：
- `_raw`：初算结果
- `_capped` / `_bounded`：加上下限约束后
- `_adjusted`：按等级或条件调整后
- `_final`：最终输出值

### 5. `table_lookup` — 查表并插值

```yaml
- type: table_lookup
  var: base_water
  table: "slump_water_table"          # 与 tables/xxx.json 的 name 字段一致
  lookup_mode: "bilinear"              # linear | bilinear | nearest
  keys:
    slump: "$slump"                    # $ 前缀引用变量
    max_agg_size: "$max_agg_size"
```

### 6. `if_else` — 条件分支

```yaml
- type: if_else
  var: fly_ash_factor              # 分支执行后要写入的变量
  condition: "strength_grade_num >= 50"
  then:
    - type: const
      var: fly_ash_factor
      value: 0.30
  else:
    - type: const
      var: fly_ash_factor
      value: 0.20
```

- `condition` 是布尔表达式，使用同 formula 一样的语法
- `then`/`else` 内部是子步骤数组，同样按 7 种类型来写
- 每个分支内部的变量最终应写入 `var` 字段声明的目标变量

### 7. `output` — 最终输出

```yaml
- type: output
  var: wb_final                # 必须是前面已定义过的变量
  name: "水胶比"               # 中文名，展示给用户
  unit: ""                     # 单位
  precision: 3                 # 小数位
```

---

## 五、通用校验规则（都会被 BlueprintValidator 检查）

1. **变量名必须合法**：`^[a-zA-Z_][a-zA-Z_0-9]*$`
2. **变量使用前必须先定义**：formula.expr 中出现的每个非函数标识符都必须在前面步骤中通过 var 定义过
3. **公式禁止自引用**：`formula.var` 不能出现在 `formula.expr` 中
4. **material 步骤禁止 name 字段**、`category` 和 `property` 必须在白名单内
5. **步骤类型仅限 7 种**：input / const / material / formula / table_lookup / if_else / output
6. **table_lookup / output 引用的 var 必须已定义**

---

## 六、数值合理区间（生成前请自检）

| 项目 | 合理区间 |
|------|----------|
| 水胶比 | 0.20 ~ 0.65 |
| 砂率 | 25% ~ 55% |
| 总质量 | 1800 ~ 2600 kg/m³ |
| 胶凝材料总量 | 300 ~ 600 kg/m³ |
| 单方用水量 | 150 ~ 240 kg/m³ |

生成的蓝图跑试算时，输出结果应落在上述区间内。若不满足请检查公式和参数默认值。

---

## 七、tables/*.json 格式

```json
{
  "name": "slump_water_table",
  "description": "坍落度-用水量对照表（JGJ 55 表 4.0.1-1）",
  "version": "1.0",
  "dimensions": [
    { "name": "slump", "unit": "mm", "values": [30, 50, 70, 90] },
    { "name": "max_agg_size", "unit": "mm", "values": [10, 20, 40] }
  ],
  "data": [
    [215, 200, 185],
    [225, 210, 195],
    [235, 220, 205],
    [245, 230, 215]
  ],
  "interpolation": "bilinear"
}
```

- `name` 必须与 `table_lookup.table` 完全一致
- `dimensions[].name` 与 `table_lookup.keys` 的 key 一一对应
- `data` 的行数=第一维长度、列数=第二维长度（一维表则为一维数组）

---

## 八、完整示例（普通混凝土 JGJ 55 简化版）

```
=== meta.yaml ===
name: "普通混凝土_JGJ55"
description: "按 JGJ 55-2011 设计普通混凝土配合比"
version: "1.0.0"
concrete_type: "normal"
parameters:
  - name: strength_grade
    label: "强度等级"
    type: select
    required: true
    options: ["C30", "C35", "C40"]
  - name: slump
    label: "坍落度(mm)"
    type: number
    required: true
    default: 180

=== blueprint.yaml ===
steps:
  - type: input
    var: fcu_k
    from: "strength_grade"
    value_map: { C30: 30, C35: 35, C40: 40 }
    default: 30
  - type: input
    var: sigma
    from: "sigma"
    default: 5.0
  - type: input
    var: slump
    from: "slump"
    default: 180
  - type: material
    var: cement_strength
    material_query: { category: "水泥", property: "compressiveStrength28d" }
  - type: const
    var: rich_factor
    value: 1.0
  - type: const
    var: alpha_a
    value: 0.53
  - type: const
    var: alpha_b
    value: 0.20
  - type: formula
    var: fb
    expr: "rich_factor * cement_strength"
  - type: formula
    var: fcu_o
    expr: "fcu_k + 1.645 * sigma"
  - type: formula
    var: wb_raw
    expr: "(alpha_a * fb) / (fcu_o + alpha_a * alpha_b * fb)"
  - type: formula
    var: wb_final
    expr: "round(wb_raw * 100) / 100"
  - type: output
    var: wb_final
    name: "水胶比"
    unit: ""
    precision: 3
```

---

## 九、生成前 checklist（每次生成前自检 5 遍）

- [ ] meta.yaml 和 blueprint.yaml 两段都有？
- [ ] 每个 formula 的 var **没有**出现在自己的 expr 里？
- [ ] 每个 formula.expr 里用到的变量都在**前面**定义过？
- [ ] 每个 material 步骤的 category、property 都在**白名单**里？
- [ ] 每个 material 步骤都**没有** name 字段？
- [ ] 至少有 1 个 output 步骤？
- [ ] 用默认参数思路走一遍，数值大致合理？

---

## 十、失败恢复

如果 `create_skill` 返回校验错误（如 `公式自引用 "wb"` / `变量 "xxx" 未定义` / `property "yyy" 不允许`），**不要**重复生成同样的错误蓝图。请：
1. 阅读错误信息，定位到具体步骤
2. 应用本文的规则修正（尤其是**多阶段变量命名**）
3. 重新生成完整蓝图，再次调用 `create_skill(format='blueprint', rawBlueprint='...')`
