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
const legacyElectron = contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'electron')[1]

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

  test('does not expose unrestricted legacy send/once/removeAllListeners methods', () => {
    expect(legacyElectron.ipcRenderer.send).toBeUndefined()
    expect(legacyElectron.ipcRenderer.once).toBeUndefined()
    expect(legacyElectron.ipcRenderer.removeAllListeners).toBeUndefined()
  })
})
