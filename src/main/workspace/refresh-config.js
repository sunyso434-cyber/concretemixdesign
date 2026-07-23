// 知识库刷新：集中管理可调参数 + 反向关系语义映射
// - 默认值内置；运行时读 SystemService 单例覆盖（读不到/测试环境用默认）
const DEFAULTS = {
  demoteFactor: 0.8,      // answer 命中降权系数（0-1，越小越靠后）
  upsertThreshold: 0.75   // recordAnswer 查重覆盖阈值（top1 相似度 >= 则覆盖）
}

// 正向关系 → 反向关系（C3 语义保真）；未知回退「被引用」
const REVERSE_RELATION_MAP = {
  引用: '被引用',
  补充: '被补充',
  反驳: '被反驳',
  对比: '对比'  // 对称关系，不加「被」
}

async function getRefreshConfig() {
  try {
    // SystemService 是单例实例（module.exports = new SystemService()）
    const systemService = require('../services/SystemService')
    if (systemService && typeof systemService.getWorkspaceRefreshConfig === 'function') {
      const cfg = await systemService.getWorkspaceRefreshConfig()
      return {
        demoteFactor: typeof cfg.demoteFactor === 'number' ? cfg.demoteFactor : DEFAULTS.demoteFactor,
        upsertThreshold: typeof cfg.upsertThreshold === 'number' ? cfg.upsertThreshold : DEFAULTS.upsertThreshold,
        reverseRelationMap: REVERSE_RELATION_MAP
      }
    }
  } catch {
    // 读配置失败（测试环境无 DB 等）→ 默认值
  }
  return { ...DEFAULTS, reverseRelationMap: REVERSE_RELATION_MAP }
}

module.exports = { getRefreshConfig, DEFAULTS, REVERSE_RELATION_MAP }