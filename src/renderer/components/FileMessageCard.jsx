import React from 'react'
import { Card, Button, Space, App } from 'antd'
import {
  FileOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  FolderOpenOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import {
  basename,
  formatSize,
  iconForType,
  buildActions,
} from './FileMessageCard.core'

const ICON_MAP = {
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileMarkdownOutlined,
  FileOutlined,
}

/**
 * 聊天消息中的"已生成文件"卡片
 *
 * props.file = { path: string, size?: number, type?: 'docx'|'xlsx'|'md'|'pdf' }
 *
 * - 打开：通过 window.electronAPI.openFile(path) 在系统默认应用中打开
 * - 打开文件夹：通过 window.electronAPI.showInFolder(path) 高亮文件
 * - 复制路径：通过 navigator.clipboard.writeText(path) 复制完整路径
 */
export default function FileMessageCard({ file }) {
  const { message } = App.useApp()
  const filePath = file?.path || ''
  const fileName = basename(filePath)
  const sizeLabel = formatSize(file?.size)
  const typeLabel = file?.type || ''
  const Icon = ICON_MAP[iconForType(typeLabel)] || FileOutlined

  const actions = buildActions()

  const handleOpen = () => {
    const result = actions.onOpen(window.electronAPI, filePath)
    if (!result) {
      message.warning('当前环境不支持打开文件')
    }
  }

  const handleShowInFolder = () => {
    const result = actions.onShowInFolder(window.electronAPI, filePath)
    if (!result) {
      message.warning('当前环境不支持显示文件夹')
    }
  }

  const handleCopyPath = () => {
    if (!filePath) return
    const clipboard = navigator?.clipboard
    const result = actions.onCopyPath(clipboard, filePath)
    if (result !== undefined) {
      // Promise resolve → 复制请求已发出
      if (typeof result?.then === 'function') {
        result
          .then(() => message.success('路径已复制'))
          .catch(() => message.error('复制失败'))
      } else {
        message.success('路径已复制')
      }
    } else {
      message.warning('当前环境不支持复制')
    }
  }

  return (
    <Card
      size="small"
      style={{ width: 400, margin: '8px 0' }}
      data-testid="file-message-card"
      data-file-path={filePath}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Space>
          <Icon />
          <strong data-testid="file-message-card-name">已生成 {fileName}</strong>
        </Space>
        <Space wrap>
          <Button
            size="small"
            icon={<FileOutlined />}
            onClick={handleOpen}
            data-testid="file-message-card-open"
          >
            打开
          </Button>
          <Button
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={handleShowInFolder}
            data-testid="file-message-card-show"
          >
            打开文件夹
          </Button>
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={handleCopyPath}
            data-testid="file-message-card-copy"
          >
            复制路径
          </Button>
        </Space>
        <small data-testid="file-message-card-meta">{sizeLabel} · {typeLabel}</small>
      </Space>
    </Card>
  )
}
