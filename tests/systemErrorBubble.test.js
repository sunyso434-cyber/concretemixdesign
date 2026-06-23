// tests/systemErrorBubble.test.js
// 注意：由于项目未安装 @testing-library/react，此测试暂不能执行
// 安装后可运行: npx jest tests/systemErrorBubble.test.js -v
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SystemErrorBubble from '../src/renderer/components/SystemErrorBubble'

const mockError = {
  code: 'E-LLM-401',
  title: 'AI 密钥无效或未配置',
  hint: '请到「设置」检查 API Key',
  recovery: 'fix_settings',
  details: { httpStatus: 401, endpoint: 'https://api.deepseek.com/v1/chat/completions' },
}

describe('SystemErrorBubble', () => {
  test('默认收起态显示编码 + 标题 + 建议', () => {
    render(<SystemErrorBubble errorPayload={mockError} previousAssistantContent="" />)
    expect(screen.getByText('[E-LLM-401]')).toBeInTheDocument()
    expect(screen.getByText('AI 密钥无效或未配置')).toBeInTheDocument()
    expect(screen.getByText(/设置/)).toBeInTheDocument()
  })

  test('点击"查看详情"展开 details', () => {
    render(<SystemErrorBubble errorPayload={mockError} previousAssistantContent="" />)
    fireEvent.click(screen.getByText('查看详情'))
    expect(screen.getByText('401')).toBeInTheDocument()
    expect(screen.getByText(/deepseek\.com/)).toBeInTheDocument()
  })

  test('点击"复制错误信息"调用 navigator.clipboard.writeText 含 previousAssistantContent', async () => {
    const writeText = jest.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<SystemErrorBubble errorPayload={mockError} previousAssistantContent="AI 已输出 50 字" />)
    fireEvent.click(screen.getByText('复制错误信息'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('AI 已输出 50 字'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('[E-LLM-401]'))
  })

  test('无 code 字段时不报错（旧会话历史兼容）', () => {
    const oldError = { message: 'legacy error', details: {} }
    render(<SystemErrorBubble errorPayload={oldError} previousAssistantContent="" />)
    expect(screen.getByText('legacy error')).toBeInTheDocument()
  })
})
