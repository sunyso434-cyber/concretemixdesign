// src/renderer/components/ExportWizard.jsx
import React, { useState } from 'react'
import { Modal, Steps, Checkbox, Radio, Button, Space, Typography, Card } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'

const { Text, Paragraph } = Typography

const DATA_TYPES = [
  { key: 'materials', label: '原材料库' },
  { key: 'mixdesigns', label: '配合比方案' },
  { key: 'params', label: '系统参数' },
]

const FORMAT_OPTIONS = [
  { value: 'xlsx', label: 'Excel (.xlsx)', desc: '适合数据分析，保留格式' },
  { value: 'csv', label: 'CSV (.csv)', desc: '通用格式，体积小' },
  { value: 'json', label: 'JSON (.json)', desc: '适合程序直接读取' },
]

const ExportWizard = ({ onClose }) => {
  const [step, setStep] = useState(0)
  const [selectedTypes, setSelectedTypes] = useState(['materials', 'mixdesigns'])
  const [selectedFormat, setSelectedFormat] = useState('xlsx')
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const dialogResult = await window.electron.ipcRenderer.invoke('show-save-dialog', {
        title: '选择导出文件保存位置',
        defaultPath: `export-${new Date().toISOString().slice(0, 10)}.${selectedFormat}`,
        filters: [
          { name: FORMAT_OPTIONS.find(f => f.value === selectedFormat)?.label || 'File', extensions: [selectedFormat] }
        ],
      })
      if (dialogResult.data.canceled || !dialogResult.data.filePath) return

      await window.electron.ipcRenderer.invoke('start-export-task', {
        types: selectedTypes,
        format: selectedFormat,
        filePath: dialogResult.data.filePath,
      })
      onClose()
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title="导出数据"
      open={true}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <Steps
        current={step}
        items={[
          { title: '选择内容' },
          { title: '选择格式' },
          { title: '保存' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {step === 0 && (
        <div>
          <Paragraph>选择要导出的数据类型（可多选）：</Paragraph>
          <Space direction="vertical" style={{ width: '100%' }}>
            {DATA_TYPES.map(d => (
              <Card key={d.key} size="small" hoverable onClick={() => {
                setSelectedTypes(prev =>
                  prev.includes(d.key) ? prev.filter(k => k !== d.key) : [...prev, d.key]
                )
              }} style={{
                borderColor: selectedTypes.includes(d.key) ? '#1890ff' : '#f0f0f0',
                background: selectedTypes.includes(d.key) ? '#e6f7ff' : '#fff',
              }}>
                <Space>
                  <Checkbox checked={selectedTypes.includes(d.key)} />
                  <Text>{d.label}</Text>
                </Space>
              </Card>
            ))}
          </Space>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={() => setStep(1)} disabled={selectedTypes.length === 0}>
              下一步
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <Paragraph>选择导出格式：</Paragraph>
          <Radio.Group
            value={selectedFormat}
            onChange={e => setSelectedFormat(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {FORMAT_OPTIONS.map(f => (
              <Card key={f.value} size="small" hoverable style={{ borderColor: selectedFormat === f.value ? '#1890ff' : '#f0f0f0' }}>
                <Radio value={f.value}>
                  <Text strong>{f.label}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{f.desc}</Text>
                </Radio>
              </Card>
            ))}
          </Radio.Group>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep(0)}>上一步</Button>
            <Button type="primary" onClick={() => setStep(2)}>下一步</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <CheckCircleFilled style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
          <Paragraph>
            即将导出以下数据：<Text strong>{DATA_TYPES.filter(d => selectedTypes.includes(d.key)).map(d => d.label).join('、')}</Text>
          </Paragraph>
          <Paragraph type="secondary">
            格式：{FORMAT_OPTIONS.find(f => f.value === selectedFormat)?.label}
          </Paragraph>
          <Paragraph type="secondary">
            点击"导出"后将弹出文件保存对话框
          </Paragraph>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep(1)}>上一步</Button>
            <Button type="primary" loading={exporting} onClick={handleExport}>导出</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default ExportWizard