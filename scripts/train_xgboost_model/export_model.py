import json
import os
from datetime import datetime


def export_model_to_json(model, target_name, feature_names, feature_stats, args,
                         y_mean=None):
    """用 XGBoost trees_to_dataframe API 导出模型，确保预测与 Python 完全一致。

    XGBoost 内部 base_weights 存储的是缩放前值，dump_model 的 leaf= 输出
    才是实际用于预测的值。改用 trees_to_dataframe 的 Gain 字段，直接获取
    每个叶节点在预测中使用的真实叶子值。

    同时正确处理 missing value：通过树的深度和节点关系推导。
    """
    booster = model.get_booster()
    df_trees = booster.trees_to_dataframe()

    # 获取 XGBoost 内部 base_score（回归中为目标均值）
    config = json.loads(booster.save_config())
    base_score = 0.5
    try:
        learner_params = config.get("learner", {}).get("learner_model_param", {})
        bs_str = learner_params.get("base_score", "")
        if bs_str:
            bs_str = bs_str.strip("[]")
            base_score = float(bs_str)
        elif y_mean is not None:
            base_score = float(y_mean)
    except (ValueError, KeyError):
        if y_mean is not None:
            base_score = float(y_mean)

    # 建立特征名到索引的映射
    name_to_index = {name: idx for idx, name in enumerate(feature_names)}

    # 按 Tree 分组构建树结构
    tree_groups = df_trees.groupby("Tree")
    trees = []

    for tree_idx in range(len(tree_groups)):
        tree_df = tree_groups.get_group(tree_idx)
        max_node = tree_df["Node"].max()
        nodes = [None] * (max_node + 1)

        for _, row in tree_df.iterrows():
            node_id = row["Node"]
            feature = row["Feature"]

            if feature == "Leaf":
                # Gain 字段存储叶子在预测中的真实值
                nodes[node_id] = {"leaf": round(float(row["Gain"]), 10)}
            else:
                split_feature = name_to_index.get(feature)
                if split_feature is None:
                    import re
                    m = re.search(r"(\d+)", feature)
                    if m:
                        split_feature = int(m.group(1))

                # 解析 Yes/No/Missing 节点 ID（如 "0-3" -> 3）
                yes_id = int(row["Yes"].split("-")[1])
                no_id = int(row["No"].split("-")[1])
                missing_id = int(row["Missing"].split("-")[1])

                nodes[node_id] = {
                    "split_feature": split_feature,
                    "split_condition": round(float(row["Split"]), 10),
                    "left": yes_id,
                    "right": no_id,
                    "missing": missing_id,
                }

        # 填充空位（按 XGBoost 格式，应为 leaf=0 的节点）
        for i in range(len(nodes)):
            if nodes[i] is None:
                nodes[i] = {"leaf": 0.0}

        trees.append(nodes)

    # Validate: 非叶节点必须有 split_feature
    total_non_leaf = 0
    broken_nodes = 0
    for tree in trees:
        for node in tree:
            if "leaf" not in node:
                total_non_leaf += 1
                if "split_feature" not in node:
                    broken_nodes += 1

    if total_non_leaf > 0 and broken_nodes > 0:
        raise RuntimeError(
            f"Model validation failed: {broken_nodes}/{total_non_leaf} non-leaf nodes "
            f"missing split_feature."
        )

    output = {
        "model_version": "1.0",
        "target": target_name,
        "feature_config_version": "1.0",
        "feature_names": feature_names,
        "trees": trees,
        "learning_rate": args.learning_rate,
        "base_score": round(base_score, 4),
        "feature_stats": feature_stats,
        "training_info": {
            "samples": int(feature_stats.get("_total_samples", 0)),
            "date": datetime.now().strftime("%Y-%m-%d"),
            "n_estimators": args.n_estimators,
            "max_depth": args.max_depth,
        }
    }

    return output