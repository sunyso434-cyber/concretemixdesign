import json
import re
import os
import tempfile
from datetime import datetime


def parse_xgboost_dump(dump_text):
    trees = []
    current_tree_lines = []

    for line in dump_text.strip().splitlines():
        line = line.rstrip()
        if line.startswith("booster["):
            if current_tree_lines:
                trees.append(_parse_single_tree(current_tree_lines))
            current_tree_lines = []
        elif line:
            current_tree_lines.append(line)

    if current_tree_lines:
        trees.append(_parse_single_tree(current_tree_lines))

    return trees


def _parse_single_tree(lines):
    nodes = {}

    for line in lines:
        line = line.strip()
        colon_pos = line.find(":")
        if colon_pos == -1:
            continue

        node_id = int(line[:colon_pos])
        rest = line[colon_pos + 1:]

        if "leaf=" in rest:
            leaf_val = re.search(r"leaf=([-\d.eE+]+)", rest)
            nodes[node_id] = {"leaf": float(leaf_val.group(1)) if leaf_val else 0.0}
        else:
            node = {}

            split_match = re.search(r"f(\d+)<([-\d.eE+]+)", rest)
            if split_match:
                node["split_feature"] = int(split_match.group(1))
                node["split_condition"] = float(split_match.group(2))

            yes_match = re.search(r"yes=(\d+)", rest)
            if yes_match:
                node["left"] = int(yes_match.group(1))

            no_match = re.search(r"no=(\d+)", rest)
            if no_match:
                node["right"] = int(no_match.group(1))

            missing_match = re.search(r"missing=(\d+)", rest)
            if missing_match:
                node["missing"] = int(missing_match.group(1))

            nodes[node_id] = node

    if not nodes:
        return [{"leaf": 0.0}]

    max_id = max(nodes.keys())
    ordered = []
    for i in range(max_id + 1):
        if i in nodes:
            ordered.append(nodes[i])
        else:
            ordered.append({"leaf": 0.0})

    return ordered


def export_model_to_json(model, target_name, feature_names, feature_stats, args):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        dump_path = f.name
        model.get_booster().dump_model(dump_path)

    with open(dump_path, "r", encoding="utf-8") as f:
        dump_text = f.read()
    os.unlink(dump_path)

    trees = parse_xgboost_dump(dump_text)

    base_score = 0.5
    if hasattr(model, "get_params"):
        params = model.get_params()
        if "base_score" in params and params["base_score"] is not None:
            base_score = float(params["base_score"])

    output = {
        "model_version": "1.0",
        "target": target_name,
        "feature_config_version": "1.0",
        "feature_names": feature_names,
        "trees": trees,
        "learning_rate": args.learning_rate,
        "base_score": base_score,
        "feature_stats": feature_stats,
        "training_info": {
            "samples": int(feature_stats.get("_total_samples", 0)),
            "date": datetime.now().strftime("%Y-%m-%d"),
            "n_estimators": args.n_estimators,
            "max_depth": args.max_depth,
        }
    }

    return output