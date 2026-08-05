const fs = require('fs')
const os = require('os')
const path = require('path')

// 直接 require 模块实例（懒初始化，测试内自建）
const watcher = require('../../workspace/mdWatcher')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-watcher-'))
const target = path.join(tmp, 'a.md')
fs.writeFileSync(target, 'v1', 'utf-8')

async function waitEvent() {
  return new Promise(resolve => {
    watcher.setSender({ send: (channel, payload) => resolve({ channel, payload }) })
  })
}

// chokidar 的监视建立（_addToNodeFs 设基线）在后续事件循环轮次才完成：
// watch() 后若同步写入，基线会取到变更后状态 → 变更被漏检（Windows 实测必现）。
// 让出事件循环再写入，保证监视已就绪，测试确定性通过。
async function waitWatcherReady() {
  await new Promise(r => setTimeout(r, 300))
}

describe('mdWatcher', () => {
  test('watch 后外部修改触发 md:file-changed 事件', async () => {
    watcher.watch(target)
    await waitWatcherReady() // 等 chokidar 监视建立，避免同步写入被漏检（Windows 竞态）
    const p = waitEvent()
    // 模拟外部写入（原子替换，避免半截写触发两次）
    const tmpF = path.join(tmp, '.a.md.tmp')
    fs.writeFileSync(tmpF, 'v2', 'utf-8')
    fs.renameSync(tmpF, target)
    const evt = await p
    expect(evt.channel).toBe('md:file-changed')
    expect(path.normalize(evt.payload.filePath)).toBe(path.normalize(target))
    expect(typeof evt.payload.mtimeMs).toBe('number') // 事件携带最新 stat
    watcher.unwatch(target)
  })

  test('unwatch 后不再触发', async () => {
    watcher.watch(target)
    watcher.unwatch(target)
    const got = []
    watcher.setSender({ send: (ch, p) => got.push(p) })
    fs.writeFileSync(target, 'v3', 'utf-8')
    await new Promise(r => setTimeout(r, 400))
    expect(got.length).toBe(0)
  })

  test('无监视项时 close 释放', async () => {
    watcher.watch(target)
    watcher.unwatch(target)
    expect(watcher.watchingCount).toBe(0)
  })

  afterAll(() => watcher.close())
})
