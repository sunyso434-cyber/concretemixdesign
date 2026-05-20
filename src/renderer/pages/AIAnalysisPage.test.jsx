import React from 'react'
import { render, screen } from '@testing-library/react'
import AIAnalysisPage from './AIAnalysisPage'

describe('AIAnalysisPage', () => {
  it('renders without crashing', () => {
    render(<AIAnalysisPage />)
    expect(screen.getByText('🤖 AI分析')).toBeInTheDocument()
  })

  it('renders page title', () => {
    render(<AIAnalysisPage />)
    const title = screen.getByText('🤖 AI分析')
    expect(title).toBeInTheDocument()
    expect(title.tagName).toBe('H2')
  })

  it('renders page subtitle', () => {
    render(<AIAnalysisPage />)
    expect(screen.getByText(/智能分析混凝土配合比数据/)).toBeInTheDocument()
  })

  it('renders Tabs with correct labels', () => {
    render(<AIAnalysisPage />)
    expect(screen.getByText('数据导入')).toBeInTheDocument()
    expect(screen.getByText('数据列表')).toBeInTheDocument()
    expect(screen.getByText('分析报告呈现')).toBeInTheDocument()
  })

  it('renders all three tabs', () => {
    render(<AIAnalysisPage />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
  })
})