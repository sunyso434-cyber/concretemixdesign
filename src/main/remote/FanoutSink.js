/**
 * FanoutSink：事件扇出器。
 *
 * 把 Agent 执行链产生的事件同时广播给多个"目标"（鸭子类型）：
 *   - 桌面端 webContents（Electron IPC channel）
 *   - 已连接的手机 WebSocket
 *
 * 目标对象只需具备：
 *   - send(channel, payload)        —— 收到事件的出口
 *   - isDestroyed?.()                —— 可选，用于判断目标是否失效（无此方法视为存活）
 *   - onClose?.(cb)                  —— 可选，目标关闭时回调（用于自动移除，防目标集泄漏）
 */
class FanoutSink {
  constructor() {
    this._targets = new Set()
  }

  /**
   * 注册一个目标。若目标暴露 onClose(cb)，则在其关闭时自动 removeTarget。
   */
  addTarget(t) {
    if (this._targets.has(t)) return
    this._targets.add(t)
    if (typeof t.onClose === 'function') {
      t.onClose(() => this.removeTarget(t))
    }
  }

  removeTarget(t) {
    this._targets.delete(t)
  }

  /**
   * 广播事件到所有目标。逐个 try/catch，单个目标抛错不影响其他目标。
   */
  send(channel, payload) {
    for (const t of this._targets) {
      try {
        t.send(channel, payload)
      } catch (err) {
        // 单个目标失败不中断广播；记录但不抛给调用方
        // eslint-disable-next-line no-console
        console.error(`[FanoutSink] 广播到目标失败: ${err && err.message ? err.message : err}`)
      }
    }
  }

  /**
   * 所有目标都失效（或没有目标）才返回 true；任一目标存活即为 false。
   * 目标未提供 isDestroyed 方法时视为存活。
   */
  isDestroyed() {
    for (const t of this._targets) {
      let alive = true
      if (typeof t.isDestroyed === 'function') {
        try {
          alive = !t.isDestroyed()
        } catch {
          alive = true // 判定异常 → 保守视为存活
        }
      }
      if (alive) return false
    }
    return true
  }
}

/**
 * 把裸 ws 包成鸭子类型目标。
 *  - send: readyState 为 OPEN(1) 时把 { channel, payload } 序列化后发出，否则静默跳过
 *  - isDestroyed: readyState !== 1
 *  - onClose(cb): 注册 ws 'close' 时触发的回调（FanoutSink.addTarget 会用它自动 removeTarget）
 */
function wrapWs(ws) {
  const closeHandlers = new Set()
  ws.on('close', () => {
    for (const cb of closeHandlers) {
      try {
        cb()
      } catch {
        // 单个 close 回调抛错不阻断其余回调
      }
    }
    closeHandlers.clear()
  })

  return {
    send(channel, payload) {
      if (ws.readyState !== 1) return
      ws.send(JSON.stringify({ channel, payload }))
    },
    isDestroyed() {
      return ws.readyState !== 1
    },
    onClose(cb) {
      closeHandlers.add(cb)
    }
  }
}

/**
 * 把 Electron webContents 包成鸭子类型目标（纯鸭子类型包装，不 require electron）。
 *  - send: 透传 wc.send(channel, payload)
 *  - isDestroyed: 透传 wc.isDestroyed()
 *  - onClose(cb): 注册 wc 'closed' 时触发的回调（自动 removeTarget）
 */
function wrapWebContents(wc) {
  const closeHandlers = new Set()
  wc.on('closed', () => {
    for (const cb of closeHandlers) {
      try {
        cb()
      } catch {
        // 单个回调抛错不阻断其余回调
      }
    }
    closeHandlers.clear()
  })

  return {
    send(channel, payload) {
      wc.send(channel, payload)
    },
    isDestroyed() {
      return wc.isDestroyed()
    },
    onClose(cb) {
      closeHandlers.add(cb)
    }
  }
}

module.exports = { FanoutSink, wrapWs, wrapWebContents }
