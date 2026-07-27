import argparse
import json
import os
import sys
from argparse import Namespace
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.model_selection import KFold
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from xgboost import XGBRegressor

# 老板 2026-07-27: P1 引入 Optuna 贝叶斯超参调优 (针对 181 小样本)
import optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)  # 抑制 trial 级日志噪音

from feature_config import (
    FEATURE_CONFIG,
    FEATURE_NAMES,
    TARGET_COLUMNS,
    TARGET_FEATURES,
    TARGET_FORCE_MISSING,
)
from export_model import export_model_to_json

# 老板 2026-07-27: 8 个材料指标列，未用该材料时填 -1，会让 XGBoost 误把 -1 当真实值学习
# 改成 NaN，配合 XGBRegressor(missing=np.nan) 让模型自动学缺失方向
# 注意：只清洗这 8 列，不动 has_* 布尔列（真实 0/1），不动防泄漏的 superplasticizer_dosage
MATERIAL_INDICATOR_COLS = [
    "fly_ash_activity_index",
    "fly_ash_water_demand_ratio",
    "slag_activity_index",
    "slag_fluidity_ratio",
    "lithium_slag_activity_index",
    "lithium_slag_water_demand_ratio",
    "composite_powder_activity_index",
    "composite_powder_fluidity_ratio",
]


def load_data(filepath):
    if filepath.endswith((".xlsx", ".xls")):
        return pd.read_excel(filepath)
    return pd.read_csv(filepath)


def get_features_for_target(df, target_name):
    """老板 2026-07-10: 按目标返回对应的特征子集 DataFrame
    - strength_28d / density: 去掉 feature_slump (31 维)
    - superplasticizer_dosage: 32 维全留，superplasticizer_dosage 强制置 NaN 防泄漏
    老板 2026-07-27: 8 列材料指标 -1 → NaN; 防泄漏值 -1 → NaN (与 missing=np.nan 对齐)
    """
    feature_names = TARGET_FEATURES.get(target_name, FEATURE_NAMES)
    X = df[feature_names].copy()

    # 防泄漏列：强制置 NaN (原 -1)
    for feat in TARGET_FORCE_MISSING.get(target_name, []):
        X[feat] = np.nan

    # 8 列材料指标: -1 → NaN
    for col in MATERIAL_INDICATOR_COLS:
        if col in X.columns:
            X[col] = X[col].replace(-1, np.nan)

    return X, feature_names


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


def tune_hyperparameters(X, y, target_name, n_trials=50, n_splits=5):
    """老板 2026-07-27: P1 Optuna 贝叶斯超参调优 (TPESampler, seed=42 可复现)

    针对小样本(181)设计：浅树 + 强正则防过拟合。
    返回 best_params dict (已含 random_state/objective)。
    """
    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 7),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "colsample_bynode": trial.suggest_float("colsample_bynode", 0.6, 1.0),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 25, log=True),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 10, log=True),
            "gamma": trial.suggest_float("gamma", 0, 5),
            "random_state": 42,
            "objective": "reg:squarederror",
            # 老板 2026-07-27: 显式指定缺失值=NaN, 让模型自动学缺失方向
            "missing": np.nan,
        }
        try:
            cv = cross_validate(XGBRegressor, X, y, n_splits=n_splits, **params)
            rmse = cv["rmse"]["mean"]
            if not np.isfinite(rmse):
                return 1e9
            return rmse
        except Exception:
            return 1e9  # 极端参数失败trial返回大值，由sampler自动规避

    sampler = optuna.samplers.TPESampler(seed=42)
    study = optuna.create_study(direction="minimize", sampler=sampler)
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best = dict(study.best_params)
    best["random_state"] = 42
    best["objective"] = "reg:squarederror"
    best["missing"] = np.nan  # 与训练时保持一致
    print(f"  [Optuna] {target_name}: trials={n_trials}, best_RMSE={study.best_value:.4f}")
    print(f"           best_params={best}")
    return best


