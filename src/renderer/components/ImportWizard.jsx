// src/renderer/components/ImportWizard.jsx
import React, { useState, useRef } from 'react'
import { Modal, Steps, Radio, Button, Table, Space, Typography, Alert, Card, message } from 'antd'
import { DownloadOutlined, UploadOutlined, FileExcelFilled } from '@ant-design/icons'
import { downloadTemplate } from '../utils/templateDownloader'

const { Text, Paragraph } = Typography

const IMPORT_TYPES = [
  { value: 'materials', label: '原材料', desc: '导入完整原材料数据，支持7种材料类别（水泥、粉煤灰、矿渣粉、细骨料、粗骨料、外加剂、水），包含所有技术指标' },
  { value: 'mixdesigns', label: '配合比方案', desc: '导入配合比设计结果，包含方案信息、材料用量、骨料分配和计算参数' },
]

const ImportWizard = ({ onClose }) => {
  const [step, setStep] = useState(0)
  const [importType, setImportType] = useState('materials')
  const [previewData, setPreviewData] = useState([])
  const [previewColumns, setPreviewColumns] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [importing, setImporting] = useState(false)
  const [filePath, setFilePath] = useState('')
  const fileInputRef = useRef()

  // 上传文件并预览
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const dialogResult = await window.electron.ipcRenderer.invoke('show-open-dialog', {
      title: '选择要导入的文件',
      filters: [
        { name: 'Excel/CSV', extensions: ['xlsx', 'csv'] },
      ],
      properties: ['openFile'],
    })
    if (dialogResult.data.canceled || dialogResult.data.filePaths.length === 0) return

    const selectedPath = dialogResult.data.filePaths[0]
    setFilePath(selectedPath)

    try {
      const result = await window.electron.ipcRenderer.invoke('parse-import-file', selectedPath)
      if (result && result.success) {
        setPreviewData(result.data.rows.slice(0, 10))
        setPreviewColumns(result.data.columns)
        setTotalCount(result.data.rows.length)
        setStep(3)
      } else {
        console.error('parse-import-file failed:', result?.error)
        alert('解析文件失败：' + (result?.error || '未知错误'))
      }
    } catch (err) {
      console.error('parse-import-file exception:', err)
      alert('解析文件异常：' + err.message)
    }
  }

  // 确认导入
  const handleConfirmImport = async () => {
    setImporting(true)
    try {
      await window.electron.ipcRenderer.invoke('start-import-task', {
        type: importType,
        filePath,
      })
      onClose()
    } finally {
      setImporting(false)
    }
  }

  const columns = previewColumns.map(col => ({ title: col, dataIndex: col, key: col }))

  return (
    <Modal
      title="导入数据"
      open={true}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <Steps
        current={step}
        items={[
          { title: '选择类型' },
          { title: '下载模板' },
          { title: '上传文件' },
          { title: '预览确认' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {step === 0 && (
        <div>
          <Paragraph>选择要导入的数据类型：</Paragraph>
          <Radio.Group
            value={importType}
            onChange={e => setImportType(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {IMPORT_TYPES.map(t => (
              <Card key={t.value} size="small" hoverable style={{ borderColor: importType === t.value ? '#1890ff' : '#f0f0f0' }}>
                <Radio value={t.value}>
                  <Text strong>{t.label}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t.desc}</Text>
                </Radio>
              </Card>
            ))}
          </Radio.Group>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={() => setStep(1)}>下一步</Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <FileExcelFilled style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
          <Paragraph>请先下载导入模板</Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            {importType === 'materials'
              ? '模板包含7个材料类别Sheet，按类别填写数据。所有Sheet共享通用字段（名称、规格、厂家等），每个Sheet还有其特有的技术指标字段。'
              : '模板包含配合比主数据Sheet和关联明细Sheet。请先填写配合比方案Sheet。'}
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            <Text strong>重要：</Text>请勿修改表头格式（中文 / 英文）
          </Paragraph>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => downloadTemplate('import')}
            style={{ marginTop: 16 }}
          >
            下载 {IMPORT_TYPES.find(t => t.value === importType)?.label} 导入模板
          </Button>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={() => setStep(2)}>已下载模板，继续</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <UploadOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
          <Paragraph>选择已填写好的 {IMPORT_TYPES.find(t => t.value === importType)?.label} 数据文件</Paragraph>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => fileInputRef.current?.click()}
            style={{ marginTop: 16 }}
          >
            选择文件上传
          </Button>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-start' }}>
            <Button onClick={() => setStep(0)}>上一步</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <Alert
            message={`共 ${totalCount} 条记录，以下为前 ${previewData.length} 条预览`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Table
            columns={columns}
            dataSource={previewData}
            rowKey={(row, idx) => idx}
            size="small"
            scroll={{ x: 'max-content' }}
            pagination={false}
          />
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep(2)}>上一步</Button>
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button type="primary" loading={importing} onClick={handleConfirmImport}>
                确认导入 {totalCount} 条
              </Button>
            </Space>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default ImportWizard