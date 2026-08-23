// 功能配置方法集（从 SystemService.js 拆分，行为不变）
// Vision / WebSearch / WebFetch / MinerU / AcademicSearch / WorkspaceRefresh 七组 get-save-clear，
// 经 SystemService.prototype 挂载；内部经 this.getParamByName/this.setParam 读写参数表。

  /**
   * 读取视觉模型配置
   * @returns {Promise<{enabled: boolean, apiUrl: string|null, apiKey: string|null, model: string|null, maxDimension: number, maxSizeMb: number}>}
   */
  async function getVisionConfig() {
    const [enabled, apiUrl, apiKey, model, maxDim, maxSize] = await Promise.all([
      this.getParamByName('visionEnabled'),
      this.getParamByName('visionApiUrl'),
      this.getParamByName('visionApiKey'),
      this.getParamByName('visionModel'),
      this.getParamByName('visionMaxDimension'),
      this.getParamByName('visionMaxSizeMb')
    ])
    return {
      enabled: enabled?.value === 'true',
      apiUrl: apiUrl?.value || null,
      apiKey: apiKey?.value || null,
      model: model?.value || null,
      maxDimension: maxDim?.value ? parseInt(maxDim.value, 10) : 1024,
      maxSizeMb: maxSize?.value ? parseInt(maxSize.value, 10) : 10
    }
  }

  /**
   * 保存视觉模型配置（仅写入传入的字段，其他字段保留不变）
   * @param {object} cfg - {enabled?, apiUrl?, apiKey?, model?, maxDimension?, maxSizeMb?}
   * @returns {Promise<void>}
   */
  async function saveVisionConfig(cfg = {}) {
    const writes = []
    if (cfg.enabled !== undefined) {
      writes.push(this.setParam('visionEnabled', String(!!cfg.enabled), 'ai', '视觉模型功能开关'))
    }
    if (cfg.apiUrl !== undefined) {
      writes.push(this.setParam('visionApiUrl', cfg.apiUrl || '', 'ai', '视觉模型 API 基础地址'))
    }
    if (cfg.apiKey !== undefined) {
      writes.push(this.setParam('visionApiKey', cfg.apiKey || '', 'ai', '视觉模型 API 密钥'))
    }
    if (cfg.model !== undefined) {
      writes.push(this.setParam('visionModel', cfg.model || '', 'ai', '视觉模型名称'))
    }
    if (cfg.maxDimension !== undefined) {
      writes.push(this.setParam('visionMaxDimension', String(cfg.maxDimension), 'ai', '图片最大边长(px)'))
    }
    if (cfg.maxSizeMb !== undefined) {
      writes.push(this.setParam('visionMaxSizeMb', String(cfg.maxSizeMb), 'ai', '图片最大文件大小(MB)'))
    }
    await Promise.all(writes)
  }

  /**
   * 清除视觉模型配置（重置为默认值）
   * @returns {Promise<void>}
   */
  async function clearVisionConfig() {
    await this.saveVisionConfig({
      enabled: false,
      apiUrl: '',
      apiKey: '',
      model: '',
      maxDimension: 1024,
      maxSizeMb: 10
    })
  }

  /**
   * 获取联网搜索配置
   * @returns {Promise<{enabled: boolean, provider: string, apiKey: string|null}>}
   */
  async function getWebSearchConfig() {
    const [enabled, provider, apiKey] = await Promise.all([
      this.getParamByName('webSearchEnabled'),
      this.getParamByName('webSearchProvider'),
      this.getParamByName('webSearchApiKey')
    ])
    return {
      enabled: enabled?.value === 'true',
      provider: provider?.value || 'bocha',
      apiKey: apiKey?.value || null
    }
  }

  /**
   * 保存联网搜索配置（仅写入传入的字段，其他字段保留不变）
   * @param {object} cfg - {enabled?, provider?, apiKey?}
   * @returns {Promise<void>}
   */
  async function saveWebSearchConfig(cfg = {}) {
    const writes = []
    if (cfg.enabled !== undefined) {
      writes.push(this.setParam('webSearchEnabled', String(!!cfg.enabled), 'ai', '联网搜索功能开关'))
    }
    if (cfg.provider !== undefined) {
      writes.push(this.setParam('webSearchProvider', cfg.provider || 'bocha', 'ai', '搜索服务商（bocha/tavily）'))
    }
    if (cfg.apiKey !== undefined) {
      writes.push(this.setParam('webSearchApiKey', cfg.apiKey || '', 'ai', '搜索 API 密钥'))
    }
    await Promise.all(writes)
  }

  /**
   * 清除联网搜索配置（关闭并清空 key，provider 保留默认）
   * @returns {Promise<void>}
   */
  async function clearWebSearchConfig() {
    await this.saveWebSearchConfig({ enabled: false, apiKey: '' })
  }

  /**
   * 获取网页抓取配置（v0.8.x 新增，配合 web_fetch 技能）
   * 注意：web_fetch 不单独存 key，tinyfish 复用 web_search 的 apiKey
   * @returns {Promise<{enabled: boolean, provider: string}>}  provider: auto|jina|tinyfish
   */
  async function getWebFetchConfig() {
    const [enabled, provider] = await Promise.all([
      this.getParamByName('webFetchEnabled'),
      this.getParamByName('webFetchProvider')
    ])
    return {
      enabled: enabled?.value !== 'false',  // 默认 true（未初始化时也视为开启）
      provider: provider?.value || 'auto'
    }
  }

  /**
   * 保存网页抓取配置（仅写入传入字段，其他保留不变）
   * @param {object} cfg - {enabled?, provider?}
   * @returns {Promise<void>}
   */
  async function saveWebFetchConfig(cfg = {}) {
    const writes = []
    if (cfg.enabled !== undefined) {
      writes.push(this.setParam('webFetchEnabled', String(!!cfg.enabled), 'ai', '网页抓取功能开关'))
    }
    if (cfg.provider !== undefined) {
      writes.push(this.setParam('webFetchProvider', cfg.provider || 'auto', 'ai', '网页抓取服务商（auto/jina/tinyfish）'))
    }
    await Promise.all(writes)
  }

  /**
   * 清除网页抓取配置（恢复默认：provider=auto, enabled=true）
   * @returns {Promise<void>}
   */
  async function clearWebFetchConfig() {
    await this.saveWebFetchConfig({ provider: 'auto', enabled: true })
  }

  /**
   * 获取 MinerU 配置（v0.7.0）
   * 仅管理用户个人 Token；内置 Token 由 mineruBuiltinToken.js 提供，不入库
   * @returns {Promise<{userToken: string|null}>}
   */
  async function getMineruConfig() {
    const userToken = await this.getParamByName('mineruUserToken')
    return {
      userToken: userToken?.value || null
    }
  }

  /**
   * 保存 MinerU 配置（仅写入传入字段）
   * @param {object} cfg - {userToken?}
   * @returns {Promise<void>}
   */
  async function saveMineruConfig(cfg = {}) {
    const writes = []
    if (cfg.userToken !== undefined) {
      writes.push(this.setParam('mineruUserToken', cfg.userToken || '', 'ai', 'MinerU 用户个人 Token'))
    }
    await Promise.all(writes)
  }

  /**
   * 清除 MinerU 用户配置（清空个人 Token，回退到内置 Token）
   * @returns {Promise<void>}
   */
  async function clearMineruConfig() {
    await this.saveMineruConfig({ userToken: '' })
  }

  /**
   * 获取学术搜索配置（v11.2.0）
   * @returns {Promise<{provider: string, arxivFallback: boolean}>}
   */
  async function getAcademicSearchConfig() {
    const [provider, arxiv] = await Promise.all([
      this.getParamByName('academicSearchProvider'),
      this.getParamByName('academicSearchArxivFallback')
    ])
    return {
      provider: provider?.value || 'semantic_scholar',
      arxivFallback: arxiv?.value !== 'false'  // 默认 true
    }
  }

  /**
   * 保存学术搜索配置（仅写入传入的字段，其他字段保留不变）
   * @param {object} cfg - {provider?, arxivFallback?}
   * @returns {Promise<{provider: string, arxivFallback: boolean}>}
   */
  async function saveAcademicSearchConfig(cfg = {}) {
    const writes = []
    if (cfg.provider !== undefined) {
      writes.push(this.setParam('academicSearchProvider', cfg.provider || 'semantic_scholar', 'ai', '学术搜索服务商（semantic_scholar/openalex）'))
    }
    if (cfg.arxivFallback !== undefined) {
      writes.push(this.setParam('academicSearchArxivFallback', String(!!cfg.arxivFallback), 'ai', '学术搜索是否启用 arxiv 预印本兜底'))
    }
    await Promise.all(writes)
    return await this.getAcademicSearchConfig()
  }

  /**
   * 清除学术搜索配置（恢复默认：provider=semantic_scholar, arxivFallback=true）
   * @returns {Promise<{provider: string, arxivFallback: boolean}>}
   */
  async function clearAcademicSearchConfig() {
    return await this.saveAcademicSearchConfig({
      provider: 'semantic_scholar',
      arxivFallback: true
    })
  }

  /**
   * 读取知识库刷新配置（v11.4.0 知识库刷新）
   * @returns {Promise<{demoteFactor:number, upsertThreshold:number}>}
   */
  async function getWorkspaceRefreshConfig() {
    const [demote, threshold] = await Promise.all([
      this.getParamByName('kbDemoteFactor'),
      this.getParamByName('kbUpsertThreshold')
    ])
    // 注意：getParamByName 返回 {value} 对象（或 null），不是裸值
    return {
      demoteFactor: demote?.value != null && demote.value !== '' ? Number(demote.value) : 0.8,
      upsertThreshold: threshold?.value != null && threshold.value !== '' ? Number(threshold.value) : 0.75
    }
  }

  /**
   * 保存知识库刷新配置
   * @param {object} cfg - {demoteFactor?, upsertThreshold?}
   */
  async function saveWorkspaceRefreshConfig(cfg = {}) {
    const writes = []
    if (cfg.demoteFactor !== undefined) {
      writes.push(this.setParam('kbDemoteFactor', String(cfg.demoteFactor), 'ai', 'answer 命中降权系数'))
    }
    if (cfg.upsertThreshold !== undefined) {
      writes.push(this.setParam('kbUpsertThreshold', String(cfg.upsertThreshold), 'ai', 'recordAnswer 查重覆盖阈值'))
    }
    await Promise.all(writes)
  }

module.exports = {
  getVisionConfig, saveVisionConfig, clearVisionConfig,
  getWebSearchConfig, saveWebSearchConfig, clearWebSearchConfig,
  getWebFetchConfig, saveWebFetchConfig, clearWebFetchConfig,
  getMineruConfig, saveMineruConfig, clearMineruConfig,
  getAcademicSearchConfig, saveAcademicSearchConfig, clearAcademicSearchConfig,
  getWorkspaceRefreshConfig, saveWorkspaceRefreshConfig
}
