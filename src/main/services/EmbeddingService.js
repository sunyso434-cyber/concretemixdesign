const fs = require('fs')
const path = require('path')
const ort = require('onnxruntime-node')

// 模型目录
// __dirname = src/main/services/ → 上溯3层到项目根目录 → resources/models/bge-small-zh-v1.5
const MODEL_DIR = path.join(__dirname, '..', '..', '..', 'resources', 'models', 'bge-small-zh-v1.5')

// 模型参数
const MAX_SEQ_LENGTH = 512
const EMBEDDING_DIM = 512

// BERT 特殊 token
const CLS_TOKEN_ID = 101   // [CLS]
const SEP_TOKEN_ID = 102   // [SEP]
const UNK_TOKEN_ID = 100   // [UNK]
const PAD_TOKEN_ID = 0     // [PAD]

class EmbeddingService {
  constructor() {
    /** @type {ort.InferenceSession|null} */
    this._session = null
    /** @type {Map<string, number>|null} 词汇表：token -> id */
    this._vocab = null
    /** @type {Promise|null} 正在加载的 Promise，防止并发重复加载 */
    this._loading = null
  }

  // ========== 公开方法 ==========

  /**
   * 将单条文本转为 512 维向量
   * @param {string} text 输入文本
   * @returns {Promise<number[]>} 归一化后的向量
   */
  async embed(text) {
    const texts = [text]
    const results = await this.embedBatch(texts)
    return results[0]
  }

  /**
   * 将多条文本转为向量（批量推理）
   * @param {string[]} texts 输入文本数组
   * @returns {Promise<number[][]>} 归一化后的向量数组
   */
  async embedBatch(texts) {
    if (!texts || texts.length === 0) {
      throw new Error('输入文本不能为空')
    }

    // 确保模型已加载
    await this._ensureLoaded()

    // 逐条分词
    const allTokenResults = texts.map(t => this._tokenize(t))

    // 找到批次内最大序列长度（不含 padding）
    const maxLen = Math.max(...allTokenResults.map(r => r.tokenIds.length))

    // 构造 batch 输入
    const batchSize = allTokenResults.length
    const seqLen = maxLen

    const inputIdsData = new BigInt64Array(batchSize * seqLen)
    const attentionMaskData = new BigInt64Array(batchSize * seqLen)

    for (let i = 0; i < batchSize; i++) {
      const { tokenIds } = allTokenResults[i]
      for (let j = 0; j < seqLen; j++) {
        const offset = i * seqLen + j
        if (j < tokenIds.length) {
          inputIdsData[offset] = BigInt(tokenIds[j])
          attentionMaskData[offset] = 1n
        } else {
          // padding 位置
          inputIdsData[offset] = BigInt(PAD_TOKEN_ID)
          attentionMaskData[offset] = 0n
        }
      }
    }

    const inputIdsTensor = new ort.Tensor('int64', inputIdsData, [batchSize, seqLen])
    const attentionMaskTensor = new ort.Tensor('int64', attentionMaskData, [batchSize, seqLen])

    const feeds = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor
    }

