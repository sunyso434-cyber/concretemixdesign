/**
 * v1.5.3 关键：7 个 workspace 工具作为伪 Skill 注册
 *
 * 为什么是伪 Skill 而不是 registerTool：
 * - 现有 Orchestrator 没有 registerTool 方法
 * - 现有 SkillExecutor.execute(skillName, args) 统一入口，依赖 skillRegistry
 * - 伪 Skill 走 execute(args, context) 与 18 个 Skill 完全一致
 * - LLM 工具列表来自 getToolSchemas() 单一来源
 *
 * 时序设计：参数注入的 workspaceManager/wikiEngine/kgExtractor 仅作为初始引用，
 * execute 时通过 global.* 重新读取最新值，确保 main.js 完成 workspace 初始化
 * 之后调用一定有效。P5 阶段实例化 kgExtractor 后，调 registerWorkspacePseudoSkills
 * 重新注册以更新闭包即可。
 */

const ErrorCodes = require('./ErrorCodes')
const { WorkspaceError } = require('../workspace/WorkspaceError')
const writeHandler = require('../workspace/write-handler')

function buildWorkspaceSkills({ workspaceManager, wikiEngine, kgExtractor = null }) {
  // v1.5.3 决策：每次 execute 都从 global 拿最新引用
  // （initSkillSystem 早于 workspace 初始化；execute 实际被 LLM 触发时 workspace 已 ready）
  const getWM = () => global.workspaceManager || workspaceManager
  const getWiki = () => global.wikiEngine || wikiEngine
  const getKG = () => global.kgExtractor || kgExtractor

  const skill = (name, description, parameters, invoke) => ({
    name,
    description,
    version: '1.0.0',
    category: 'workspace',
    parameters,
    services: [],  // v1.5.3 关键：不依赖 services（不调任何业务服务）
    async execute(args, context) {
      try {
        return await invoke(args, context)
      } catch (err) {
        // 把 WorkspaceError 转成 Skill 标准返回格式（success:false + errorCode）
        if (err instanceof WorkspaceError) {
          return ErrorCodes.createError(err.code, err.message, err.hint || '请稍后重试', { retryable: err.retryable })
        }
        return ErrorCodes.createError(ErrorCodes.UNKNOWN, err.message, '请稍后重试', { stack: err.stack })
      }
    }
  })

  return [
    skill('workspace.search', '在工作区 wiki + chat-history 中检索相关文档。返回 topK 个 SearchHit 列表。',
      {
        query: { type: 'string', description: '搜索关键词（支持中文 2-gram）', required: true },
        topK: { type: 'number', description: '返回条数', required: false, min: 1, max: 50, default: 5 }
      },
      (args) => getWiki().search(args.query, args.topK || 5)
    ),
    skill('workspace.readPage', '读 wiki 页全文 + frontmatter 字段。',
      {
        wikiPath: { type: 'string', description: 'wiki 页相对路径（如 sources/jgj-55-2011.md）', required: true }
      },
      (args) => getWiki().readPage(args.wikiPath)
    ),
    skill('workspace.ingest', '把工作区根目录的原始文件（PDF/Word/Excel/MD/CSV）ingest 到 wiki。',
      {
        filename: { type: 'string', description: '工作区根目录下的文件名', required: true }
      },
      (args) => getWiki().ingest(args)
    ),
    skill('workspace.writeFile', '把报告/数据写入工作区 reports/ 目录，支持 docx/xlsx/md 3 种格式。',
      {
        type: { type: 'string', description: '文件类型', required: true, enum: ['docx', 'xlsx', 'md'] },
        filename: { type: 'string', description: '文件名（含后缀）', required: true },
        payload: { type: 'object', description: 'payload 结构由 type 决定', required: true }
      },
      (args) => writeHandler.writeFile({ workspaceManager: getWM(), type: args.type, filename: args.filename, payload: args.payload })
    ),
    skill('workspace.listFiles', '列出工作区指定子目录下的文件。',
      {
        subdir: { type: 'string', description: '子目录', required: true, enum: ['root', 'wiki', 'reports', 'chat-history'] }
      },
      async (args) => ({ files: await getWM().listFiles(args.subdir) })
    ),
    skill('workspace.lint', '跑工作区 wiki 健康检查（孤儿页/缺失 frontmatter/过期摘要）。',
      {},
      () => getWiki().lint()
    ),
    skill('workspace.searchGraph', '查询知识图谱：按关键词找相关实体和关系（论文核心功能）。返回完整三元组（subject-predicate-object）。**P5 阶段启用**——P4 阶段如果未启用会返回 NOT_OPEN 错误。',
      {
        query: { type: 'string', description: '搜索关键词', required: true },
        topK: { type: 'number', description: '返回条数', required: false, min: 1, max: 50, default: 10 }
      },
      async (args) => {
        const kg = getKG()
        if (!kg) {
          throw new WorkspaceError('NOT_OPEN', '知识图谱未启用（P5 阶段才激活）', false)
        }
        return await kg.searchGraph(args.query, args.topK || 10)
      }
    )
  ]
}

module.exports = { buildWorkspaceSkills }