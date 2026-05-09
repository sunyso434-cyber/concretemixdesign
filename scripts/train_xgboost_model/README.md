# XGBoost 混凝土配合比预测模型训练脚本

## 环境准备

```bash
pip install -r requirements.txt
```

## 数据格式要求

训练数据需为 Excel (`.xlsx`) 或 CSV (`.csv`) 文件, 包含以下列:

### 特征列 (34列)

| 序号 | 列名 | 组别 | 说明 |
|------|------|------|------|
| 0 | water_binder_ratio | 配合比 | 水胶比 |
| 1 | cement_amount | 配合比 | 水泥用量(kg/m³) |
| 2 | fly_ash_dosage | 配合比 | 粉煤灰掺量(%) |
| 3 | slag_dosage | 配合比 | 矿渣粉掺量(%) |
| 4 | lithium_slag_dosage | 配合比 | 锂渣掺量(%) |
| 5 | composite_powder_dosage | 配合比 | 复合粉掺量(%) |
| 6 | sand_ratio | 配合比 | 砂率(%) |
| 7 | superplasticizer_dosage | 配合比 | 减水剂掺量(%) |
| 8 | has_fly_ash | 标志 | 是否使用粉煤灰 (0/1) |
| 9 | has_slag | 标志 | 是否使用矿渣粉 (0/1) |
| 10 | has_lithium_slag | 标志 | 是否使用锂渣 (0/1) |
| 11 | has_composite_powder | 标志 | 是否使用复合粉 (0/1) |
| 12 | has_superplasticizer | 标志 | 是否使用减水剂 (0/1) |
| 13 | cement_strength_28d | 材料属性 | 水泥28d强度(MPa) |
| 14 | cement_standard_consistency | 材料属性 | 水泥标准稠度(%) |
| 15 | fly_ash_activity_index | 材料属性 | 粉煤灰活性指数(%) |
| 16 | fly_ash_water_demand_ratio | 材料属性 | 粉煤灰需水比(%) |
| 17 | slag_activity_index | 材料属性 | 矿渣粉活性指数(%) |
| 18 | slag_fluidity_ratio | 材料属性 | 矿渣粉流动度比(%) |
| 19 | lithium_slag_activity_index | 材料属性 | 锂渣活性指数(%) |
| 20 | lithium_slag_water_demand_ratio | 材料属性 | 锂渣需水比(%) |
| 21 | composite_powder_activity_index | 材料属性 | 复合粉活性指数(%) |
| 22 | composite_powder_water_demand_ratio | 材料属性 | 复合粉需水比(%) |
| 23 | sand_fineness_modulus | 材料属性 | 细度模数 |
| 24 | sand_mb_value | 材料属性 | MB值 |
| 25 | sand_mud_content | 材料属性 | 含泥量(%) |
| 26 | stone_crushing_value | 材料属性 | 压碎值(%) |
| 27 | stone_needle_flake | 材料属性 | 针片状含量(%) |
| 28 | super_water_reducing_rate | 材料属性 | 减水率(%) |
| 29 | super_solid_content | 材料属性 | 含固量(%) |
| 30 | super_recommended_dosage | 材料属性 | 推荐掺量(%) |
| 31 | temperature | 环境 | 养护温度(℃) |
| 32 | humidity | 环境 | 相对湿度(%) |
| 33 | curing_age | 环境 | 龄期(天) |

### 目标列 (3列)

| 列名 | 说明 |
|------|------|
| target_strength_28d | 28天抗压强度(MPa) |
| target_slump | 坩落度(mm) |
| target_density | 密度(kg/m³) |

**重要**: 不使用的材料属性列请填 `-1` 表示缺失值。

## 训练命令

```bash
python train.py --input ./training_data.xlsx --output ./output/
```

可选参数:

```bash
python train.py \
  --input ./training_data.xlsx \
  --output ../../resources/models/ \
  --n-estimators 200 \
  --max-depth 6 \
  --learning-rate 0.1
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| --input | (必需) | 训练数据文件路径 |
| --output | ../../resources/models/ | 模型输出目录 |
| --n-estimators | 200 | 树的数量 |
| --max-depth | 6 | 最大树深度 |
| --learning-rate | 0.1 | 学习率 |

## 输出文件

训练完成后会在输出目录生成以下文件:

| 文件 | 说明 |
|------|------|
| strength28d.json | 28天抗压强度预测模型 |
| slump.json | 坩落度预测模型 |
| density.json | 密度预测模型 |
| feature_config.json | 特征配置文件 |

每个模型 JSON 文件包含:

- `model_version`: 模型版本号
- `target`: 预测目标名称
- `feature_names`: 特征名称列表 (34维)
- `trees`: 决策树数组, 每棵树为节点数组
- `learning_rate`: 学习率
- `base_score`: 基础预测值
- `feature_stats`: 各特征统计信息 (min/max/mean)
- `training_info`: 训练信息 (样本数、日期、交叉验证指标等)

## 部署模型

将训练生成的 JSON 文件复制到项目的 `resources/models/` 目录即可:

```bash
cp strength28d.json slump.json density.json feature_config.json ../../resources/models/
```

应用会自动加载新模型, 无需修改代码。注意替换原有占位文件。