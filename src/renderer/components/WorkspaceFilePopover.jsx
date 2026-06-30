// src/renderer/components/WorkspaceFilePopover.jsx
//
// P1 补全 - 工作区文件列表 Popover
// - 入口：智能助手输入框下方 📋 按钮
// - 显示工作区根目录文件 + 已导入状态
// - 支持逐个导入 + 批量导入全部
//
// 行为：
// 1. 打开时自动调 listFiles('root') + listFiles('wiki/sources') 合并
// 2. 支持的扩展名（txt/md/pdf/docx/xlsx）显示「📥 导入」
// 3. 不支持的灰色，不显示按钮
// 4. 已导入（slug 在 wiki 目录中）显示「✅ 已导入」+ 「🔄 重新导入」
// 5. 「📥 导入全部」按选中顺序串行执行

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Popover, Checkbox, Button, Space, message, Spin, Empty, Divider, Tooltip, Tag, Progress } from 'antd'
import {
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileOutlined,
  ImportOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined
} from '@ant-design/icons'
import { toSlug, isSupportedExt, getImportedSlugs } from '../utils/workspaceFile'

// 根据扩展名选图标
function fileIcon(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return <FileTextOutlined />
  if (lower.endsWith('.xlsx')) return <FileExcelOutlined />
  if (lower.endsWith('.pdf')) return <FilePdfOutlined />
  if (lower.endsWith('.docx')) return <FileWordOutlined />
  return <FileOutlined style={{ color: '#bfbfbf' }} />
}

