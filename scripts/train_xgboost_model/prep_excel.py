"""老板2026-07-10: 把 Excel 重塑为新训练数据
- AI 列 target_slump -> feature_slump (作为新特征)
- AJ 列新增 target_superplasticizer_dosage = H 列 superplasticizer_dosage 的值
"""
import pandas as pd

SRC = "template_training_data.xlsx"
DST = "template_training_data.xlsx"

df = pd.read_excel(SRC)
print("before:", df.shape, "cols:", list(df.columns)[-4:])

assert "target_slump" in df.columns, "缺少 target_slump 列"
assert "superplasticizer_dosage" in df.columns, "缺少 superplasticizer_dosage 列"

# 重命名 + 新增目标列
df = df.rename(columns={"target_slump": "feature_slump"})
df["target_superplasticizer_dosage"] = df["superplasticizer_dosage"]

print("after :", df.shape, "cols:", list(df.columns)[-4:])
print("feature_slump 缺失:", df["feature_slump"].isna().sum())
print("target_superplasticizer_dosage 缺失:", df["target_superplasticizer_dosage"].isna().sum())
print("head:", df[["superplasticizer_dosage", "feature_slump", "target_superplasticizer_dosage"]].head(5).to_dict("records"))

df.to_excel(DST, index=False)
print(f"已保存: {DST}")