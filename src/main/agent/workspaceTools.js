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
    skill('workspace_search', '在工作区 wiki + chat-history 中检索相关文档。返回 topK 个 SearchHit 列表。',
      {
        query: { type: 'string', description: '搜索关键词（支持中文 2-gram）', required: true },
        topK: { type: 'number', description: '返回条数', required: false, min: 1, max: 50, default: 5 }
      },
      (args) => getWiki().search(args.query, args.topK || 5)
    ),
    skill('workspace_grep', '在 wiki 全文中按正则精确匹配，返回每个命中行的行号 + 上下文（对齐 ripgrep / Claude Code 的 grep 工具）。**与 workspace_search 的区别**：search 是 BM25 语义模糊匹配，找"相关文档"用；grep 是精确字符串/正则匹配，找"具体位置"用。建议工作流：先用 workspace_grep 定位命中行，再用 workspace_readPage 拿完整段落。多关键字用 | 分隔（正则 OR）。',
      {
        pattern: { type: 'string', description: '正则表达式（精确字符串是其特例）。多关键字用 | 分隔，如 "水胶比|耐久性"', required: true },
        path: {
          type: 'string',
          description: '搜索范围：sources（wiki/sources 目录，默认）、answers（wiki/answers 目录）、all（两者都搜）',
          required: false, default: 'sources',
          enum: ['sources', 'answers', 'all']
        },
        glob: { type: 'string', description: '文件名过滤，如 *.md（默认）、*.{md,json}', required: false, default: '*.md' },
        output_mode: {
          type: 'string',
          description: '输出模式：content=返回行号+上下文（默认）；files_with_matches=仅返回命中文件路径；count=返回每文件命中数',
          required: false, default: 'content',
          enum: ['content', 'files_with_matches', 'count']
        },
        ignore_case: { type: 'boolean', description: '忽略大小写（默认 false）', required: false, default: false },
        A: { type: 'integer', description: '命中行后保留行数（-A），0-50，默认 2', required: false, min: 0, max: 50, default: 2 },
        B: { type: 'integer', description: '命中行前保留行数（-B），0-50，默认 2', required: false, min: 0, max: 50, default: 2 },
        head_limit: { type: 'integer', description: '最多返回多少条命中，1-1000，默认 100', required: false, min: 1, max: 1000, default: 100 }
      },
      (args) => getWiki().grep(args.pattern, {
        path: args.path,
        glob: args.glob,
        output_mode: args.output_mode,
        ignore_case: args.ignore_case,
        A: args.A,
        B: args.B,
        head_limit: args.head_limit
      })
    ),
    skill('workspace_readPage', '读 wiki 页。3 种读取模式：**1. 按行读（推荐配合 grep）**：传 offset+limit 按行切片；**2. 相关段读（默认）**：传 query 走 BM25 相关段落过滤；**3. 全文读**：depth=full。注意：search 返回结果已含 summary/keyPoints，大多数情况不需要调 readPage。',
      {
        wikiPath: { type: 'string', description: 'wiki 页相对路径（如 sources/jgj-55-2011.md）', required: true },
        offset: {
          type: 'integer',
          description: '起始行号（1-based）。传入即启用按行读取模式，跳过段过滤/全文截断。行号对齐 workspace_grep 返回的 lineNumber。不传走 query/depth 模式',
          required: false, min: 1
        },
        limit: {
          type: 'integer',
          description: '读取多少行（仅 offset 模式生效）。默认 1000，最大 5000',
          required: false, min: 1, max: 5000, default: 1000
        },
        query: {
          type: 'string',
          description: '相关性关键词（仅 offset 未传时生效）。传入后仅返回与查询相关的段落（depth=relevant）。不传则 fallthrough 到 _readPageFull（300KB 截断全文）。',
          required: false
        },
        contextLines: {
          type: 'integer',
          description: '命中段前后保留的上下文行数（仅 query 模式生效）',
          required: false, min: 0, max: 50, default: 5
        },
        depth: {
          type: 'string',
          description: '读取深度（仅 offset 未传时生效）。relevant=返回相关段落原文（默认）；full=返回全文+LLM摘要；auto=默认relevant',
          required: false, default: 'auto',
          enum: ['relevant', 'full', 'auto']
        }
      },
      (args) => getWiki().readPage(args.wikiPath, {
        offset: args.offset,
        limit: args.limit,
        query: args.query,
        contextLines: args.contextLines,
        depth: args.depth
      })
    ),
    skill('workspace_ingest', '把工作区根目录的原始文件（PDF/Word/Excel/MD/CSV）ingest 到 wiki。',
      {
        filename: { type: 'string', description: '工作区根目录下的文件名', required: true }
      },
      (args) => getWiki().ingest(args)
    ),
    skill('workspace_writeFile', '把报告/数据写入工作区 reports/，支持 docx/xlsx/md 3 种格式。**新增 style 参数**：用户可临时指定报告格式（字体/颜色/页面），不传则使用默认公文样式。payload 结构（必须包含 sections 数组）：{ title: "报告标题", sections: [ { type: "h1"|"h2", content: "标题文字" }, { type: "p", content: "段落正文" }, { type: "list", items: ["项1", "项2"] }, { type: "table", rows: [["列1","列2"],["数据1","数据2"]] }, { type: "code", language: "js", code: "console.log(1)" } ], metadata?: { 任意key: "value" } }。type 字段：docx → 写 .docx；xlsx → 写 .xlsx；md 或 markdown → 写 .md。',
      {
        type: { type: 'string', description: '文件类型', required: true, enum: ['docx', 'xlsx', 'md'] },
        filename: { type: 'string', description: '文件名（含后缀）', required: true },
        payload: { type: 'object', description: 'payload 结构由 type 决定', required: true },
        style: {
          type: 'object',
          description: '报告样式覆盖（可选）。结构：{ page: { paperSize, orientation, margins }, typography: { titleFont, bodyFont, titleSize, bodySize, lineSpacing }, color: { primary, tableBorder } }。未传字段使用默认公文样式。',
          required: false
        }
      },
      (args, context) => {
        const { mergeStyle } = require('../skills/report-styles')
        const mergedStyle = mergeStyle(args.style)
        return writeHandler.writeFile({
          workspaceManager: getWM(),
          wikiEngine: getWiki(),
          type: args.type,
          filename: args.filename,
          payload: args.payload,
          style: mergedStyle
        })
      }
    ),
    skill('workspace_listFiles', '列出工作区指定子目录下的条目。返回 [{ name, path, size, type: "file"|"dir", ingested?, wikiPage?, lastIngestAt?, quality? }]。**关键：当 subdir="root" 且 withIngestStatus=true 时，每条记录带 ingested:true/false — 用这个字段判断文件是否已摄入到 wiki**，避免凭空猜测。',
      {
        subdir: {
          type: 'string',
          description: '子目录',
          required: true,
          enum: ['root', 'wiki', 'wiki/sources', 'wiki/reports', 'wiki/kg/sources', 'reports', 'chat-history']
        },
        recursive: { type: 'boolean', description: '是否递归列出子目录（默认 false）', required: false, default: false },
        includeDirs: { type: 'boolean', description: '是否包含目录条目（默认 false 仅文件）', required: false, default: false },
        withIngestStatus: { type: 'boolean', description: '是否附加每个文件的 ingested 状态（仅 subdir="root" 有意义，从 .workspace-index.json 读）', required: false, default: false }
      },
      async (args) => ({
        files: await getWM().listFiles(args.subdir, {
          recursive: args.recursive,
          includeDirs: args.includeDirs,
          withIngestStatus: args.withIngestStatus
        })
      })
    ),
    skill('workspace_lint', '跑工作区 wiki 健康检查（孤儿页/缺失 frontmatter/过期摘要）。',
      {},
      () => getWiki().lint()
    ),
    skill('workspace_searchGraph', '查询知识图谱：按关键词找相关实体和关系（论文核心功能）。返回完整三元组（subject-predicate-object）。**P5 阶段启用**——P4 阶段如果未启用会返回 NOT_OPEN 错误。前提：当前工作区必须已打开（workspacePath 由 execute 内部从 global.workspaceManager.current() 读取，LLM 不需要传）。',
      {
        query: { type: 'string', description: '搜索关键词', required: true },
        topK: { type: 'number', description: '返回条数', required: false, min: 1, max: 50, default: 10 }
      },
      async (args) => {
        const kg = getKG()
        if (!kg) {
          throw new WorkspaceError('NOT_OPEN', '知识图谱未启用（P5 阶段才激活）', false)
        }
        const current = getWM().current()
        if (!current || !current.path) {
          throw new WorkspaceError('NOT_OPEN', '请先打开工作区再调用 workspace_searchGraph（当前工作区路径由工具自动读取，LLM 无需传 workspacePath）', false)
        }
        return await kg.searchGraph(args.query, args.topK || 10, current.path)
      }
    )
  ]
}

module.exports = { buildWorkspaceSkills }