const WorkspaceFilePopover = ({ workspacePath, children }) => {
  const [open, setOpen] = useState(false)
  const [rootFiles, setRootFiles] = useState([])      // 工作区根目录文件
  const [importedSlugs, setImportedSlugs] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [importingIds, setImportingIds] = useState(new Set()) // 正在导入的文件名
  const [failedFiles, setFailedFiles] = useState({})  // filename -> error message
  const [selected, setSelected] = useState(new Set()) // 选中的文件名

  // v9.1.0 补充：批量导入进度/取消状态
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({
    batchId: null,
    current: 0,
    total: 0,
    percent: 0,
    status: 'idle',
    currentFile: '',
    errors: []
  })
  const [cancelling, setCancelling] = useState(false)

  const popoverRef = useRef(null)
  const progressListenerRef = useRef(null)
  const doneListenerRef = useRef(null)

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    try {
      const [rootResult, wikiResult] = await Promise.all([
        window.electronAPI.workspace.listFiles('root'),
        window.electronAPI.workspace.listFiles('wiki/sources').catch(() => ({ files: [] }))
      ])
      const files = rootResult?.files || []
      const wikiFiles = wikiResult?.files || []
      const slugs = getImportedSlugs(wikiFiles)
      setRootFiles(files)
      setImportedSlugs(slugs)
    } catch (err) {
      console.error('[WorkspaceFilePopover] 加载文件失败:', err)
      message.error('加载文件列表失败: ' + (err.message || err))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  // v9.1.0 补充：注册批量导入进度/完成监听
  useEffect(() => {
    progressListenerRef.current = window.electronAPI.workspace.onIngestBatchProgress((progress) => {
      setBatchProgress(prev => ({
        ...prev,
        batchId: progress.batchId ?? prev.batchId,
        current: progress.current,
        total: progress.total,
        percent: progress.percent,
        status: progress.status,
        currentFile: progress.filename,
        errors: progress.status === 'error'
          ? [...(prev.errors || []), { filename: progress.filename, error: progress.error }]
          : prev.errors
      }))
    })
    doneListenerRef.current = window.electronAPI.workspace.onIngestBatchDone((result) => {
      setBatchRunning(false)
      setCancelling(false)
      // 刷新已导入状态
      loadFiles()
      const statusText = {
        ok: '全部导入成功',
        partial: '部分导入成功',
        failed: '导入失败',
        cancelled: '已取消'
      }[result.status] || result.status
      if (result.status === 'ok') {
        message.success(`${statusText}（${result.succeeded}/${result.total}）`)
      } else if (result.status === 'cancelled') {
        message.info(`${statusText}，已处理 ${result.succeeded}/${result.total}`)
      } else {
        message.warning(`${statusText}，成功 ${result.succeeded}，失败 ${result.failed}`)
      }
    })
    return () => {
      if (progressListenerRef.current) {
        window.electronAPI.workspace.removeIngestBatchListener(progressListenerRef.current)
      }
      if (doneListenerRef.current) {
        window.electronAPI.workspace.removeIngestBatchListener(doneListenerRef.current)
      }
    }
  }, [loadFiles])

  // 打开时自动加载
  useEffect(() => {
    if (open) {
      loadFiles()
      setSelected(new Set()) // 清空选中
      setFailedFiles({})
    }
  }, [open, loadFiles])

  // 关闭时清状态；如果批量导入还在跑，自动取消
  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setFailedFiles({})
      if (batchRunning && batchProgress.batchId) {
        window.electronAPI.workspace.cancelIngestBatch(batchProgress.batchId).catch(() => {})
        setBatchRunning(false)
        setCancelling(false)
      }
    }
  }, [open, batchRunning, batchProgress.batchId])

  // 触发 ingest 单个文件
  const handleImport = useCallback(async (filename) => {
    setImportingIds(prev => new Set(prev).add(filename))
    setFailedFiles(prev => {
      const next = { ...prev }
      delete next[filename]
      return next
    })
    try {
      const result = await window.electronAPI.workspace.ingest(filename)
      // P1 补全 hotfix (v4.8.4): 后端 ErrorCodes.createError 返回的错误格式
      // 实际字段是 `error`（不是 `message`），且带 errorCode/hint/recovery。
      // 修复：把整包错误对象透传，让 toast 显示具体错误码 + 错误消息
      if (result?.success === false) {
        const errDetail = `[${result.errorCode || 'UNKNOWN'}] ${result.error || '导入失败'}${result.hint ? ` (${result.hint})` : ''}`
        throw new Error(errDetail)
      }
      message.success(`已导入 ${filename}`)
      // 刷新 slug 状态
      setImportedSlugs(prev => new Set([...prev, toSlug(filename)]))
    } catch (err) {
      const errMsg = err.message || String(err)
      setFailedFiles(prev => ({ ...prev, [filename]: errMsg }))
      message.error(`导入 ${filename} 失败: ${errMsg}`)
    } finally {
      setImportingIds(prev => {
        const next = new Set(prev)
        next.delete(filename)
        return next
      })
    }
  }, [])

  // v9.1.0 补充：批量导入（走后端 ingestBatch，带进度推送 + 可取消）
  const handleImportAll = useCallback(async () => {
    const filenames = [...selected].filter(f => isSupportedExt(f)).sort()
    if (filenames.length === 0) return

    setBatchProgress({
      batchId: null,
      current: 0,
      total: filenames.length,
      percent: 0,
      status: 'processing',
      currentFile: filenames[0],
      errors: []
    })
    setBatchRunning(true)
    setCancelling(false)
    setFailedFiles({})

    try {
      const result = await window.electronAPI.workspace.ingestBatch(filenames)
      if (result?.success === false) {
        throw new Error(result.error || '启动批量导入失败')
      }
      setBatchProgress(prev => ({ ...prev, batchId: result.batchId }))
    } catch (err) {
      message.error('启动批量导入失败: ' + (err.message || String(err)))
      setBatchRunning(false)
    }
  }, [selected])

  // v9.1.0 补充：取消批量导入
  const handleCancelBatch = useCallback(async () => {
    if (!batchProgress.batchId) return
    setCancelling(true)
    try {
      await window.electronAPI.workspace.cancelIngestBatch(batchProgress.batchId)
    } catch (err) {
      message.error('取消失败: ' + (err.message || String(err)))
      setCancelling(false)
    }
  }, [batchProgress.batchId])

  // 切换 checkbox
  const toggleSelect = useCallback((filename) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(filename)) next.delete(filename)
      else next.add(filename)
      return next
    })
  }, [])

  // 全选/取消全选（只选 supported）
  const toggleSelectAll = useCallback(() => {
    const supportedFiles = rootFiles.filter(f => isSupportedExt(f.name))
    const allSelected = supportedFiles.every(f => selected.has(f.name))
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(supportedFiles.map(f => f.name)))
    }
  }, [rootFiles, selected])

  // 选中的 supported 文件数
  const selectedSupportedCount = [...selected].filter(f => isSupportedExt(f)).length
  const supportedTotal = rootFiles.filter(f => isSupportedExt(f.name)).length
  const allSupportedSelected = supportedTotal > 0 && selectedSupportedCount === supportedTotal

  // 渲染文件行
  const renderFileRow = (file) => {
    const slug = toSlug(file.name)
    const supported = isSupportedExt(file.name)
    const isImported = importedSlugs.has(slug)
    const isImporting = importingIds.has(file.name)
    const isFailed = !!failedFiles[file.name]
    const isSelected = selected.has(file.name)

    return (
      <div
        key={file.name}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderRadius: 4,
          background: isFailed ? '#fff1f0' : 'transparent',
          opacity: supported ? 1 : 0.4
        }}
      >
        {supported ? (
          <Checkbox
            checked={isSelected}
            onChange={() => toggleSelect(file.name)}
            disabled={isImporting || batchRunning}
          />
        ) : (
          <span style={{ width: 16, display: 'inline-block' }} />
        )}
        <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {fileIcon(file.name)}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </span>
        </span>
        {isFailed && (
          <Tooltip title={failedFiles[file.name]}>
            <Tag color="error" icon={<CloseCircleOutlined />} style={{ margin: 0 }}>
              失败
            </Tag>
          </Tooltip>
        )}
        {!isFailed && isImported && (
          <Tag color="success" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>
            已导入
          </Tag>
        )}
        {supported && (
          <Button
            type="text"
            size="small"
            icon={isImported ? <ReloadOutlined /> : <ImportOutlined />}
            loading={isImporting}
            disabled={batchRunning}
            onClick={() => handleImport(file.name)}
            title={isImported ? '重新导入' : '导入到知识库'}
          />
        )}
      </div>
    )
  }

  const popoverContent = (
    <div style={{ width: 360, maxHeight: 480, display: 'flex', flexDirection: 'column' }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 8, borderBottom: '1px solid #f0f0f0'
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          📁 {workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).pop() : ''}
        </span>
        <Space size={4}>
          <Tooltip title="刷新">
            <Button
              type="text" size="small" icon={<ReloadOutlined />}
              onClick={loadFiles} loading={loading}
            />
          </Tooltip>
          <Button
            type="text" size="small" icon={<CloseOutlined />}
            onClick={() => setOpen(false)}
          />
        </Space>
      </div>

      {/* v9.1.0 补充：批量导入整体进度条 */}
      {batchRunning && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: '#f6ffed',
          borderRadius: 4,
          border: '1px solid #b7eb8f'
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 4
          }}>
            <span style={{ fontSize: 12 }}>
              {cancelling
                ? '取消中...'
                : `导入中 ${batchProgress.current}/${batchProgress.total}`}
            </span>
            <Button
              type="text"
              size="small"
              danger
              loading={cancelling}
              disabled={cancelling}
              onClick={handleCancelBatch}
            >
              取消
            </Button>
          </div>
          <Progress
            percent={batchProgress.percent}
            size="small"
            status={cancelling ? 'exception' : undefined}
            showInfo={false}
          />
          <div style={{
            fontSize: 11, color: '#666', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {batchProgress.currentFile}
          </div>
        </div>
      )}

      {/* 文件列表 */}
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 8, minHeight: 100 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Spin />
          </div>
        ) : rootFiles.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="工作区根目录无文件"
            style={{ padding: '20px 0' }}
          />
        ) : (
          rootFiles.map(renderFileRow)
        )}
      </div>

      {/* 底部批量 */}
      {rootFiles.length > 0 && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Checkbox
              checked={allSupportedSelected}
              indeterminate={selectedSupportedCount > 0 && !allSupportedSelected}
              onChange={toggleSelectAll}
              disabled={supportedTotal === 0 || batchRunning}
            >
              全选 ({selectedSupportedCount}/{supportedTotal})
            </Checkbox>
            {batchRunning ? (
              <Button
                type="primary"
                danger
                size="small"
                loading={cancelling}
                disabled={cancelling}
                onClick={handleCancelBatch}
              >
                取消导入
              </Button>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<ImportOutlined />}
                disabled={selectedSupportedCount === 0 || importingIds.size > 0}
                loading={importingIds.size > 0}
                onClick={handleImportAll}
              >
                导入全部 ({selectedSupportedCount})
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <Popover
      ref={popoverRef}
      content={popoverContent}
      title={null}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="topLeft"
      destroyTooltipOnHide
    >
      {children}
    </Popover>
  )
}

export default WorkspaceFilePopover
