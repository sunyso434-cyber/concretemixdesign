// recordAnswer 问答回填 + 反向链接维护方法集（从 WikiEngine.js 拆分，行为不变）
// 通过 WikiEngine.prototype 挂载；经 this 访问 workspace/_rebuildAnswerBM25/_buildSlug/setParam。

const fs = require('fs').promises
const path = require('path')
const matter = require('gray-matter')
const { WorkspaceError } = require('./WorkspaceError')
const { loadIndex, saveIndex } = require('./index-store')
const { queryBM25 } = require('./bm25')
const { tokenize } = require('./tokenizer')
const { localISOString } = require('./wiki-ingest')

  // Task 2.9: recordAnswer - 把重要问答回填到 wiki（spec §4.2）
  // - 工作区未打开 → NOT_OPEN（不 retry）
  // - 写到 wiki/answers/<timestamp>.md（frontmatter 含 question/answered_at/refs）
  // - 更新 wiki/index.md（追加「## 问答」节的链接）
  // - 加 log（写到 wiki/log.md，schema §4 格式 `## [YYYY-MM-DD HH:mm] answer | <subject>`）
  // - 不重建 BM25（answer 文档不入索引，符合 spec）
  async function recordAnswer(q, a, refs) {
    const current = this.workspace.current()
    if (!current || current.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }

    const wikiDir = path.join(current.path, 'wiki')
    const now = new Date()
    const tsFile = now.toISOString().replace(/[:.]/g, '-')  // 文件名安全
    const tsLog = now.toISOString().slice(0, 16).replace('T', ' ')  // log 行用 YYYY-MM-DD HH:mm

    const answersDir = path.join(wikiDir, 'answers')
    await fs.mkdir(answersDir, { recursive: true })

    // 知识库刷新：upsert —— BM25 粗筛候选，再用问题文本 2-gram Jaccard 判是否同一问题
    // ponytail：Jaccard 只识别措辞高度相似的重复；语义相同但措辞差异大的重复本期不处理（需 embedding，YAGNI）
    const { getRefreshConfig } = require('./refresh-config')
    let overwriteRel = null
    try {
      const idxForUpsert = await loadIndex(current.path)
      const ai = idxForUpsert.answerBM25Index
      if (ai && ai.totalDocs > 0) {
        const cfg = await getRefreshConfig()
        const hits = queryBM25(ai, q, 1)
        if (hits.length > 0) {
          const candAbs = path.join(current.path, 'wiki', hits[0].path)
          const candRaw = await fs.readFile(candAbs, 'utf-8')
          const candQ = matter(candRaw).data.question || ''
          const setA = new Set(tokenize(q))
          const setB = new Set(tokenize(candQ))
          let inter = 0
          for (const t of setA) if (setB.has(t)) inter++
          const union = setA.size + setB.size - inter
          const sim = union > 0 ? inter / union : 0
          if (sim >= cfg.upsertThreshold) overwriteRel = hits[0].path // 形如 answers/<ts>.md
        }
      }
    } catch {
      // 查重失败不阻塞，退化为新建
    }

    // 1. 写 wiki/answers/<timestamp>.md（frontmatter + 正文）
    // - 命中相似旧问题 → 复用其路径（覆盖更新）
    // - 否则按当前时间戳新建
    const answerRel = overwriteRel || `answers/${tsFile}.md`
    const answerAbs = path.join(answersDir, path.basename(answerRel))
    const refsYaml = (refs || []).map(r => `  - "${r.replace(/"/g, '\\"')}"`).join('\n')
    const md = `---
question: "${String(q).replace(/"/g, '\\"')}"
answered_at: "${localISOString(now)}"
refs:
${refsYaml || '  []'}
---

# ${String(q)}

${String(a)}
`
    await fs.writeFile(answerAbs, md, 'utf-8')

    // 2. 更新 wiki/index.md（追加「## 问答」节 + 链接）
    // - 覆盖模式（overwriteRel != null）跳过：旧链接已存在，避免重复
    if (!overwriteRel) {
      const indexAbs = path.join(wikiDir, 'index.md')
      const indexLink = `- [${q}](${answerRel})\n`
      let indexExists = true
      try {
        await fs.access(indexAbs)
      } catch {
        indexExists = false
      }
      if (!indexExists) {
        const init = `# Wiki Index\n\n## 问答\n\n${indexLink}`
        await fs.writeFile(indexAbs, init, 'utf-8')
      } else {
        // 已有 index.md：在「## 问答」节后追加（无该节则创建并追加）
        const raw = await fs.readFile(indexAbs, 'utf-8')
        if (/## 问答/.test(raw)) {
          // 在「## 问答」段尾追加（找到下一个 ## 或文件末尾）
          const appended = raw.replace(/(## 问答\n[\s\S]*?)(?=\n## |\n*$)/, `$1${indexLink}`)
          await fs.writeFile(indexAbs, appended, 'utf-8')
        } else {
          // 没「## 问答」节 → 追加新节
          await fs.appendFile(indexAbs, `\n## 问答\n\n${indexLink}`, 'utf-8')
        }
      }
    }

    // 3. 加 log（schema §4 格式）
    const logAbs = path.join(wikiDir, 'log.md')
    const subject = String(q).slice(0, 30)
    const logLine = `## [${tsLog}] answer | ${subject}\n`
    try {
      await fs.access(logAbs)
      await fs.appendFile(logAbs, logLine, 'utf-8')
    } catch {
      await fs.writeFile(logAbs, logLine, 'utf-8')
    }

    // 4. 知识库刷新：重建 answer 独立索引并持久化（替换旧的「不重建 BM25」）
    const idx = await loadIndex(current.path)
    await this._rebuildAnswerBM25(idx, current)
    await saveIndex(current.path, idx)

    // 5. Task 6.6 (P6 健壮性)：末尾尝试轮转 log.md
    // - 失败不阻塞 recordAnswer 主流程（log 轮转是后台维护，不影响问答回填）
    // - rotateLog 内部已处理 log.md 不存在 / 未达阈值
    await this._maybeRotateLog()

    return { status: 'ok', answerPath: answerRel }
  }

module.exports = { recordAnswer }