def train_target(X, y, args, target_name, best_params=None):
    # 老板 2026-07-27: 优先用 Optuna 调出的 best_params；未调参时回退到 args 默认
    if best_params:
        model_params = dict(best_params)
    else:
        model_params = {
            "n_estimators": args.n_estimators,
            "max_depth": args.max_depth,
            "learning_rate": args.learning_rate,
            "random_state": 42,
            "objective": "reg:squarederror",
            "missing": np.nan,
        }

    print(f"\n{'='*60}")
    print(f"训练目标: {target_name}")
    print(f"样本数: {len(y)}, 特征数: {X.shape[1]}")
    if best_params:
        print(f"超参来源: Optuna 调优 (tuned)")
    else:
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
    parser.add_argument("--n-estimators", type=int, default=200, help="树的数量 (默认: 200, 仅在未调参时使用)")
    parser.add_argument("--max-depth", type=int, default=6, help="最大树深度 (默认: 6, 仅在未调参时使用)")
    parser.add_argument("--learning-rate", type=float, default=0.1, help="学习率 (默认: 0.1, 仅在未调参时使用)")
    # 老板 2026-07-27: P1 Optuna 贝叶斯调参。n-trials=0 表示跳过调参，回退到固定超参
    parser.add_argument("--n-trials", type=int, default=50, help="Optuna 调参试验数 (默认: 50; 设 0 则跳过调参使用固定超参)")
    args = parser.parse_args()

    print("=" * 60)
    print("XGBoost 混凝土配合比预测模型训练")
    print("=" * 60)
    print(f"输入文件: {args.input}")
    print(f"输出目录: {args.output}")
    print(f"超参调优: {'Optuna (n_trials=' + str(args.n_trials) + ')' if args.n_trials > 0 else '关闭，使用固定超参'}")

    if not os.path.exists(args.input):
        print(f"错误: 输入文件不存在: {args.input}")
        sys.exit(1)

    df = load_data(args.input)
    print(f"数据加载完成: {df.shape[0]} 行, {df.shape[1]} 列")

    available_targets = validate_columns(df)

    os.makedirs(args.output, exist_ok=True)

    all_results = {}

    for target_col in available_targets:
        target_name = target_col.replace("target_", "")
        # Remove underscores from target names to match JS file naming convention
        file_name = target_name.replace("_", "")

        # 老板 2026-07-10: 按目标取不同特征子集
        X_target_full, target_feature_names = get_features_for_target(df, target_name)
        feature_stats = compute_feature_stats(X_target_full)
        feature_stats["_total_samples"] = len(df)

        mask = df[target_col].notna()
        X_target = X_target_full[mask]
        y_target = df.loc[mask, target_col]

        # 老板 2026-07-27: P1 调参 (每个目标独立，因特征子集不同)
        best_params = None
        if args.n_trials > 0:
            print(f"\n[Optuna] 开始为 {target_name} 调参 (n_trials={args.n_trials})...")
            best_params = tune_hyperparameters(X_target, y_target, target_name, n_trials=args.n_trials)

        model, cv_results = train_target(X_target, y_target, args, target_name, best_params=best_params)

        y_mean = float(y_target.mean())

        # 老板 2026-07-27: 构造给 export_model 用的 args 副本，注入最优参数
        # export_model_to_json 读 args.n_estimators/max_depth/learning_rate，这里不改 export_model.py
        export_args = Namespace(
            n_estimators=best_params["n_estimators"] if best_params else args.n_estimators,
            max_depth=best_params["max_depth"] if best_params else args.max_depth,
            learning_rate=best_params["learning_rate"] if best_params else args.learning_rate,
        )
        model_json = export_model_to_json(
            model, target_name, target_feature_names, feature_stats, export_args,
            y_mean=y_mean,
        )
        model_json["training_info"]["rmse"] = cv_results["rmse"]["mean"]
        model_json["training_info"]["r_squared"] = cv_results["r2"]["mean"]
        model_json["training_info"]["mae"] = cv_results["mae"]["mean"]
        model_json["training_info"]["cv_results"] = cv_results
        # 老板 2026-07-27: P1 写入 best_params 和 tuned 标记
        if best_params:
            model_json["training_info"]["best_params"] = best_params
            model_json["training_info"]["tuned"] = True
            model_json["training_info"]["n_trials"] = args.n_trials

        output_path = os.path.join(args.output, f"{file_name}.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(model_json, f, ensure_ascii=False, indent=2)
        print(f"  模型已保存: {output_path} (特征数: {len(target_feature_names)})")

    feature_config_output = {
        "version": "1.0",
        "description": "XGBoost预测模型特征配置 - 35维特征向量",
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
    if args.n_trials > 0:
        print(f"超参调优: Optuna n_trials={args.n_trials}")
    else:
        print(f"超参数(固定): n_estimators={args.n_estimators}, max_depth={args.max_depth}, learning_rate={args.learning_rate}")
    print(f"输出目录: {os.path.abspath(args.output)}")
    for target_col in available_targets:
        target_name = target_col.replace("target_", "")
        m = len(df[target_col].dropna())
        print(f"\n  {target_name}:")
        print(f"    有效样本数: {m}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()