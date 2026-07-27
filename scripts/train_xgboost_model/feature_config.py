FEATURE_CONFIG = [
    {"index": 0, "name": "water_binder_ratio", "group": "mix", "default": 0.45, "label": "水胶比"},
    {"index": 1, "name": "cement_amount", "group": "mix", "default": 0, "label": "水泥用量(kg/m³)"},
    {"index": 2, "name": "fly_ash_dosage", "group": "mix", "default": 0, "label": "粉煤灰掺量(%)"},
    {"index": 3, "name": "slag_dosage", "group": "mix", "default": 0, "label": "矿渣粉掺量(%)"},
    {"index": 4, "name": "lithium_slag_dosage", "group": "mix", "default": 0, "label": "锂渣掺量(%)"},
    {"index": 5, "name": "composite_powder_dosage", "group": "mix", "default": 0, "label": "复合粉掺量(%)"},
    {"index": 6, "name": "sand_ratio", "group": "mix", "default": 38, "label": "砂率(%)"},
    {"index": 7, "name": "superplasticizer_dosage", "group": "mix", "default": 0, "label": "减水剂掺量(%)"},
    {"index": 8, "name": "has_fly_ash", "group": "flag", "default": 0, "label": "是否使用粉煤灰"},
    {"index": 9, "name": "has_slag", "group": "flag", "default": 0, "label": "是否使用矿渣粉"},
    {"index": 10, "name": "has_lithium_slag", "group": "flag", "default": 0, "label": "是否使用锂渣"},
    {"index": 11, "name": "has_composite_powder", "group": "flag", "default": 0, "label": "是否使用复合粉"},
    {"index": 12, "name": "has_superplasticizer", "group": "flag", "default": 0, "label": "是否使用减水剂"},
    {"index": 13, "name": "cement_strength_28d", "group": "material", "default": -1, "label": "水泥28d强度(MPa)"},
    {"index": 14, "name": "cement_standard_consistency", "group": "material", "default": -1, "label": "水泥标准稠度(%)"},
    {"index": 15, "name": "fly_ash_activity_index", "group": "material", "default": -1, "label": "粉煤灰活性指数(%)"},
    {"index": 16, "name": "fly_ash_water_demand_ratio", "group": "material", "default": -1, "label": "粉煤灰需水比(%)"},
    {"index": 17, "name": "slag_activity_index", "group": "material", "default": -1, "label": "矿渣粉活性指数(%)"},
    {"index": 18, "name": "slag_fluidity_ratio", "group": "material", "default": -1, "label": "矿渣粉流动度比(%)"},
    {"index": 19, "name": "lithium_slag_activity_index", "group": "material", "default": -1, "label": "锂渣活性指数(%)"},
    {"index": 20, "name": "lithium_slag_water_demand_ratio", "group": "material", "default": -1, "label": "锂渣需水比(%)"},
    {"index": 21, "name": "composite_powder_activity_index", "group": "material", "default": -1, "label": "复合粉活性指数(%)"},
    {"index": 22, "name": "composite_powder_fluidity_ratio", "group": "material", "default": -1, "label": "复合粉流动度比(%)"},
    {"index": 23, "name": "sand_fineness_modulus", "group": "material", "default": -1, "label": "细度模数"},
    {"index": 24, "name": "sand_mb_value", "group": "material", "default": -1, "label": "MB值"},
    {"index": 25, "name": "sand_mud_content", "group": "material", "default": -1, "label": "含泥量(%)"},
    {"index": 26, "name": "stone_crushing_value", "group": "material", "default": -1, "label": "压碎值(%)"},
    {"index": 27, "name": "stone_needle_flake", "group": "material", "default": -1, "label": "针片状含量(%)"},
    {"index": 28, "name": "super_water_reducing_rate", "group": "material", "default": -1, "label": "减水率(%)"},
    {"index": 29, "name": "super_solid_content", "group": "material", "default": -1, "label": "含固量(%)"},
    {"index": 30, "name": "super_recommended_dosage", "group": "material", "default": -1, "label": "推荐掺量(%)"},
    # 老板 2026-07-27: 删除 temperature/humidity/curing_age 3 个常量列
    # (训练数据中分别全是 20/95/28, 零方差零贡献)
    # 原 feature_slump 从 index 34 -> 31
    {"index": 31, "name": "feature_slump", "group": "mix", "default": 200, "label": "坍落度(mm)"},
]

FEATURE_NAMES = [f["name"] for f in FEATURE_CONFIG]

# 老板 2026-07-10: 去除坍落度作为目标；减水剂掺量作为新目标
TARGET_COLUMNS = ["target_strength_28d", "target_superplasticizer_dosage", "target_density"]

MIX_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "mix"]
FLAG_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "flag"]
MATERIAL_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "material"]
# 老板 2026-07-27: env 组已删除 (temperature/humidity/curing_age 是常量列)
ENV_FEATURES = []

# 老板 2026-07-10: 修复减水剂掺量模型数据泄漏 + 强度/容重不应使用坍落度
# 三个目标用不同特征子集：
#   - strength_28d / density: 不含坍落度 (坍落度对新拌流动性有影响，对 28d 强度/容重几乎无影响)
#   - superplasticizer_dosage: 32 维全留，但训练时把 superplasticizer_dosage 列置 NaN 防泄漏
# 老板 2026-07-27: 维度 35→32 (删了 3 个常量 env 列), 防 -1 改成 NaN
TARGET_FEATURES = {
    "strength_28d": [f["name"] for f in FEATURE_CONFIG if f["name"] != "feature_slump"],
    "density": [f["name"] for f in FEATURE_CONFIG if f["name"] != "feature_slump"],
    "superplasticizer_dosage": list(FEATURE_NAMES),  # 32 维全留，superplasticizer_dosage 训练/预测时置 NaN
}

# 训练/预测时需要强制置缺失的特征（防数据泄漏）。key=目标名, value=特征名列表
# 老板 2026-07-27: 防泄漏值从 -1 改成 NaN，与 XGBRegressor(missing=np.nan) 对齐
TARGET_FORCE_MISSING = {
    "superplasticizer_dosage": ["superplasticizer_dosage"],  # 不能用自己预测自己
}