    try {
      const results = await this._session.run(feeds)
      // ONNX 输出通常叫 "last_hidden_state"，形状 [batch, seq_len, 512]
      const output = results.last_hidden_state || results[Object.keys(results)[0]]
      const outputData = output.data
      const dims = output.dims

      // 提取每条文本 [CLS] 位置（索引 0）的向量并做 L2 归一化
      const embeddings = []
      for (let i = 0; i < batchSize; i++) {
        const clsVector = []
        for (let d = 0; d < EMBEDDING_DIM; d++) {
          // output 数据是 [batch, seq_len, dim] 展平的
          const idx = i * dims[1] * dims[2] + 0 * dims[2] + d
          clsVector.push(outputData[idx])
        }
        embeddings.push(this._normalize(clsVector))
      }

      return embeddings
    } catch (err) {
      console.error('ONNX 推理失败:', err)
      throw new Error(`向量推理失败: ${err.message}`)
    }
  }

  /**
   * 清除已加载的模型和词汇表缓存，下次调用时会重新加载
   */
  clearCache() {
    if (this._session) {
      this._session.release()
      this._session = null
    }
    this._vocab = null
    this._loading = null
  }

  // ========== 私有方法 ==========

  /**
   * 确保模型和分词器已加载（懒加载 + 并发锁）
   */
  async _ensureLoaded() {
    if (this._session && this._vocab) return

    if (this._loading) return this._loading

    this._loading = this._doLoad()
    try {
      return await this._loading
    } finally {
      this._loading = null
    }
  }

  /**
   * 加载 ONNX 模型会话和分词器词汇表
   */
  async _doLoad() {
    // 检查模型文件是否存在
    const modelPath = path.join(MODEL_DIR, 'model.onnx')
    const tokenizerPath = path.join(MODEL_DIR, 'tokenizer.json')

    if (!fs.existsSync(modelPath)) {
      throw new Error(
        `ONNX 模型文件不存在: ${modelPath}\n` +
        '请参考 resources/models/bge-small-zh-v1.5/README.md 下载模型文件'
      )
    }

    if (!fs.existsSync(tokenizerPath)) {
      throw new Error(
        `分词器文件不存在: ${tokenizerPath}\n` +
        '请参考 resources/models/bge-small-zh-v1.5/README.md 下载分词器文件'
      )
    }

    // 加载 ONNX 模型
    try {
      this._session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu']
      })
      console.log('ONNX 嵌入模型加载成功')
    } catch (err) {
      console.error('ONNX 模型加载失败:', err)
      throw new Error(`ONNX 模型加载失败: ${err.message}`)
    }

    // 加载分词器词汇表
    try {
      const tokenizerRaw = fs.readFileSync(tokenizerPath, 'utf-8')
      const tokenizerData = JSON.parse(tokenizerRaw)
      this._vocab = this._parseVocab(tokenizerData)
      console.log(`分词器加载成功，词汇量: ${this._vocab.size}`)
    } catch (err) {
      console.error('分词器加载失败:', err)
      throw new Error(`分词器加载失败: ${err.message}`)
    }
  }

  /**
   * 从 tokenizer.json 中解析词汇表
   * 支持 HuggingFace 标准格式和精简格式
   * @param {object} tokenizerData
   * @returns {Map<string, number>}
   */
  _parseVocab(tokenizerData) {
    const vocab = new Map()

    // 格式1：HuggingFace 标准 tokenizer.json 格式
    // { model: { vocab: { "token": id } } }
    if (tokenizerData.model && tokenizerData.model.vocab) {
      for (const [token, id] of Object.entries(tokenizerData.model.vocab)) {
        vocab.set(token, id)
      }
      return vocab
    }

    // 格式2：直接的 vocab 对象 { "token": id }
    if (typeof tokenizerData === 'object' && !tokenizerData.model) {
      for (const [token, id] of Object.entries(tokenizerData)) {
        if (typeof id === 'number') {
          vocab.set(token, id)
        }
      }
      if (vocab.size > 0) return vocab
    }

    throw new Error('无法从 tokenizer.json 中解析词汇表，格式不支持')
  }

  /**
   * BERT 风格分词：中文按字符级 + 词汇表前向最大匹配
   * 结果包含 [CLS] ... [SEP]，截断到 MAX_SEQ_LENGTH
   * @param {string} text
   * @returns {{ tokenIds: number[], tokens: string[] }}
   */
  _tokenize(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('输入文本必须是非空字符串')
    }

    // 先对文本做基础预处理：统一空白字符
    const cleanText = text.replace(/\s+/g, ' ').trim()

    // 前向最大匹配分词
    const tokens = this._forwardMaxMatch(cleanText)

    // 加入 [CLS] 和 [SEP]，并截断到最大长度
    const tokenIds = [CLS_TOKEN_ID]
    const tokenStrs = ['[CLS]']

    for (const token of tokens) {
      if (tokenIds.length >= MAX_SEQ_LENGTH - 1) break // 留一个位置给 [SEP]
      const id = this._vocab.get(token)
      tokenIds.push(id !== undefined ? id : UNK_TOKEN_ID)
      tokenStrs.push(token)
    }

    // 追加 [SEP]
    tokenIds.push(SEP_TOKEN_ID)
    tokenStrs.push('[SEP]')

    return { tokenIds, tokens: tokenStrs }
  }

  /**
   * 前向最大匹配分词
   * 中文按字符级处理，英文/数字按 ## 续接 BERT 风格处理
   * @param {string} text
   * @returns {string[]}
   */
  _forwardMaxMatch(text) {
    const tokens = []
    let i = 0

    while (i < text.length) {
      const ch = text[i]

      // 空格跳过
      if (ch === ' ') {
        i++
        continue
      }

      // 中文字符：单字为一个 token
      if (/[一-鿿]/.test(ch)) {
        // 先尝试在词汇表中查找单字
        if (this._vocab.has(ch)) {
          tokens.push(ch)
        } else {
          // 单字不在词表中，试试带 ## 前缀
          const withPrefix = '##' + ch
          if (this._vocab.has(withPrefix)) {
            tokens.push(withPrefix)
          } else {
            // 都找不到，直接用单字作为 UNK
            tokens.push(ch)
          }
        }
        i++
        continue
      }

      // 非中文字符（ASCII等）：贪心最大匹配
      // 从最长开始尝试，逐步缩短
      let matched = false
      for (let len = Math.min(MAX_SEQ_LENGTH, text.length - i); len >= 1; len--) {
        const substr = text.substring(i, i + len)
        if (this._vocab.has(substr)) {
          tokens.push(substr)
          i += len
          matched = true
          break
        }
      }

      if (!matched) {
        // 完全找不到匹配，逐字符拆分，非首字符加 ## 前缀（BERT 子词风格）
        for (let j = 0; j < ch.length; j++) {
          const subCh = j === 0 ? ch : ('##' + ch[j])
          tokens.push(subCh)
        }
        i++
      }
    }

    return tokens
  }

  /**
   * L2 归一化向量
   * @param {number[]} vector
   * @returns {number[]}
   */
  _normalize(vector) {
    let norm = 0
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i]
    }
    norm = Math.sqrt(norm)

    // 防止除零
    if (norm < 1e-12) {
      return vector
    }

    return vector.map(v => v / norm)
  }
}

module.exports = new EmbeddingService()