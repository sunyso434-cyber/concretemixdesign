const fs = require('fs')
const path = require('path')

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn()
  }
}), { virtual: true })

const { contextBridge, ipcRenderer } = require('electron')
require('../preload')

const electronAPI = contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'electronAPI')[1]
// preload 只在模块加载时调用 exposeInMainWorld，须在 beforeEach clearAllMocks 前记录暴露名单
const exposedNamesAtLoad = contextBridge.exposeInMainWorld.mock.calls.map(([name]) => name)

describe('preload IPC boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('stays self-contained for Electron sandboxed preload execution', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8')
    expect(source).not.toMatch(/require\(['"]\.\.?\//)
  })

  test('forwards allowed generic calls and events', () => {
    electronAPI.invoke('agent:run', { message: 'test' })
    electronAPI.on('agent:progress', jest.fn())
    electronAPI.on('agent:confirmation-request', jest.fn())
    electronAPI.on('agent:sessionUpdated', jest.fn())

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:run', { message: 'test' })
    expect(ipcRenderer.on).toHaveBeenCalledWith('agent:progress', expect.any(Function))
    expect(ipcRenderer.on).toHaveBeenCalledWith('agent:confirmation-request', expect.any(Function))
    expect(ipcRenderer.on).toHaveBeenCalledWith('agent:sessionUpdated', expect.any(Function))
  })

  test('allows the steer/follow_up/steer_immediate interrupt channels (v0.6.0/v0.6.1)', () => {
    expect(() => electronAPI.invoke('agent:steer', { sessionId: 's', msg: 'x' })).not.toThrow()
    expect(() => electronAPI.invoke('agent:follow_up', { sessionId: 's', msg: 'x' })).not.toThrow()
    expect(() => electronAPI.invoke('agent:steer_immediate', { sessionId: 's', msg: 'x' })).not.toThrow()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:steer', { sessionId: 's', msg: 'x' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:follow_up', { sessionId: 's', msg: 'x' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:steer_immediate', { sessionId: 's', msg: 'x' })
  })

  test('rejects unknown generic calls and events', () => {
    expect(() => electronAPI.invoke('shell:execute', 'whoami')).toThrow('IPC channel is not allowed')
    expect(() => electronAPI.on('secret:event', jest.fn())).toThrow('IPC channel is not allowed')
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
    expect(ipcRenderer.on).not.toHaveBeenCalled()
  })

  test('exposes the workspace APIs required by startup and folder selection', () => {
    expect(electronAPI.workspace.current).toEqual(expect.any(Function))
    expect(electronAPI.workspace.pickFolder).toEqual(expect.any(Function))

    electronAPI.workspace.current()
    electronAPI.workspace.pickFolder()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('workspace:current')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('workspace:pickFolder')
  })

  test('does not expose an unrestricted legacy window.electron bridge', () => {
    // preload 只暴露受限的 window.electronAPI，不再暴露旧的无白名单 window.electron
    expect(exposedNamesAtLoad).toContain('electronAPI')
    expect(exposedNamesAtLoad).not.toContain('electron')
  })

  test('exposes md reader APIs and allows md: channels', () => {
    expect(typeof electronAPI.md.read).toBe('function')
    expect(typeof electronAPI.md.write).toBe('function')
    expect(typeof electronAPI.md.watch).toBe('function')
    expect(typeof electronAPI.md.unwatch).toBe('function')
    expect(typeof electronAPI.md.onFileChanged).toBe('function')

    electronAPI.md.read('/x/a.md')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('md:read', { filePath: '/x/a.md' })

    electronAPI.md.write('/x/a.md', '# hi')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('md:write', { filePath: '/x/a.md', content: '# hi' })

    electronAPI.md.onFileChanged(jest.fn())
    expect(ipcRenderer.on).toHaveBeenCalledWith('md:file-changed', expect.any(Function))
  })
})
