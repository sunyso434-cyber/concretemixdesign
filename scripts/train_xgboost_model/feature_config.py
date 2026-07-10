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
    {"index": 31, "name": "temperature", "group": "env", "default": 20, "label": "养护温度(℃)"},
    {"index": 32, "name": "humidity", "group": "env", "default": 95, "label": "相对湿度(%)"},
    {"index": 33, "name": "curing_age", "group": "env", "default": 28, "label": "龄期(天)"},
    {"index": 34, "name": "feature_slump", "group": "mix", "default": 200, "label": "坍落度(mm)"},
]

FEATURE_NAMES = [f["name"] for f in FEATURE_CONFIG]

# 老板 2026-07-10: 去除坍落度作为目标；减水剂掺量作为新目标
TARGET_COLUMNS = ["target_strength_28d", "target_superplasticizer_dosage", "target_density"]

MIX_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "mix"]
FLAG_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "flag"]
MATERIAL_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "material"]
ENV_FEATURES = [f["name"] for f in FEATURE_CONFIG if f["group"] == "env"]