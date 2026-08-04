/**
 * Soft Skill 触发与注入管理
 *
 * 职责：
 * 1. 监听 user 消息，决定是否激活/退激活某个 soft skill
 * 2. 维护每个会话激活的 skill 状态（一会话最多 1 个，spec 决策 #8）
 * 3. 拼装 Layer 1（描述列表）+ Layer 2（激活 body）+ Layer 3（子文件按需，3000 token 截断）
 *
 * 状态隔离：_activeSkill = Map<sessionId, {skillName, subFilesLoaded:Set}>
 */

const { renderPlaceholders } = require('./mdInstructionBuilder')

const ESTIMATE_CHARS_PER_TOKEN = 3 // 近似：~3 字符/token
const LAYER3_TOKEN_LIMIT = 3000

// 显式退激活短语
const EXIT_PATTERNS = [
  /退出\s*brainstorm/i,
  /退出\s*创新/i,
  /退出\s*当前?/i,
  /算了/i,
  /取消/i,
  /cancel/i,
  /quit/i,
  /退出/i
]

class SoftSkillInjector {
  constructor({ skillRegistry, mdInstructionBuilder, subFileResolver, baseDir }) {
    this.registry = skillRegistry
    this.mdInstructionBuilder = mdInstructionBuilder
    this.subFileResolver = subFileResolver
    this.baseDir = baseDir

    this._activeSkill = new Map()
  }

  /**
   * 每条 user 消息后调用，决定激活/退激活/noop
   * @returns {{activated:boolean, skillName?:string, reason?:string}}
   */
  tryActivate(sessionId, latestUserMessage) {
    const softSkills = this.registry.listSoftSkills() || []
    if (softSkills.length === 0) {
      return { activated: false, reason: 'no_soft_skills' }
    }

    const active = this._activeSkill.get(sessionId)
    const msg = latestUserMessage || ''

    // 1. 已激活 + 命中退激活短语 → 退激活
    if (active) {
      if (EXIT_PATTERNS.some(p => p.test(msg))) {
        this._activeSkill.delete(sessionId)
        return { activated: false, reason: 'deactivated', skillName: active.skillName }
      }
      return { activated: false, reason: 'noop_already_active' }
    }

    // 2. 未激活 → 尝试匹配
    if (!msg.trim()) {
      return { activated: false, reason: 'no_match' }
    }
    const skill = this._bestMatch(softSkills, msg)
    if (!skill) {
      return { activated: false, reason: 'no_match' }
    }
    // 存 userMessage 进 active 状态，供 _buildActiveSection 渲染 {{param}} 占位符（B-2 参数来源）
    this._activeSkill.set(sessionId, { skillName: skill.name, subFilesLoaded: new Set(), userMessage: msg })
    return { activated: true, skillName: skill.name }
  }

  forceActivate(sessionId, skillName) {
    this._activeSkill.set(sessionId, { skillName, subFilesLoaded: new Set() })
  }

  cleanup(sessionId) {
    this._activeSkill.delete(sessionId)
  }

  /**
   * 拼装注入段。未激活 → 同步返回 ''；激活 → 返回 Promise<string>。
   * Layer 3 在此按 3000 token 截断（绝不交给 messageTrimmer 截系统消息）。
   */
  buildInjectionSection(sessionId) {
    const active = this._activeSkill.get(sessionId)
    if (!active) return ''
    return this._buildActiveSection(active)
  }

  async _buildActiveSection(active) {
    const softSkills = this.registry.listSoftSkills() || []

    // Layer 1：所有 soft skill 完整 description
    const layer1 = softSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')

    // Layer 2：激活 skill 的 body（渲染 {{param}} 占位符，用激活时存的 userMessage 作 args）
    // 找不到对应值的占位符原样保留，让 LLM 知道这是待填参数
    const skill = this.registry.getSkill(active.skillName)
    const rawBody = (skill && skill._mdBody) || ''
    const body = renderPlaceholders(rawBody, { userMessage: active.userMessage || '' })
    let layer23 = `\n## 🔓 ACTIVE SKILL: ${active.skillName}\n（本次会话期间生效）\n${body}\n`

    // Layer 3：解析子文件引用，按需加载，3000 token 截断
    const refs = this.mdInstructionBuilder.parseSubFileRefs(body) || []
    if (refs.length > 0) {
      let layer3 = ''
      let tokenAcc = 0
      for (const ref of refs) {
        if (tokenAcc >= LAYER3_TOKEN_LIMIT) {
          layer3 += `\n（后续子文件已截断）\n`
          break
        }
        const result = await this.subFileResolver.loadSubFile(active.skillName, ref, this.baseDir)
        // ponytail: 加载失败（子目录/子文件缺失，M1）统一静默跳过——调用方无需区分
        if (result && result.success) {
          layer3 += `\n### ${ref}\n${result.content}\n`
          tokenAcc += result.content.length / ESTIMATE_CHARS_PER_TOKEN
          active.subFilesLoaded.add(ref)
        }
      }
      if (layer3) layer23 += `\n## Sub-Files (Layer 3)\n${layer3}`
    }

    return `${layer1}${layer23}`
  }

  /**
   * 关键词重叠打分选最佳 skill；全 0 分时返回 null（不兜底硬塞第一个）。
   * 修复 P0：旧实现 bestScore 初值 -1，任何 skill 得分 >=0 都 > -1 被选中，
   * 导致无关消息也强行激活第一个 soft skill。改为初值 0，仅 score > 0 才选中。
   */
  _bestMatch(softSkills, message) {
    const msg = message.toLowerCase()
    let best = null
    let bestScore = 0
    for (const skill of softSkills) {
      const score = this._tokens(skill.description).filter(t => msg.includes(t)).length
      if (score > bestScore) {
        best = skill
        bestScore = score
      }
    }
    return best
  }

  // 提取匹配 token：中文 2-gram + 长度≥3 的拉丁词
  _tokens(desc) {
    const text = (desc || '').toLowerCase()
    const tokens = []
    for (const run of text.match(/[一-龥]+/g) || []) {
      for (let i = 0; i + 2 <= run.length; i++) tokens.push(run.slice(i, i + 2))
    }
    for (const w of text.match(/[a-z0-9]{3,}/g) || []) tokens.push(w)
    return tokens
  }
}

module.exports = SoftSkillInjector
