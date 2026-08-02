/**
 * @jest-environment jsdom
 */
// R10：RemotePanel（桌面「远程连接」面板）组件测试
// 用 jsdom 渲染真实 antd 组件；mock window.electronAPI.remote.* 与 qrcode，
// 断言：二维码渲染（JSON 内容）、配对码有效期、连接状态、启用开关（默认关）、
// 随机密码一次性展示 + 重置密码、域名输入与保存。
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// --- Mock qrcode：捕获二维码内容，并返回固定 dataURL 供 img 断言 ---
const mockToDataURL = jest.fn()
jest.mock('qrcode', () => ({
  toDataURL: (...args) => mockToDataURL(...args)
}))

// --- Mock window.electronAPI.remote.* ---
const remoteMock = {
  getPairCode: jest.fn(),
  getStatus: jest.fn(),
  setEnabled: jest.fn(),
  resetPassword: jest.fn(),
  setDomain: jest.fn()
}
global.window = global.window || {}
global.window.electronAPI = { remote: remoteMock }

// --- jsdom 缺省 polyfill（antd v5 依赖 matchMedia / ResizeObserver） ---
if (!global.window.matchMedia) {
  global.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn()
  })
}
if (!global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const WS_URL = 'wss://www.concreteagent.cloud/concrete/ws'
const baseStatus = {
  enabled: false,
  pairedDevices: 2,
  connectedClients: 0,
  domain: 'www.concreteagent.cloud'
}

beforeEach(() => {
  jest.clearAllMocks()
  mockToDataURL.mockResolvedValue('data:image/png;base64,FAKEQR')
  remoteMock.getStatus.mockResolvedValue({ ...baseStatus })
  remoteMock.getPairCode.mockResolvedValue({
    code: 'ABCD2345',
    expiresAt: Date.now() + 5 * 60 * 1000,
    addr: WS_URL
  })
  remoteMock.setEnabled.mockResolvedValue({ enabled: true, tempPassword: null })
  remoteMock.resetPassword.mockResolvedValue({ password: 'NewPass123' })
  remoteMock.setDomain.mockResolvedValue({ domain: 'example.com' })
})

// 每个用例渲染前都重新 require，隔离组件内部模块状态
const RemotePanel = require('../RemotePanel').default

describe('RemotePanel 桌面远程连接面板', () => {
  test('挂载后请求状态与配对码，并用 addr+code 生成 JSON 二维码', async () => {
    render(<RemotePanel />)

    await waitFor(() => {
      expect(remoteMock.getStatus).toHaveBeenCalledTimes(1)
      expect(remoteMock.getPairCode).toHaveBeenCalledTimes(1)
    })

    // 二维码 JSON 与 F2 手机端一致
    await waitFor(() => {
      expect(mockToDataURL).toHaveBeenCalledTimes(1)
    })
    const qrText = mockToDataURL.mock.calls[0][0]
    expect(JSON.parse(qrText)).toEqual({ addr: WS_URL, code: 'ABCD2345' })

    // 二维码以 <img> 渲染
    const img = screen.getByTestId('qr-img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,FAKEQR')

    // 配对码与有效期展示
    expect(screen.getByTestId('pair-code')).toHaveTextContent('ABCD2345')
    expect(screen.getByTestId('pair-ttl')).toHaveTextContent('剩余')
  })

  test('启用开关默认关闭（status.enabled=false）', async () => {
    render(<RemotePanel />)
    const sw = await screen.findByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  test('打开开关调用 setEnabled(true)，首次启用返回的随机密码一次性展示', async () => {
    remoteMock.setEnabled.mockResolvedValue({ enabled: true, tempPassword: 'PwA1b2C3' })
    render(<RemotePanel />)
    const sw = await screen.findByRole('switch')
    fireEvent.click(sw)

    await waitFor(() => {
      expect(remoteMock.setEnabled).toHaveBeenCalledWith(true)
    })
    await waitFor(() => {
      expect(screen.getByTestId('temp-password')).toHaveTextContent('PwA1b2C3')
    })
  })

  test('关闭开关调用 setEnabled(false)，且不展示新密码', async () => {
    remoteMock.getStatus.mockResolvedValue({ ...baseStatus, enabled: true })
    remoteMock.setEnabled.mockResolvedValue({ enabled: false })
    render(<RemotePanel />)
    const sw = await screen.findByRole('switch')
    fireEvent.click(sw)

    await waitFor(() => {
      expect(remoteMock.setEnabled).toHaveBeenCalledWith(false)
    })
    expect(screen.queryByTestId('temp-password')).not.toBeInTheDocument()
  })

  test('重置密码调用 resetPassword 并一次性展示新密码', async () => {
    render(<RemotePanel />)
    await screen.findByRole('button', { name: /重置密码/ })
    fireEvent.click(screen.getByRole('button', { name: /重置密码/ }))

    await waitFor(() => {
      expect(remoteMock.resetPassword).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('temp-password')).toHaveTextContent('NewPass123')
    })
  })

  test('域名输入框回填已保存域名，保存时调用 setDomain', async () => {
    render(<RemotePanel />)
    const input = await screen.findByTestId('domain-input')
    expect(input).toHaveValue('www.concreteagent.cloud')

    fireEvent.change(input, { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /保存域名/ }))

    await waitFor(() => {
      expect(remoteMock.setDomain).toHaveBeenCalledWith('example.com')
    })
  })

  test('未设置域名时不渲染二维码，并提示先设置域名', async () => {
    remoteMock.getStatus.mockResolvedValue({ ...baseStatus, domain: '' })
    remoteMock.getPairCode.mockResolvedValue({
      code: 'ABCD2345',
      expiresAt: Date.now() + 60 * 1000,
      addr: null
    })
    render(<RemotePanel />)

    await waitFor(() => {
      expect(screen.getByText(/设置域名/i)).toBeInTheDocument()
    })
    expect(mockToDataURL).not.toHaveBeenCalled()
    expect(screen.queryByTestId('qr-img')).not.toBeInTheDocument()
  })

  test('展示已配对设备数与在线客户端数', async () => {
    remoteMock.getStatus.mockResolvedValue({
      ...baseStatus,
      pairedDevices: 3,
      connectedClients: 4
    })
    render(<RemotePanel />)

    await waitFor(() => {
      expect(screen.getByTestId('stat-paired')).toHaveTextContent('3')
    })
    expect(screen.getByTestId('stat-clients')).toHaveTextContent('4')
  })
})
