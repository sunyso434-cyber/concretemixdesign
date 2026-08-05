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

const fs = require('fs')
const path = require('path')
const ErrorCodes = require('./ErrorCodes')
const { WorkspaceError } = require('../workspace/WorkspaceError')
const writeHandler = require('../workspace/write-handler')
const imageIngest = require('../workspace/imageIngest')

function buildWorkspaceSkills({ workspaceManager, wikiEngine, kgExtractor = null }) {
  // v1.5.3 决策：每次 execute 都从 global 拿最新引用
  // （initSkillSystem 早于 workspace 初始化；execute 实际被 LLM 触发时 workspace 已 ready）
  const getWM = () => global.workspaceManager || workspaceManager
  const getWiki = () => global.wikiEngine || wikiEngine
  const getKG = () => global.kgExtractor || kgExtractor

  const skill = (name, description, parameters, invoke, isWrite = false) => ({
    name,
    description,
    version: '1.0.0',
    category: 'workspace',
    parameters,
    services: [],  // v1.5.3 关键：不依赖 services（不调任何业务服务）
    isWrite,  // v2.x.x 关键：标记写操作（写盘/改文件），读操作默认 false
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
          description: '搜索范围：sources（wiki/sources 目录，默认）、answers（wiki/answers 目录）、all（两者都搜）、raw（raw 原始文件目录全部子目录）、root（整个工作区根目录所有文本文件，含 raw）',
          required: false, default: 'sources',
          enum: ['sources', 'answers', 'all', 'raw', 'root']
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
    skill('workspace_ingest', '把工作区根目录的原始文件（PDF/Word/Excel/MD/CSV/图片）ingest 到 wiki。图片走 OCR 分支，自动调用视觉模型提取文字 + 描述后入 wiki 索引。',
      {
        filename: { type: 'string', description: '工作区根目录下的文件名（支持 .pdf .docx .xlsx .xls .md .txt .csv .png .jpg .jpeg .webp）', required: true }
      },
      async (args, context) => {
        // v9.1.0 修复：识别图片扩展名，走 imageIngest OCR 分支
        // - 旧实现直接调 WikiEngine.ingest()，但 WikiEngine 调 reader.read()，
        //   readers 调度器不支持 png/jpg/jpeg/webp，会抛 "Unsupported file type: .png"
        // - 新实现：图片走 WorkspaceManager._ingestImageAsync（OCR + 入 wiki），其他文件走原 WikiEngine.ingest
        if (imageIngest.isImageFile(args.filename)) {
          const wm = getWM()
          const current = wm.current()
          if (!current || !current.path) {
            throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
          }
          const path = require('path')
          const imagePath = path.posix.join(current.path, args.filename)
          const result = await wm._ingestImageAsync(imagePath)
          if (!result) {
            throw new WorkspaceError('IMAGE_INGEST_FAIL', '图片 ingest 失败（视觉模型未配置或 OCR 失败）', true)
          }
          return { success: true, type: 'image', ...result }
        }
        return getWiki().ingest(args)
      },
      true
    ),
    skill('workspace_writeFile', '把 Markdown 报告写入工作区 reports/。**两种模式**：\n1. **payload 模式**（默认）：传入 payload 含 title+sections 数组，整文件覆盖写入。\n2. **patches 模式**（v10.2.0）：只传 patches 不传 payload，局部修改已存在的 .md 报告。每个 patch 含 find(旧文本)、replace(新文本)、replaceAll(默认false)。\npayload 结构（必须包含 sections 数组）：{ title: "报告标题", sections: [ { type: "h1"|"h2", content: "标题文字" }, { type: "p", content: "段落正文" }, { type: "list", items: ["项1", "项2"] }, { type: "table", rows: [["列1","列2"],["数据1","数据2"]] }, { type: "code", language: "js", code: "console.log(1)" }, { type: "image", path: "reports/_images/xxx.svg", alt: "图表标题" } ], metadata?: { 任意key: "value" } }。\n**v0.3.1 新增 image 段落**：path 用 workspace_analyze 返回的 chart.svgRelPath。\n**重要：仅支持 md 格式。docx/xlsx 请使用 officecli 系列技能（create_office_file + edit_office_file）生成。**',
      {
        type: { type: 'string', description: '文件类型（仅支持 md）', required: true, enum: ['md'] },
        filename: { type: 'string', description: '文件名（含后缀）', required: true },
        payload: { type: 'object', description: 'payload 结构由 type 决定。patches 模式下忽略', required: false },
        patches: {
          type: 'array',
          description: '【v10.2.0】局部修改模式（仅 .md/.markdown 支持）。结构：[{ find: "旧文本", replace: "新文本", replaceAll: false }]。传了 patches 就不要再传 payload（payload 会被忽略）。',
          required: false,
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: '要替换的旧文本（精确匹配）', required: true },
              replace: { type: 'string', description: '新文本', required: true },
              replaceAll: { type: 'boolean', description: '替换所有出现位置（默认 false）', required: false, default: false }
            }
          }
        },
        style: {
          type: 'object',
          description: '报告样式覆盖（可选）。结构：{ page: { paperSize, orientation, margins }, typography: { titleFont, bodyFont, titleSize, bodySize, lineSpacing }, color: { primary, tableBorder } }。未传字段使用默认公文样式。',
          required: false
        },
        folder: {
          type: 'string',
          description: '可选归档文件夹（如 "XX项目" 或 "XX项目/2026"，创建在 reports/ 下）。指定后报告写入 reports/<folder>/（自动建目录）；不传则写入 reports/ 根目录',
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
          patches: args.patches,
          style: mergedStyle,
          folder: args.folder
        })
      },
      true
    ),
    skill('workspace_mkdir', '在工作区 reports/ 下创建归档文件夹（文件夹名称由用户自定义，用于按文件夹归档报告）。用户说"建一个 XX 文件夹放报告"/"创建归档文件夹"时调用。重复创建返回已存在，不报错。',
      {
        folder: {
          type: 'string',
          description: '文件夹名称（如 "XX项目" 或 "XX项目/2026"），将创建在工作区 reports/ 下',
          required: true
        }
      },
      async (args) => {
        const { normalizeReportFolder } = writeHandler
        const folderRel = normalizeReportFolder(args.folder)
        if (folderRel === null || folderRel === '') {
          throw new WorkspaceError('E-PARAM-INVALID', `文件夹名称非法：${args.folder}（不允许 ..、绝对路径、\\ 等）`, false)
        }
        const current = getWM().current()
        if (!current || !current.path) {
          throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
        }
        const dir = path.posix.join(current.path, 'reports', folderRel)
        await fs.promises.mkdir(dir, { recursive: true })
        return { ok: true, folder: folderRel, path: dir }
      },
      true
    ),
    skill('workspace_archiveReports', '把 reports/ 根目录下的报告移动到指定的归档文件夹（reports/<folder>/），用于整理散落的旧报告。用户说"把报告归档到 XX"/"整理 reports"时调用。',
      {
        folder: {
          type: 'string',
          description: '目标归档文件夹名（如 "XX项目"），将创建在工作区 reports/ 下',
          required: true
        },
        files: {
          type: 'array',
          description: '要移动的报告文件名列表（不含路径，只支持 reports/ 根目录下的文件，如 ["报告A.md","报告B.docx"]）。不传则移动根目录下全部报告',
          required: false,
          items: { type: 'string' }
        }
      },
      async (args) => {
        const { normalizeReportFolder } = writeHandler
        const folderRel = normalizeReportFolder(args.folder)
        if (folderRel === null || folderRel === '') {
          throw new WorkspaceError('E-PARAM-INVALID', `文件夹名称非法：${args.folder}（不允许 ..、绝对路径、\\ 等）`, false)
        }
        const current = getWM().current()
        if (!current || !current.path) {
          throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
        }
        const reportsDir = path.posix.join(current.path, 'reports')
        const targetDir = path.posix.join(reportsDir, folderRel)
        await fs.promises.mkdir(targetDir, { recursive: true })

        // 收集根目录文件（文件 + 去重；忽略目录、备份文件 .bak.）
        const entries = await fs.promises.readdir(reportsDir, { withFileTypes: true })
        const rootFiles = entries
          .filter(e => e.isFile() && !e.name.includes('.bak.'))
          .map(e => e.name)
        const wanted = Array.isArray(args.files) && args.files.length > 0
          ? args.files.filter(f => rootFiles.includes(f))
          : rootFiles

        const moved = []
        const skipped = []
        for (const name of wanted) {
          const src = path.posix.join(reportsDir, name)
          // 防重名：目标已存在 → 加 _1 _2 后缀（与 workspace_organize 一致）
          let destName = name
          let dest = path.posix.join(targetDir, destName)
          let n = 1
          while (fs.existsSync(dest)) {
            const ext = path.extname(name)
            destName = `${path.basename(name, ext)}_${n}${ext}`
            dest = path.posix.join(targetDir, destName)
            n++
          }
          try {
            await fs.promises.rename(src, dest)
            moved.push({ name, dest: destName, path: dest })
          } catch (err) {
            skipped.push({ name, error: err.message })
          }
        }
        return { ok: true, folder: folderRel, moved, skipped, total: wanted.length }
      },
      true
    ),
    skill('workspace_listFiles', '列出工作区指定子目录下的条目。返回 [{ name, path, size, type: "file"|"dir", ingested?, wikiPage?, lastIngestAt?, quality? }]。**关键：当 subdir="root" 且 withIngestStatus=true 时，每条记录带 ingested:true/false — 用这个字段判断文件是否已摄入到 wiki**，避免凭空猜测。v2026-07-03：新增 raw 及其类型子目录（raw/pdf raw/docx raw/xlsx raw/md raw/txt raw/images 等），用于查看原始文件。**v2026-08-03：reports 支持归档子文件夹——subdir 可传 "reports/<文件夹名>"（如 "reports/XX项目"，由 workspace_mkdir 创建），查看文件夹内报告**。',
      {
        subdir: {
          type: 'string',
          description: '子目录（支持 root / wiki / wiki/sources / wiki/reports / wiki/kg/sources / wiki/chat-history / reports / raw / raw/pdf / raw/docx / raw/xlsx / raw/md / raw/txt / raw/images / raw/json / raw/js / raw/others，以及 reports/<归档文件夹名> 如 "reports/XX项目"）',
          required: true
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
    ),
    skill('workspace_readRaw', '读工作区任意文本类文件的原文（不经 wiki 摘要，直接看原始内容）。用于查看用户临时放在根目录或 raw/ 下的补充资料。**支持的扩展名**：.md .txt .json .csv .log .js .yaml .xml 等文本类。**不支持二进制**（.pdf .docx .xlsx .png 等），二进制请先 workspace_ingest 再 workspace_readPage。单文件超 300KB 自动截断。',
      {
        filePath: {
          type: 'string',
          description: '工作区相对路径（非绝对路径），如 "临时备注.md" 或 "raw/md/规范.md" 或 "sub/notes.txt"',
          required: true
        }
      },
      async (args) => {
        const wm = getWM()
        const current = wm.current()
        if (!current || !current.path) {
          throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
        }
        const { readRaw } = require('./rawReader')
        return await readRaw(current.path, args.filePath)
      }
    ),
    skill('workspace_organize', '把工作区根目录散落的指定文件按类型归位到 raw/{类型}/ 子目录。**手动触发**：用户说"把 XX 文件归到 raw"或"整理这些文件"时调用。不自动扫描整个根目录，只移动指定文件。同名文件自动加后缀（_1 _2 ...）。返回每个文件的移动结果。',
      {
        filenames: {
          type: 'array',
          description: '要归位的文件名数组（工作区根目录下的文件名，不含路径），如 ["规范.pdf", "笔记.md"]',
          required: true,
          items: { type: 'string' }
        }
      },
      async (args) => {
        const wm = getWM()
        const current = wm.current()
        if (!current || !current.path) {
          throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
        }
        const fs = require('fs').promises
        const path = require('path')
        const { buildTargetRelPath } = require('./fileOrganizer')
        const results = []
        for (const filename of args.filenames || []) {
          const srcAbs = path.posix.join(current.path, filename)
          try {
            await fs.access(srcAbs)
          } catch {
            results.push({ filename, success: false, reason: '根目录下不存在该文件' })
            continue
          }
          const stat = await fs.stat(srcAbs)
          if (!stat.isFile()) {
            results.push({ filename, success: false, reason: '不是文件（可能是目录）' })
            continue
          }
          let count = 0
          let targetRel = buildTargetRelPath(filename, 0)
          let targetAbs = path.posix.join(current.path, 'raw', targetRel)
          while (true) {
            try {
              await fs.access(targetAbs)
              count++
              targetRel = buildTargetRelPath(filename, count)
              targetAbs = path.posix.join(current.path, 'raw', targetRel)
            } catch {
              break
            }
          }
          try {
            await fs.mkdir(path.dirname(targetAbs), { recursive: true })
            await fs.rename(srcAbs, targetAbs)
            results.push({
              filename,
              success: true,
              movedTo: `raw/${targetRel}`,
              message: `已归位到 raw/${targetRel}`
            })
          } catch (err) {
            results.push({ filename, success: false, reason: err.message })
          }
        }
        return { organized: results }
      },
      true
    ),
    skill('workspace_recordAnswer',
      '把本次问答里"以后还用得上"的知识回填到 wiki/answers/。' +
      '只有当问答包含可复用的工程经验、规范条文、参数阈值等才调，闲聊/一次性查询不要调。' +
      '调用条件：(1) 回答含可复用的工程知识（不是临时数值计算）；' +
      '(2) 当前 wiki 里没有或不全（先 workspace_search 验证）；' +
      '(3) 用户不是一次性查询（"为什么…"算知识性，"帮我算…"算一次性）。' +
      '返回 { status, answerPath }，answerPath 是 wiki/answers/ 下的相对路径。',
      {
        question: { type: 'string', description: '用户的原始问题', required: true },
        answer: { type: 'string', description: '你给出的完整回答（建议含数值/规范来源）', required: true },
        refs: {
          type: 'array',
          description: '引用过的 wiki 页相对路径列表（如 sources/jgj-55-2011.md），无引用传空数组',
          required: false,
          default: [],
          items: { type: 'string' }
        }
      },
      (args) => getWiki().recordAnswer(args.question, args.answer, args.refs || []),
      true
    ),
    // ════════════════════════════════════════════
    // 数据分析工具（v0.3.1 新增）
    // ════════════════════════════════════════════
    skill('workspace_analyze',
      '对工作区 xlsx/csv 文件或 wiki markdown 表格做数据统计 + 画图表（SVG）。\n' +
      '**三种用法**：\n' +
      '1. **纯统计**（不画图）：只传 source + stats，返回统计结果表。\n' +
      '2. **统计+画图**：传 source + stats + chart，返回统计结果 + SVG 图片相对路径（写入 reports/_images/）。\n' +
      '3. **纯画图**（对原始数据画图）：只传 source + chart，不传 stats。\n\n' +
      '**数据源 source**：\n' +
      '- xlsx/csv：传 filePath（工作区相对路径）\n' +
      '- wiki 表格：传 markdown（markdown 全文）\n\n' +
      '**统计配置 stats**：\n' +
      '- type=aggregate：整列聚合（column + operation: sum/avg/count/min/max/stddev）\n' +
      '- type=groupBy：分组聚合（groupBy + column + operation）\n\n' +
      '**图表配置 chart**（可选）：\n' +
      '- chartType: bar/bar-horizontal/line/area/scatter/histogram/pie\n' +
      '- xField/yField/colorField: 自动推断（不传时用数据列名）\n' +
      '- title: 图表标题\n\n' +
      '**返回**：{ data, stats?, chart? }。chart.svgRelPath 可直接用于 workspace_writeFile 的 image 段落。',
      {
        source: {
          type: 'object',
          required: true,
          description: '数据源描述',
          properties: {
            type: { type: 'string', description: 'xlsx/csv/wiki', enum: ['xlsx', 'csv', 'wiki'] },
            filePath: { type: 'string', description: 'xlsx/csv 文件相对工作区路径' },
            markdown: { type: 'string', description: 'wiki 数据源：markdown 全文' },
            sheet: { type: 'string', description: 'xlsx 的 sheet 名（默认第一个）' },
            tableIndex: { type: 'number', description: 'wiki 第几个表格（默认 0）' },
            firstRowAsHeader: { type: 'boolean', description: '首行作为列名（默认 true）' }
          }
        },
        stats: {
          type: 'object',
          required: false,
          description: '统计配置（不传则不做统计，只画图）',
          properties: {
            type: { type: 'string', description: 'aggregate 或 groupBy', enum: ['aggregate', 'groupBy'] },
            column: { type: 'string', description: '要聚合的列名' },
            operation: { type: 'string', description: 'sum/avg/count/min/max/stddev', enum: ['sum', 'avg', 'count', 'min', 'max', 'stddev'] },
            groupBy: { type: 'string', description: '分组列名（type=groupBy 时必填）' }
          }
        },
        chart: {
          type: 'object',
          required: false,
          description: '图表配置（不传则不画图）',
          properties: {
            chartType: { type: 'string', description: '图表类型', enum: ['bar', 'bar-horizontal', 'line', 'area', 'scatter', 'histogram', 'pie'] },
            xField: { type: 'string', description: 'X 轴字段名（不传自动推断）' },
            yField: { type: 'string', description: 'Y 轴字段名（不传自动推断）' },
            colorField: { type: 'string', description: '颜色编码字段（可选）' },
            title: { type: 'string', description: '图表标题' },
            width: { type: 'number', description: '宽度（默认 500）' },
            height: { type: 'number', description: '高度（默认 300）' }
          }
        }
      },
      async (args) => {
        const wm = getWM()
        const current = wm.current ? wm.current() : null
        if (!current || !current.path) {
          return ErrorCodes.createError('NOT_OPEN', '工作区未打开', '请先打开工作区', { retryable: false })
        }

        try {
          const { analyze } = require('../workspace/analyze')
          const result = await analyze(current.path, args)

          // 返回结构化结果
          const out = {
            success: true,
            data: {
              source: result.data.source,
              columns: result.data.columns,
              rowCount: result.data.rows.length,
              rowsPreview: result.data.rows.slice(0, 5) // 前 5 行预览
            }
          }
          if (result.stats) {
            out.data.stats = {
              columns: result.stats.columns,
              rows: result.stats.rows,
              metadata: result.stats.metadata
            }
          }
          if (result.chart) {
            out.data.chart = {
              svgRelPath: result.chart.svgRelPath, // 直接用于 markdown image 段落
              spec: result.chart.spec
            }
          }
          return out
        } catch (err) {
          if (err instanceof WorkspaceError) {
            return ErrorCodes.createError(err.code, err.message, err.hint || '请检查参数', { retryable: err.retryable })
          }
          return ErrorCodes.createError(ErrorCodes.UNKNOWN, err.message, '请稍后重试', { stack: err.stack })
        }
      },
      true
    ),
    // ════════════════════════════════════════════
    // OfficeCLI 工具（v11.6.0 新增）
    // ════════════════════════════════════════════
    skill('read_office_file',
      '读取 docx/xlsx/pptx 文件的内容。五种模式：\n' +
      '- outline（默认，结构化大纲JSON，含段落/表格/标题层级，推荐用于概览）\n' +
      '- text（纯文本，无格式标记）\n' +
      '- annotated（文本+路径标注+样式信息，JSON包裹，用于精确定位元素路径）\n' +
      '- stats（统计信息JSON：单元格数/公式数/错误数/数据类型分布，v0.3.2新增）\n' +
      '- html（渲染为HTML，前端可预览，v0.3.2新增）\n' +
      '只读操作不修改文件。支持格式：.docx / .xlsx / .pptx。',
      {
        filePath: {
          type: 'string',
          required: true,
          description: '工作区中的文件路径（相对工作区根目录），如 "reports/报价单.docx"。支持绝对路径。'
        },
        mode: {
          type: 'string',
          required: false,
          description: '读取模式：outline/text/annotated/stats/html',
          enum: ['outline', 'text', 'annotated', 'stats', 'html'],
          default: 'outline'
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')

        // 检查 OfficeCLI 是否可用
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE',
            `OfficeCLI 不可用: ${avail.error}`,
            '请确认 OfficeCLI 已正确安装，或重新安装砼智', { retryable: false })
        }

        // 解析文件路径
        const wm = getWM()
        const current = wm.current ? wm.current() : null
        let fullPath = args.filePath
        if (current && current.path && !path.isAbsolute(fullPath)) {
          fullPath = path.posix.join(current.path, fullPath)
        }

        // 检查文件是否存在
        if (!fs.existsSync(fullPath)) {
          return ErrorCodes.createError('FILE_NOT_FOUND',
            `文件不存在: ${fullPath}`,
            '请确认文件路径是否正确，先用 workspace_search 或 workspace_grep 定位文件', { retryable: false })
        }

        // 检查后缀
        const ext = path.extname(fullPath).toLowerCase()
        if (ext !== '.docx' && ext !== '.xlsx' && ext !== '.pptx') {
          return ErrorCodes.createError('UNSUPPORTED_FORMAT',
            `不支持的文件格式: ${ext}（仅支持 .docx / .xlsx / .pptx）`,
            '确认文件是 Word/Excel/PowerPoint 格式', { retryable: false })
        }

        try {
          const mode = args.mode || 'outline'
          let content

          if (mode === 'text') {
            content = officecli.readFileAsText(fullPath)
            return { success: true, data: { filePath: args.filePath, mode, content } }
          } else if (mode === 'annotated') {
            content = officecli.readFileAsAnnotated(fullPath)
            return { success: true, data: { filePath: args.filePath, mode, content } }
          } else if (mode === 'stats') {
            // v0.3.2：统计信息（单元格数/公式数/错误数/数据类型分布）
            content = officecli.readFileStats(fullPath)
            return { success: true, data: { filePath: args.filePath, mode, content } }
          } else if (mode === 'html') {
            // v0.3.2：渲染为 HTML，前端可预览
            content = officecli.renderAsHtml(fullPath)
            return { success: true, data: { filePath: args.filePath, mode, content } }
          } else {
            // outline（默认）：结构化大纲 JSON
            content = officecli.readFileStructure(fullPath)
            return { success: true, data: { filePath: args.filePath, mode, content } }
          }
        } catch (err) {
          return ErrorCodes.createError('READ_FAILED',
            `读取文件失败: ${err.message}`,
            '确认文件不是被其他程序锁定，或者文件没有损坏', { retryable: true })
        }
      }
    ),
    skill('edit_office_file',
      '修改 docx/xlsx 文件中指定元素的内容（文本、格式、单元格值等）。支持路径式精确定位和批量操作。' +
      '先使用 read_office_file（mode=annotated）查看文档结构获取元素路径和 paraId，再使用本工具修改。' +
      '支持格式：.docx / .xlsx。' +
      '操作类型：' +
      'set（整段替换：用 value 覆盖整个段落或单元格的内容，可用 props 改格式）；' +
      'replace（精确替换：用 find/replace 替换段落内特定文字，不影响其余内容）；' +
      'add（添加：追加到 path 父容器末尾，或用 after/before 指定插入位置；v11.7.0 起支持完整 props 透传）；' +
      'add_table（v11.7.0 新增：专用于添加表格，必须传 rows + cols，可选 colWidths/rowsData/props。rowsData 是二维数组，每格是字符串 或 {text, props}，props 是 run/paragraph 完整属性——包括 firstLineIndent/lineSpacing/font.ea/font.latin，对应老板的"中文仿宋+英文新罗马+小四+首行缩进 2 字符+1.5 倍行距"格式要求）；' +
      'remove（删除：删除 path 指定的元素）。',
      {
        filePath: {
          type: 'string',
          required: true,
          description: '工作区中的文件路径，如 "reports/报价单.docx"'
        },
        operations: {
          type: 'array',
          required: true,
          description: '要执行的操作列表（按顺序执行）。每个操作包含 action（set/add/remove/replace）、path（元素路径）、value（新值）等字段。',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                required: true,
                description: '操作类型',
                enum: ['set', 'add', 'add_table', 'remove', 'replace']
              },
              path: {
                type: 'string',
                required: false,
                description: '元素路径（set/add/remove 用），如 "/body/table[1]/row[3]/cell[5]"。' +
                  'add 的 path 是父容器路径（如 /body），新元素默认追加到末尾'
              },
              value: {
                type: 'string',
                required: false,
                description: '要设置的值或添加的内容'
              },
              props: {
                type: 'object',
                required: false,
                description: '格式属性键值对（action=set / add 生效）。v11.7.0 完整透传：' +
                  '段落：align/style/firstLineIndent/lineSpacing/lineRule/spaceBefore/spaceAfter/keepNext/keepLines/pageBreakBefore；' +
                  '字体（run/paragraph）：bold/italic/underline/strike/size/color/highlight；' +
                  '字体槽：font.latin（英文=Times New Roman 新罗马）、font.ea（中文=仿宋/黑体）、font.cs/font.hint。' +
                  '示例：{"font.ea":"仿宋","font.latin":"Times New Roman","size":"12pt","firstLineIndent":"480","lineSpacing":"360","lineRule":"auto"}'
              },
              rows: {
                type: 'integer',
                description: '（仅 action=add_table）表格行数',
                required: false,
                min: 1,
                max: 100
              },
              cols: {
                type: 'integer',
                description: '（仅 action=add_table）表格列数',
                required: false,
                min: 1,
                max: 50
              },
              colWidths: {
                type: 'array',
                description: '（仅 action=add_table）每列宽度，OOXML 单位（1cm≈567）。如 [2000,3000,2000]',
                required: false,
                items: { type: 'integer' }
              },
              rowsData: {
                type: 'array',
                description: '（仅 action=add_table）二维单元格数据。元素是字符串 或 {text, props}。props 是 run/paragraph 完整属性',
                required: false,
                items: { type: 'array' }
              },
              find: {
                type: 'string',
                required: false,
                description: '查找替换的查找文本（action=replace 时必填）'
              },
              replace: {
                type: 'string',
                required: false,
                description: '查找替换的替换文本（action=replace 时必填）'
              },
              after: {
                type: 'string',
                required: false,
                description: '（仅 action=add）在此元素路径之后插入。如 "/body/p[@paraId=6B86D976]"，' +
                  '从 read_office_file annotated 输出的路径中获取 paraId'
              },
              before: {
                type: 'string',
                required: false,
                description: '（仅 action=add）在此元素路径之前插入，如 "/body/p[3]"'
              },
              type: {
                type: 'string',
                required: false,
                description: '（仅 action=add）添加的元素类型，默认 paragraph，可选 table/run/slide/shape 等'
              }
            }
          },
          minItems: 1,
          maxItems: 50
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')

        // 检查 OfficeCLI 是否可用
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE',
            `OfficeCLI 不可用: ${avail.error}`,
            '请确认 OfficeCLI 已正确安装，或重新安装砼智', { retryable: false })
        }

        // 解析文件路径
        const wm = getWM()
        const current = wm.current ? wm.current() : null
        let fullPath = args.filePath
        if (current && current.path && !path.isAbsolute(fullPath)) {
          fullPath = path.posix.join(current.path, fullPath)
        }

        // 检查文件是否存在
        if (!fs.existsSync(fullPath)) {
          return ErrorCodes.createError('FILE_NOT_FOUND',
            `文件不存在: ${fullPath}`,
            '请确认文件路径是否正确', { retryable: false })
        }

        // 检查后缀
        const ext = path.extname(fullPath).toLowerCase()
        if (ext !== '.docx' && ext !== '.xlsx') {
          return ErrorCodes.createError('UNSUPPORTED_FORMAT',
            `不支持的文件格式: ${ext}（仅支持 .docx / .xlsx）`,
            '确认文件是 Word 或 Excel 格式', { retryable: false })
        }

        try {
          const results = []
          for (const op of args.operations) {
            const { action, path: elPath, value, find, replace } = op

            if (action === 'replace') {
              // 替换文本：set <file> <path> --find <find> --replace <replace>
              officecli.replaceText(fullPath, elPath, find, replace)
              results.push({ action, find, replace, status: 'ok' })
            } else if (action === 'set') {
              // 设置文本+格式：set <file> <path> --prop text=<value> --prop key=val ...
              // v11.7.0：UNSUPPORTED_PROP 错误码透传
              try {
                officecli.setElementText(fullPath, elPath, value, op.props || {})
                results.push({ action, path: elPath, value, props: op.props, status: 'ok' })
              } catch (err) {
                if (/UNSUPPORTED|not supported/i.test(err.message)) {
                  results.push({ action, path: elPath, status: 'error', error: ErrorCodes.createError('UNSUPPORTED_PROP', err.message, '检查属性名拼写，常用：bold/italic/font/size/color/align/firstLineIndent/lineSpacing/lineRule/font.ea/font.latin') })
                } else {
                  throw err
                }
              }
            } else if (action === 'add') {
              // 添加元素：add <file> <parent> [--after <path> | --before <path>] --type <type> [--prop key=val ...]
              // v11.7.0 增强：完整透传 props 到 --prop k=v（首行缩进/行距/中英文字体等）
              const addType = op.type || 'paragraph'
              const addArgs = ['add', fullPath, elPath, '--type', addType]
              if (op.after) addArgs.push('--after', op.after)
              if (op.before) addArgs.push('--before', op.before)
              if (value) addArgs.push('--prop', `text=${value}`)
              if (op.props) {
                for (const [k, v] of Object.entries(op.props)) {
                  addArgs.push('--prop', `${k}=${v}`)
                }
              }
              officecli.execOfficeCliSync(addArgs)
              results.push({ action, path: elPath, value, type: addType, props: op.props, status: 'ok' })
            } else if (action === 'add_table') {
              // v11.7.0 新增：专用于添加表格（rows/cols/colWidths/rowsData）
              officecli.addTable(fullPath, elPath, {
                rows: op.rows,
                cols: op.cols,
                colWidths: op.colWidths,
                rowsData: op.rowsData,
                props: op.props,
                after: op.after,
                before: op.before
              })
              results.push({ action, path: elPath, rows: op.rows, cols: op.cols, status: 'ok' })
            } else if (action === 'remove') {
              // 删除元素：remove <file> <path>
              officecli.execOfficeCliSync(['remove', fullPath, elPath])
              results.push({ action, path: elPath, status: 'ok' })
            } else {
              results.push({ action, status: 'skipped', reason: `不支持的操作: ${action}` })
            }
          }

          return {
            success: true,
            data: {
              filePath: args.filePath,
              operationsCount: args.operations.length,
              results
            }
          }
        } catch (err) {
          return ErrorCodes.createError('EDIT_FAILED',
            `编辑文件失败: ${err.message}`,
            '确认文件不是被其他程序锁定，或者路径表达式正确（先用 read_office_file 查看结构）',
            { retryable: true })
        }
      },
      true
    ),
    // ════════════════════════════════════════════
    // officecli 补充技能（v0.3.2 新增）
    // ════════════════════════════════════════════
    skill('batch_office_edit',
      '【推荐】原子事务批量编辑 Office 文档，任一操作失败则整批回滚（不会产生半成品文件）。\n' +
      '比 edit_office_file 的 operations[] 更安全：edit_office_file 是逐个顺序调用，中途失败前序已落盘；batch_office_edit 走 officecli 原生 batch 命令，单次调用内部原子执行。\n\n' +
      '**commands 数组**：每项是一个对象，command 字段是裸动词（add/set/remove/move/swap/get/query），其他字段是动词的参数：\n' +
      '- add: { command:"add", parent:"/body", type:"paragraph", props:{text:"Hi"} }\n' +
      '- set: { command:"set", path:"/body/p[1]", props:{bold:"true"} }\n' +
      '- remove: { command:"remove", path:"/body/p[2]" }\n' +
      '- move: { command:"move", path:"/body/p[1]", after:"/body/p[3]" }\n' +
      '- swap: { command:"swap", path:"/body/p[1]", path2:"/body/p[2]" }\n' +
      '- get: { command:"get", path:"/body/p[1]" }\n' +
      '- query: { command:"query", selector:"paragraph[style=Normal]" }\n\n' +
      '**原子性模式**（mode 参数）：\n' +
      '- atomic（默认）：任一失败 → 整批回滚，什么都不应用\n' +
      '- best-effort：成功的留下，失败的跳过\n' +
      '- stop-on-error：遇错立即中止（配合 best-effort 时已应用的保留）',
      {
        filePath: { type: 'string', required: true, description: '工作区相对路径，如 "报告.docx"' },
        commands: {
          type: 'array', required: true,
          description: '批量操作数组，每项 {command, parent/path/selector, type, props, to/after/before, path2}'
        },
        mode: {
          type: 'string', required: false,
          description: '原子性模式：atomic（默认，失败全回滚）/ best-effort（成功留下）/ stop-on-error（遇错中止）',
          enum: ['atomic', 'best-effort', 'stop-on-error']
        }
      },
      (args) => {
        const wm = getWM()
        const current = wm.current ? wm.current() : null
        if (!current || !current.path) {
          return ErrorCodes.createError('NOT_OPEN', '工作区未打开', '请先打开工作区', { retryable: false })
        }
        const fullPath = path.posix.join(current.path, args.filePath)
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('OFFICECLI_UNAVAILABLE', avail.error || 'officecli 不可用', '请确认 officecli 已安装', { retryable: false })
        }
        try {
          const options = {}
          if (args.mode === 'best-effort') options.bestEffort = true
          if (args.mode === 'stop-on-error') options.stopOnError = true
          // batchExecute 默认走 --commands（< 50KB）或 stdin，officecli 默认原子模式
          const cliArgs = ['batch', fullPath]
          if (args.mode === 'best-effort') cliArgs.push('--best-effort')
          if (args.mode === 'stop-on-error') cliArgs.push('--stop-on-error')
          const json = JSON.stringify(args.commands)
          let result
          if (json.length < 50000) {
            cliArgs.push('--commands', json)
            result = officecli.execOfficeCliSync(cliArgs)
          } else {
            result = officecli.execOfficeCliSync(cliArgs, { input: json })
          }
          // 解析输出
          let parsed
          try { parsed = JSON.parse(result.stdout) } catch { parsed = { success: true, message: result.stdout } }
          return {
            success: true,
            data: {
              filePath: args.filePath,
              commandsCount: args.commands.length,
              mode: args.mode || 'atomic',
              result: parsed
            }
          }
        } catch (err) {
          return ErrorCodes.createError('BATCH_FAILED',
            `批量操作失败: ${err.message}`,
            '检查 commands 数组格式是否正确（参考 officecli help batch）',
            { retryable: false })
        }
      },
      true
    ),
    skill('query_office_elements',
      '用 CSS 选择器查询 Office 文档元素，精准定位要操作的元素。\n' +
      '**比 read_office_file annotated 更强大**：annotated 只能列出所有元素，query 能按属性筛选。\n\n' +
      '**选择器语法**（类 CSS）：\n' +
      '- 元素名：paragraph / run / table / slide / shape / cell / picture / chart\n' +
      '- 属性过滤：paragraph[style=Normal] / run[font!=Arial] / cell[value>100]\n' +
      '- 后代：body paragraph（空格）\n' +
      '- 子代：table > table-row（>）\n' +
      '- 组合：paragraph[style=Normal] > run[bold=true]\n\n' +
      '**输出模式**：\n' +
      '- 默认（json）：返回完整 JSON，含 matches 数组（path/text/属性）\n' +
      '- compact：每元素一行 path<TAB>[label]<TAB>"text"，末行 total: N of M，适合快速浏览\n\n' +
      '**限制**：仅 docx/pptx 支持 query，xlsx 不支持（用 read_office_file mode=text 配合 --range）',
      {
        filePath: { type: 'string', required: true, description: '工作区相对路径，如 "报告.docx"' },
        selector: {
          type: 'string', required: true,
          description: 'CSS 选择器，如 "paragraph[style=Normal]" 或 "shape > paragraph[bold=true]"'
        },
        find: { type: 'string', required: false, description: '按文本大小写不敏感子串过滤' },
        compact: { type: 'boolean', required: false, description: '紧凑模式：每元素一行（默认 false）' },
        fields: { type: 'string', required: false, description: '追加额外列，如 "x,y,width"（仅 compact 模式）' }
      },
      (args) => {
        const wm = getWM()
        const current = wm.current ? wm.current() : null
        if (!current || !current.path) {
          return ErrorCodes.createError('NOT_OPEN', '工作区未打开', '请先打开工作区', { retryable: false })
        }
        const fullPath = path.posix.join(current.path, args.filePath)
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('OFFICECLI_UNAVAILABLE', avail.error || 'officecli 不可用', '请确认 officecli 已安装', { retryable: false })
        }
        try {
          const opts = {}
          if (args.find) opts.find = args.find
          if (args.compact) opts.compact = true
          if (args.fields) opts.fields = args.fields
          const result = officecli.queryElements(fullPath, args.selector, opts)
          return {
            success: true,
            data: {
              filePath: args.filePath,
              selector: args.selector,
              compact: !!args.compact,
              result
            }
          }
        } catch (err) {
          return ErrorCodes.createError('QUERY_FAILED',
            `查询失败: ${err.message}`,
            '检查选择器语法（参考 officecli help query）。注意 xlsx 不支持 query',
            { retryable: false })
        }
      }
    ),
    skill('refresh_office_doc',
      '重算 Word 文档的派生字段：TOC 页码、PAGE/NUMPAGES 域、交叉引用。\n' +
      '**使用场景**：edit_office_file 修改文档后，目录页码可能不准，refresh 让 Word 重算。\n\n' +
      '**限制**：仅 .docx + Windows + Word 环境可用（需要 Word 引擎重算）',
      {
        filePath: { type: 'string', required: true, description: '工作区相对路径，仅 .docx' }
      },
      (args) => {
        const wm = getWM()
        const current = wm.current ? wm.current() : null
        if (!current || !current.path) {
          return ErrorCodes.createError('NOT_OPEN', '工作区未打开', '请先打开工作区', { retryable: false })
        }
        const fullPath = path.posix.join(current.path, args.filePath)
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('OFFICECLI_UNAVAILABLE', avail.error || 'officecli 不可用', '请确认 officecli 已安装', { retryable: false })
        }
        try {
          const result = officecli.refreshDocument(fullPath)
          return {
            success: true,
            data: {
              filePath: args.filePath,
              refreshed: true,
              result
            }
          }
        } catch (err) {
          return ErrorCodes.createError('REFRESH_FAILED',
            `刷新失败: ${err.message}`,
            'refresh 需要 Windows + Word 环境。非 Windows 或未装 Word 无法重算',
            { retryable: false })
        }
      },
      true
    ),
    skill('create_office_file',
      '在工作区创建空白 Office 文档（docx/xlsx/pptx）。文件会写入工作区根目录。' +
      '创建后可用 read_office_file 查看内容，或用 edit_office_file 编辑。',
      {
        filename: {
          type: 'string',
          required: true,
          description: '文件名（含扩展名），如 "新报告.docx" 或 "数据表.xlsx"'
        },
        type: {
          type: 'string',
          required: false,
          description: '文档类型：docx（默认）、xlsx、pptx。不传则从 filename 扩展名推断',
          enum: ['docx', 'xlsx', 'pptx']
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')

        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE',
            `OfficeCLI 不可用: ${avail.error}`,
            '请确认 OfficeCLI 已正确安装', { retryable: false })
        }

        const wm = getWM()
        const current = wm.current ? wm.current() : null
        let fullPath = args.filename
        if (current && current.path && !path.isAbsolute(fullPath)) {
          fullPath = path.posix.join(current.path, fullPath)
        }

        try {
          const result = officecli.createDocument(fullPath, args.type)
          return {
            success: true,
            data: {
              filePath: args.filename,
              fullPath,
              message: `已创建空白 ${args.type || 'docx'} 文件`
            }
          }
        } catch (err) {
          return ErrorCodes.createError('CREATE_FAILED',
            `创建文件失败: ${err.message}`,
            '确认文件名后缀正确，且磁盘空间充足', { retryable: true })
        }
      },
      true
    ),
    skill('merge_office_template',
      '用 JSON 数据填充 Office 模板文件中的 {{key}} 占位符，生成新文档。' +
      '模板必须是带 {{key}} 标记的 docx/xlsx/pptx 文件。' +
      '数据是一个键值对对象，每个 key 对应模板中的 {{key}}。' +
      '使用场景：报价单模板 + 数据 = 填充好的报价单。',
      {
        templatePath: {
          type: 'string',
          required: true,
          description: '模板文件在工作区中的路径，如 "templates/报价单模板.docx"'
        },
        outputPath: {
          type: 'string',
          required: true,
          description: '输出文件路径（工作区相对路径），如 "reports/报价单_20260720.docx"'
        },
        data: {
          type: 'object',
          required: true,
          description: '填充数据键值对，如 { "客户名称": "某某公司", "日期": "2026-07-20", "总价": "450.00" }'
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')

        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE',
            `OfficeCLI 不可用: ${avail.error}`,
            '请确认 OfficeCLI 已正确安装', { retryable: false })
        }

        const wm = getWM()
        const current = wm.current ? wm.current() : null
        const resolvePath = (p) => {
          if (current && current.path && !path.isAbsolute(p)) {
            return path.posix.join(current.path, p)
          }
          return p
        }

        const fullTemplate = resolvePath(args.templatePath)
        const fullOutput = resolvePath(args.outputPath)

        if (!fs.existsSync(fullTemplate)) {
          return ErrorCodes.createError('FILE_NOT_FOUND',
            `模板文件不存在: ${args.templatePath}`,
            '先用 read_office_file 或 workspace_listFiles 确认模板路径', { retryable: false })
        }

        try {
          const result = officecli.mergeTemplate(fullTemplate, fullOutput, args.data)
          return {
            success: true,
            data: {
              templatePath: args.templatePath,
              outputPath: args.outputPath,
              message: '模板合并完成'
            }
          }
        } catch (err) {
          return ErrorCodes.createError('MERGE_FAILED',
            `模板合并失败: ${err.message}`,
            '确认模板文件中的 {{key}} 标记与 data 中的 key 一一对应', { retryable: true })
        }
      },
      true
    ),
    // ════════════════════════════════════════════
    // v11.7.0 P1：元素操作 + 校验 + 导入
    // ════════════════════════════════════════════
    skill('move_office_element',
      '移动或交换 Office 文档中的元素位置。' +
      'action=move：将 sourcePath 移到 after 指定的元素之后；' +
      'action=swap：交换 path1 和 path2 两个元素的位置。',
      {
        filePath: {
          type: 'string', required: true,
          description: '工作区中的文件路径'
        },
        action: {
          type: 'string', required: true,
          description: 'move 或 swap',
          enum: ['move', 'swap']
        },
        sourcePath: {
          type: 'string', required: true,
          description: '源元素路径（action=move 时），如 "/body/p[3]"'
        },
        after: {
          type: 'string', required: false,
          description: '移到哪个元素之后（action=move 时）'
        },
        path1: {
          type: 'string', required: false,
          description: '第一个元素路径（action=swap 时）'
        },
        path2: {
          type: 'string', required: false,
          description: '第二个元素路径（action=swap 时）'
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE', `OfficeCLI 不可用: ${avail.error}`, '请确认 OfficeCLI 已正确安装', { retryable: false })
        }

        const wm = getWM()
        const current = wm.current ? wm.current() : null
        let fullPath = args.filePath
        if (current && current.path && !path.isAbsolute(fullPath)) {
          fullPath = path.posix.join(current.path, fullPath)
        }
        if (!fs.existsSync(fullPath)) {
          return ErrorCodes.createError('FILE_NOT_FOUND', `文件不存在: ${fullPath}`, '请确认文件路径', { retryable: false })
        }

        try {
          if (args.action === 'move') {
            officecli.moveElement(fullPath, args.sourcePath, args.after)
            return { success: true, data: { action: 'move', sourcePath: args.sourcePath, after: args.after } }
          } else if (args.action === 'swap') {
            officecli.swapElements(fullPath, args.path1, args.path2)
            return { success: true, data: { action: 'swap', path1: args.path1, path2: args.path2 } }
          }
          return { success: false, code: 'PARAM_INVALID_TYPE', title: `不支持的操作: ${args.action}` }
        } catch (err) {
          return ErrorCodes.createError(args.action === 'move' ? 'MOVE_FAILED' : 'SWAP_FAILED',
            `操作失败: ${err.message}`, '确认路径表达正确', { retryable: true })
        }
      },
      true
    ),
    skill('validate_office_file',
      '校验 Office 文档的 OpenXML schema 合法性。',
      {
        filePath: {
          type: 'string', required: true,
          description: '工作区中的文件路径'
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE', `OfficeCLI 不可用: ${avail.error}`, '', { retryable: false })
        }

        const wm = getWM()
        const current = wm.current ? wm.current() : null
        let fullPath = args.filePath
        if (current && current.path && !path.isAbsolute(fullPath)) {
          fullPath = path.posix.join(current.path, fullPath)
        }
        if (!fs.existsSync(fullPath)) {
          return ErrorCodes.createError('FILE_NOT_FOUND', `文件不存在: ${fullPath}`, '', { retryable: false })
        }

        try {
          const result = officecli.validateDocument(fullPath)
          return { success: true, data: { filePath: args.filePath, output: result.stdout } }
        } catch (err) {
          return ErrorCodes.createError('VALIDATE_FAILED', `校验失败: ${err.message}`, '文件可能被非法修改', { retryable: true })
        }
      }
    ),
    skill('import_office_csv',
      '将 CSV/TSV 文件导入到 Excel 的指定 sheet。',
      {
        filePath: {
          type: 'string', required: true,
          description: '目标 xlsx 文件路径'
        },
        sourceFile: {
          type: 'string', required: true,
          description: 'CSV/TSV 源文件路径'
        },
        sheet: {
          type: 'string', required: false,
          description: '目标 sheet 名称（默认第一个 sheet）'
        },
        startCell: {
          type: 'string', required: false,
          description: '起始单元格，如 "A1"（默认 A1）'
        },
        delimiter: {
          type: 'string', required: false,
          description: '分隔符，默认 ","，TSV 用 "\\t"'
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE', `OfficeCLI 不可用: ${avail.error}`, '', { retryable: false })
        }

        const wm = getWM()
        const current = wm.current ? wm.current() : null
        const resolvePath = (p) => {
          if (current && current.path && !path.isAbsolute(p)) {
            return path.posix.join(current.path, p)
          }
          return p
        }
        const fullTarget = resolvePath(args.filePath)
        const fullSource = resolvePath(args.sourceFile)

        if (!fs.existsSync(fullTarget)) {
          return ErrorCodes.createError('FILE_NOT_FOUND', `目标文件不存在: ${fullTarget}`, '', { retryable: false })
        }
        if (!fs.existsSync(fullSource)) {
          return ErrorCodes.createError('FILE_NOT_FOUND', `源文件不存在: ${fullSource}`, '', { retryable: false })
        }

        try {
          const result = officecli.importCsv(fullTarget, '/', fullSource, {
            sheet: args.sheet, startCell: args.startCell, delimiter: args.delimiter
          })
          return { success: true, data: { filePath: args.filePath, sourceFile: args.sourceFile, output: result.stdout } }
        } catch (err) {
          return ErrorCodes.createError('IMPORT_FAILED', `导入失败: ${err.message}`, '确认源文件格式正确', { retryable: true })
        }
      },
      true
    ),
    // ════════════════════════════════════════════
    // v11.7.0 P2：XML 底层逃生口（会损坏文件）
    // ════════════════════════════════════════════
    skill('officecli_raw',
      '【危险】直接读写 Office 文档的底层 XML part，会损坏文件，请先备份。' +
      'action=read：读 part XML；action=write：写 XML；action=dump：子树序列化。',
      {
        filePath: {
          type: 'string', required: true,
          description: '工作区中的文件路径'
        },
        action: {
          type: 'string', required: true,
          description: 'read / write / dump',
          enum: ['read', 'write', 'dump']
        },
        part: {
          type: 'string', required: false,
          description: 'XML part 路径（默认 "/document"）',
          default: '/document'
        },
        content: {
          type: 'string', required: false,
          description: 'XML 字符串（action=write 时必填）'
        },
        subtree: {
          type: 'string', required: false,
          description: '子树路径（action=dump 时，默认 "/"）',
          default: '/'
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) { return ErrorCodes.createError('CLI_UNAVAILABLE', `OfficeCLI 不可用: ${avail.error}`, '', { retryable: false }) }

        const wm = getWM()
        const current = wm.current ? wm.current() : null
        let fullPath = args.filePath
        if (current && current.path && !path.isAbsolute(fullPath)) {
          fullPath = path.posix.join(current.path, fullPath)
        }
        if (!fs.existsSync(fullPath)) { return ErrorCodes.createError('FILE_NOT_FOUND', `文件不存在: ${fullPath}`, '', { retryable: false }) }

        try {
          if (args.action === 'read') {
            return { success: true, data: { action: 'read', part: args.part, content: officecli.rawPart(fullPath, args.part || '/document') } }
          } else if (args.action === 'write') {
            officecli.rawSetPart(fullPath, args.part || '/document', args.content)
            return { success: true, data: { action: 'write', part: args.part, message: 'XML part 已写入' } }
          } else if (args.action === 'dump') {
            return { success: true, data: { action: 'dump', subtree: args.subtree, script: officecli.dumpSubtree(fullPath, args.subtree || '/') } }
          }
          return { success: false, code: 'PARAM_INVALID_TYPE', title: `不支持的操作: ${args.action}` }
        } catch (err) {
          return ErrorCodes.createError('RAW_FAILED', `XML 操作失败: ${err.message}`, '操作可能已损坏文件', { retryable: false })
        }
      }
    ),
    // ════════════════════════════════════════════
    // v11.7.0：officecli schema 帮助查询
    // ════════════════════════════════════════════
    skill('officecli_help',
      '查询 officecli 的 schema-driven 帮助信息——了解 docx/xlsx/pptx 支持哪些元素（paragraph/table/run/body/section/style 等）、每个元素有哪些属性（add/set/get/query/remove）、每个属性的数据类型和取值。' +
      'format=docx|xlsx|pptx（查单个格式）或 format=all（全部格式的 flat dump）。可查特定 verb（add/set/get/query/remove/any 查该 verb 支持的元素）和 element（如 paragraph/table/run 查该元素的完整属性）。',
      {
        format: {
          type: 'string', required: true,
          description: '文档格式：docx / xlsx / pptx / all。查 all 返回全部格式的 flat dump',
          enum: ['docx', 'xlsx', 'pptx', 'all']
        },
        verb: {
          type: 'string', required: false,
          description: '过滤到支持该 verb 的元素：add / set / get / query / remove / any。不传则返回全部元素'
        },
        element: {
          type: 'string', required: false,
          description: '指定元素名查详细属性（如 paragraph / table / run / table-row / table-cell / body），不传列出所有元素'
        },
        json: {
          type: 'boolean', required: false,
          description: '是否以 JSON 格式返回（默认 false，返回 plain text help 输出）',
          default: false
        }
      },
      async (args) => {
        const officecli = require('../officecli/officecli-bridge')
        const avail = officecli.checkAvailability()
        if (!avail.available) {
          return ErrorCodes.createError('CLI_UNAVAILABLE', `OfficeCLI 不可用: ${avail.error}`, '请确认 OfficeCLI 已正确安装', { retryable: false })
        }

        try {
          const result = officecli.officecliHelp({
            format: args.format, verb: args.verb, element: args.element, json: args.json
          })
          return { success: true, data: { format: args.format, verb: args.verb, element: args.element, result } }
        } catch (err) {
          return ErrorCodes.createError('UNKNOWN', `查询 help 失败: ${err.message}`, '确认格式/verb/element 参数正确', { retryable: true })
        }
      }
    )
  ]
}

module.exports = { buildWorkspaceSkills }