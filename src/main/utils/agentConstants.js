/**
 * Agent 配置共享常量
 *
 * 这些常量被 DeepSeekService、UnifiedStrategy 等多个模块共同使用，
 * 集中在此处避免 fallback 默认值不一致。
 */

// Agent 工具调用循环默认最大步数（与 SystemService 默认值一致）
const DEFAULT_AGENT_MAX_STEPS = 200

// Agent 配置缓存 TTL（毫秒）
const AGENT_CONFIG_CACHE_TTL_MS = 5000

module.exports = {
  DEFAULT_AGENT_MAX_STEPS,
  AGENT_CONFIG_CACHE_TTL_MS
}
