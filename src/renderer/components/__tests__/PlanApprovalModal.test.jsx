/**
 * @jest-environment jsdom
 */
// 阶段 3 任务 3.3：PlanApprovalModal 计划审批弹窗组件测试
// 覆盖：步骤列表渲染（content + suggestedSkill）、三个按钮（确认/修改/取消）、
// 编辑模式增删改步骤、三个 IPC 回调（todo.confirmPlan / todo.replacePlan / todo.clear）
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// --- Mock window.electronAPI.todo（PlanApprovalModal 的 IPC 出口） ---
const confirmPlanMock = jest.fn().mockResolvedValue({ success: true })
const replacePlanMock = jest.fn().mockResolvedValue({ success: true })
const clearMock = jest.fn().mockResolvedValue({ success: true })

global.window = global.window || {}
global.window.electronAPI = {
  todo: {
    confirmPlan: confirmPlanMock,
    replacePlan: replacePlanMock,
    clear: clearMock
  }
}

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

const steps = [
  { id: 's1', content: '查规范', suggestedSkill: 'web_search' },
  { id: 's2', content: '做配合比', suggestedSkill: 'calculate_mix_design' },
  { id: 's3', content: '生成报告' }
]

const PlanApprovalModal = require('../PlanApprovalModal').default

describe('PlanApprovalModal 计划审批弹窗', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('渲染步骤列表（content + suggestedSkill）与三个按钮', async () => {
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)

    // 步骤内容渲染为 "1. 查规范"，用正则子串匹配
    expect(await screen.findByText(/查规范/)).toBeInTheDocument()
    expect(screen.getByText(/做配合比/)).toBeInTheDocument()
    expect(screen.getByText(/生成报告/)).toBeInTheDocument()
    // suggestedSkill 展示
    expect(screen.getByText(/建议技能：web_search/)).toBeInTheDocument()
    expect(screen.getByText(/建议技能：calculate_mix_design/)).toBeInTheDocument()
    // 三个按钮（antd 对两字中文按钮自动插空格 "确认"→"确 认"，用 \s* 匹配）
    expect(screen.getByRole('button', { name: /确\s*认/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修改计划' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /取\s*消/ })).toBeInTheDocument()
  })

  test('点击确认 → 调用 todo.confirmPlan(sessionId) 并关闭', async () => {
    const onClose = jest.fn()
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }))

    await waitFor(() => expect(confirmPlanMock).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  test('点击取消 → 调用 todo.clear(sessionId) 并关闭', async () => {
    const onClose = jest.fn()
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }))

    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  test('点击修改计划 → 进入编辑模式（含添加/删除），可改步骤内容', async () => {
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))

    // 编辑模式：出现输入框回填步骤内容
    const input = await screen.findByDisplayValue('查规范')
    expect(input).toBeInTheDocument()
    // 添加步骤按钮
    expect(screen.getByRole('button', { name: /添加步骤/ })).toBeInTheDocument()
    // 删除按钮（每个步骤一个）
    expect(screen.getAllByLabelText(/删除步骤/)).toHaveLength(3)
    // 保存修改按钮
    expect(screen.getByRole('button', { name: '保存修改' })).toBeInTheDocument()
  })

  test('编辑模式下删除一个步骤并保存 → 调用 todo.replacePlan(sessionId, 剩余步骤)', async () => {
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))

    // 删除第 1 个步骤（查规范）
    fireEvent.click(screen.getAllByLabelText(/删除步骤/)[0])
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(replacePlanMock).toHaveBeenCalledWith('s1', expect.not.arrayContaining([
        expect.objectContaining({ id: 's1' })
      ]))
    })
    const [, cleaned] = replacePlanMock.mock.calls[0]
    expect(cleaned).toHaveLength(2)
  })

  test('编辑模式下修改步骤内容并保存 → 传回带原 id 的编辑后数组', async () => {
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))

    fireEvent.change(await screen.findByDisplayValue('查规范'), { target: { value: '查最新规范' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(replacePlanMock).toHaveBeenCalledWith('s1', expect.arrayContaining([
        expect.objectContaining({ id: 's1', content: '查最新规范' })
      ]))
    })
  })

  test('编辑模式下新增一个步骤并保存 → 传回含新增步骤的数组', async () => {
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))

    fireEvent.click(screen.getByRole('button', { name: /添加步骤/ }))
    const newInputs = await screen.findAllByPlaceholderText('步骤内容')
    const lastInput = newInputs[newInputs.length - 1]
    fireEvent.change(lastInput, { target: { value: '验收' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(replacePlanMock).toHaveBeenCalledWith('s1', expect.arrayContaining([
        expect.objectContaining({ content: '验收' })
      ]))
    })
  })

  test('编辑模式下清空所有内容 → 不调 IPC，提示计划至少一个步骤', async () => {
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))

    // 清空三个步骤内容
    const values = ['查规范', '做配合比', '生成报告']
    for (const v of values) {
      fireEvent.change(await screen.findByDisplayValue(v), { target: { value: '' } })
    }
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    expect(replacePlanMock).not.toHaveBeenCalled()
  })

  test('modal 关闭时不渲染内容', () => {
    render(<PlanApprovalModal open={false} sessionId="s1" steps={steps} onClose={() => {}} />)
    expect(screen.queryByText('查规范')).not.toBeInTheDocument()
  })

  // === 审查修复 1：IPC 失败（success:false）不关弹窗 + 错误提示 ===
  test('确认失败（success:false）→ 不关弹窗且有错误提示', async () => {
    confirmPlanMock.mockResolvedValue({ success: false, error: '缺少 sessionId' })
    const onClose = jest.fn()
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /确\s*认/ }))

    await waitFor(() => expect(confirmPlanMock).toHaveBeenCalledWith('s1'))
    expect(await screen.findByText(/确认计划失败/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('取消失败（success:false）→ 不关弹窗且有错误提示', async () => {
    clearMock.mockResolvedValue({ success: false, error: '缺少 sessionId' })
    const onClose = jest.fn()
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }))

    await waitFor(() => expect(clearMock).toHaveBeenCalledWith('s1'))
    expect(await screen.findByText(/取消计划失败/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('保存修改失败（success:false）→ 不关弹窗且有错误提示', async () => {
    replacePlanMock.mockResolvedValue({ success: false, error: '每个计划步骤必须有 content 字段' })
    const onClose = jest.fn()
    render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(replacePlanMock).toHaveBeenCalled())
    expect(await screen.findByText(/保存修改失败/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  // === 审查修复 2：编辑模式保留步骤元数据（expectedParams / dependencies / priority / maxRetry） ===
  test('编辑回传保留步骤全量元数据', async () => {
    const metaSteps = [
      {
        id: 'm1',
        content: '查规范',
        suggestedSkill: 'web_search',
        expectedParams: { keyword: '规范' },
        dependencies: ['dep-1'],
        priority: 'high',
        maxRetry: 5
      },
      { id: 'm2', content: '做配合比' }
    ]
    render(<PlanApprovalModal open sessionId="s1" steps={metaSteps} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => {
      expect(replacePlanMock).toHaveBeenCalledWith('s1', expect.arrayContaining([
        expect.objectContaining({
          id: 'm1',
          content: '查规范',
          expectedParams: { keyword: '规范' },
          dependencies: ['dep-1'],
          priority: 'high',
          maxRetry: 5
        })
      ]))
    })
  })

  // === 审查修复 3：编辑状态跨开关重置（重开弹窗回到审阅视图） ===
  test('重开弹窗回到审阅视图（编辑状态被重置）', async () => {
    const { rerender } = render(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)
    // 进入编辑模式
    fireEvent.click(await screen.findByRole('button', { name: '修改计划' }))
    await screen.findByDisplayValue('查规范')  // 确认已进入编辑态

    // 关闭再重新打开
    rerender(<PlanApprovalModal open={false} sessionId="s1" steps={steps} onClose={() => {}} />)
    rerender(<PlanApprovalModal open sessionId="s1" steps={steps} onClose={() => {}} />)

    // 回到审阅视图：无编辑输入框、无"保存修改"，三键重新出现
    expect(await screen.findByRole('button', { name: /确\s*认/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修改计划' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('查规范')).not.toBeInTheDocument()
  })
})
