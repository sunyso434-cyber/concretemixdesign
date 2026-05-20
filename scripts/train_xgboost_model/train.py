import argparse
import json
import os
import sys
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.model_selection import KFold
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from xgboost import XGBRegressor

from feature_config import FEATURE_CONFIG, FEATURE_NAMES, TARGET_COLUMNS
from export_model import export_model_to_json


def load_data(filepath):
    if filepath.endswith((".xlsx", ".xls")):
        return pd.read_excel(filepath)
    return pd.read_csv(filepath)


def validate_columns(df):
    missing_features = [f for f in FEATURE_NAMES if f not in df.columns]
    if missing_features:
        print(f"错误: 缺少特征列: {missing_features}")
        sys.exit(1)

    for target in TARGET_COLUMNS:
        if target not in df.columns:
            print(f"警告: 缺少目标列 '{target}'，将跳过该目标训练")

    available_targets = [t for t in TARGET_COLUMNS if t in df.columns]
    if not available_targets:
        print("错误: 没有找到任何目标列")
        sys.exit(1)

    return available_targets


def compute_feature_stats(X):
    stats = {}
    for col in FEATURE_NAMES:
        if col in X.columns:
            values = X[col].replace(-1, np.nan).dropna()
            if len(values) > 0:
                stats[col] = {
                    "min": round(float(values.min()), 4),
                    "max": round(float(values.max()), 4),
                    "mean": round(float(values.mean()), 4),
                }
            else:
                stats[col] = {"min": -1, "max": -1, "mean": -1}
        else:
            stats[col] = {"min": -1, "max": -1, "mean": -1}
    return stats


def cross_validate(model_cls, X, y, n_splits=5, **model_params):
    kf = KFold(n_splits=n_splits, shuffle=True, random_state=42)
    rmse_list, mae_list, r2_list = [], [], []

    for fold_idx, (train_idx, val_idx) in enumerate(kf.split(X)):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

        model = model_cls(**model_params)
        model.fit(X_train, y_train)
        y_pred = model.predict(X_val)

        rmse_list.append(np.sqrt(mean_squared_error(y_val, y_pred)))
        mae_list.append(mean_absolute_error(y_val, y_pred))
        r2_list.append(r2_score(y_val, y_pred))

    return {
        "rmse": {"mean": round(np.mean(rmse_list), 4), "std": round(np.std(rmse_list), 4), "folds": [round(v, 4) for v in rmse_list]},
        "mae": {"mean": round(np.mean(mae_list), 4), "std": round(np.std(mae_list), 4), "folds": [round(v, 4) for v in mae_list]},
        "r2": {"mean": round(np.mean(r2_list), 4), "std": round(np.std(r2_list), 4), "folds": [round(v, 4) for v in r2_list]},
    }


def train_target(X, y, args, target_name):
    model_params = {
        "n_estimators": args.n_estimators,
        "max_depth": args.max_depth,
        "learning_rate": args.learning_rate,
        "random_state": 42,
        "objective": "reg:squarederror",
    }

    print(f"\n{'='*60}")
    print(f"训练目标: {target_name}")
    print(f"样本数: {len(y)}, 特征数: {X.shape[1]}")
    print(f"参数: n_estimators={args.n_estimators}, max_depth={args.max_depth}, learning_rate={args.learning_rate}")
    print(f"{'='*60}")

    cv_results = cross_validate(XGBRegressor, X, y, n_splits=5, **model_params)

    print(f"  5-fold CV results:")
    print(f"    RMSE: {cv_results['rmse']['mean']:.4f} +/- {cv_results['rmse']['std']:.4f}")
    print(f"    MAE:  {cv_results['mae']['mean']:.4f} +/- {cv_results['mae']['std']:.4f}")
    print(f"    R2:   {cv_results['r2']['mean']:.4f} +/- {cv_results['r2']['std']:.4f}")

    model = XGBRegressor(**model_params)
    model.fit(X, y)

    return model, cv_results


def main():
    parser = argparse.ArgumentParser(description="XGBoost混凝土配合比预测模型训练脚本")
    parser.add_argument("--input", required=True, help="训练数据文件路径 (Excel/CSV)")
    parser.add_argument("--output", default="../../resources/models/", help="模型输出目录")
    parser.add_argument("--n-estimators", type=int, default=200, help="树的数量 (默认: 200)")
    parser.add_argument("--max-depth", type=int, default=6, help="最大树深度 (默认: 6)")
    parser.add_argument("--learning-rate", type=float, default=0.1, help="学习率 (默认: 0.1)")
    args = parser.parse_args()

    print("=" * 60)
    print("XGBoost 混凝土配合比预测模型训练")
    print("=" * 60)
    print(f"输入文件: {args.input}")
    print(f"输出目录: {args.output}")

    if not os.path.exists(args.input):
        print(f"错误: 输入文件不存在: {args.input}")
        sys.exit(1)

    df = load_data(args.input)
    print(f"数据加载完成: {df.shape[0]} 行, {df.shape[1]} 列")

    available_targets = validate_columns(df)

    X = df[FEATURE_NAMES]
    feature_stats = compute_feature_stats(X)
    feature_stats["_total_samples"] = len(df)

    os.makedirs(args.output, exist_ok=True)

    all_results = {}

    for target_col in available_targets:
        target_name = target_col.replace("target_", "")
        # Remove underscores from target names to match JS file naming convention
        file_name = target_name.replace("_", "")
        mask = df[target_col].notna()
        X_target = X[mask]
        y_target = df.loc[mask, target_col]

        model, cv_results = train_target(X_target, y_target, args, target_name)

        y_mean = float(y_target.mean())
        model_json = export_model_to_json(model, target_name, FEATURE_NAMES, feature_stats, args,
                                          y_mean=y_mean)
        model_json["training_info"]["rmse"] = cv_results["rmse"]["mean"]
        model_json["training_info"]["r_squared"] = cv_results["r2"]["mean"]
        model_json["training_info"]["mae"] = cv_results["mae"]["mean"]
        model_json["training_info"]["cv_results"] = cv_results

        output_path = os.path.join(args.output, f"{file_name}.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(model_json, f, ensure_ascii=False, indent=2)
        print(f"  模型已保存: {output_path}")

    feature_config_output = {
        "version": "1.0",
        "description": "XGBoost预测模型特征配置 - 34维特征向量",
        "features": FEATURE_CONFIG,
    }
    fc_path = os.path.join(args.output, "feature_config.json")
    with open(fc_path, "w", encoding="utf-8") as f:
        json.dump(feature_config_output, f, ensure_ascii=False, indent=2)
    print(f"\n特征配置已保存: {fc_path}")

    print(f"\n{'='*60}")
    print("训练报告")
    print(f"{'='*60}")
    print(f"训练日期: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"训练数据: {df.shape[0]} 样本, {len(FEATURE_NAMES)} 特征")
    print(f"超参数: n_estimators={args.n_estimators}, max_depth={args.max_depth}, learning_rate={args.learning_rate}")
    print(f"输出目录: {os.path.abspath(args.output)}")
    for target_col in available_targets:
        target_name = target_col.replace("target_", "")
        m = len(df[target_col].dropna())
        print(f"\n  {target_name}:")
        print(f"    有效样本数: {m}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()