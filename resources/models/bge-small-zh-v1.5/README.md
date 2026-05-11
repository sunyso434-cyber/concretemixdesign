# bge-small-zh-v1.5 ONNX 模型

本目录用于存放 BGE Small Chinese v1.5 的 ONNX 格式模型文件。

## 需要手动下载

由于模型文件较大（约 90MB），需要手动下载并放置到此目录中。

### 下载步骤

1. 访问 Hugging Face 模型仓库：https://huggingface.co/BAAI/bge-small-zh-v1.5
2. 下载 ONNX 格式的模型文件，需要以下文件：
   - `model.onnx` — 模型权重文件
   - `tokenizer.json` — 分词器配置
   - `tokenizer_config.json` — 分词器配置文件
   - `config.json` — 模型配置文件
   - `special_tokens_map.json` — 特殊 token 映射

### 也可以使用 Optimum 转换

如果仓库中没有直接提供 ONNX 文件，可以使用 `optimum` 工具从 PyTorch 模型转换：

```bash
pip install optimum[onnxruntime]
python -m optimum.exporters.onnx --model BAAI/bge-small-zh-v1.5 ./resources/models/bge-small-zh-v1.5/
```

### 模型用途

该模型用于文本向量化（embedding），支持中文语义搜索和相似度计算，在项目中配合 `onnxruntime-node` 进行本地推理。