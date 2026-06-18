import React, { useState, useEffect } from 'react'
import { Drawer, List, Spin, Alert, Typography, Button } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const { Text } = Typography

export default function WorkspaceDrawer({ visible, onClose }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const pickWorkspace = async () => {
    try {
      const result = await window.electronAPI.workspace.pickFolder()
      if (result.canceled) return
      // 重新触发 listFiles effect，刷新文件列表
      setRefreshKey(k => k + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!visible) return
    setLoading(true)
    setError(null)
    setSelected(null)
    setContent('')
    window.electronAPI.workspace.listFiles('sources')
      .then(({ files }) => setFiles(files))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [visible, refreshKey])

  async function openFile(file) {
    setSelected(file)
    setContent('')
    setLoading(true)
    try {
      // P1 用简化版读（直接 fetch 文件）；P2 Task 2.7 后改用 window.electronAPI.workspace.readPage
      // v1.5.3 命名统一：window.electronAPI.workspace.*（不是 window.workspace.*）
      const readPage = window.electronAPI?.workspace?.readPage
      if (readPage) {
        const result = await readPage(`sources/${file.name}`)
        // v1.5.3 错误格式：result.success false 时显示 errorCode
        if (!result.success) {
          setError(`${result.errorCode}: ${result.error}`)
          setContent('')
        } else {
          setContent(result.content)
        }
      } else {
        // P1 mock：直接读
        setContent('P1 mock 内容 - P2 接入 readPage 后会显示真实内容')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Drawer
      title="工作区 - wiki 预览"
      placement="right"
      width={600}
      onClose={onClose}
      open={visible}
    >
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          onClick={pickWorkspace}
        >
          📂 打开工作区
        </Button>
      </div>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Spin spinning={loading}>
        {!selected ? (
          <List
            dataSource={files}
            renderItem={file => (
              <List.Item
                actions={[<Button type="link" onClick={() => openFile(file)}>查看</Button>]}
              >
                <Text>{file.name}</Text>
              </List.Item>
            )}
          />
        ) : (
          <>
            <Button onClick={() => { setSelected(null); setContent(''); setError(null) }} style={{ marginBottom: 12 }}>
              ← 返回列表
            </Button>
            <div className="chat-markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          </>
        )}
      </Spin>
    </Drawer>
  )
}
