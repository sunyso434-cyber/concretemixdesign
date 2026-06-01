import React, { useState, useEffect, useRef } from 'react'
import { Button, Table, message, Typography, Space, Tag, Popconfirm, Empty, Spin, Modal, Input, Form, Progress, Steps, Select } from 'antd'
import { UploadOutlined, DeleteOutlined, FileTextOutlined, ReloadOutlined, LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons'
import extractErrorMessage from '../utils/extractErrorMessage'

const { Title, Text, Paragraph } = Typography

// 进度阶段定义
const PROGRESS_STAGES = [
  { key: 'chunk', title: '文本分块' },
  { key: 'extract', title: 'AI提取条款' },
  { key: 'embed', title: '计算向量' },
  { key: 'save', title: '保存知识包' },
]

const CATEGORY_OPTIONS = [
  { label: '公路', value: '公路' },
  { label: '铁路', value: '铁路' },
  { label: '水工', value: '水工' },
  { label: '建筑', value: '建筑' },
  { label: '通用', value: '通用' },
  { label: '其他', value: '其他' },
]

const inferCategoryFromName = (name) => {
  if (/JTG|JT\/T|公路|桥涵|路面|道路/.test(name)) return '公路'
  if (/TB|铁路/.test(name)) return '铁路'
  if (/SL|水工|水利/.test(name)) return '水工'
  if (/JGJ|建筑/.test(name)) return '建筑'
  if (/GB|GB\/T/.test(name)) return '通用'
  return '其他'
}

const getQualityTag = (quality) => {
  const level = quality?.reviewLevel || 'normal'
  if (level === 'good') return <Tag color="green">质量良好</Tag>
  if (level === 'weak') return <Tag color="orange">需复核</Tag>
  return <Tag color="blue">质量普通</Tag>
}

const StandardsManager = () => {
  const [standards, setStandards] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [form] = Form.useForm()

  // 上传进度状态
  const [progressVisible, setProgressVisible] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [progressMessage, setProgressMessage] = useState('')
  const [progressSteps, setProgressSteps] = useState({})
  const progressListenerRef = useRef(null)

  // 加载规范列表
  const loadStandards = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.invoke('standards:list')
      const list = Array.isArray(result) ? result : []
      setStandards(list)
    } catch (error) {
      message.error('加载规范列表失败: ' + error.message)
      setStandards([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStandards()
    return () => {
      // 组件卸载时移除进度监听
      if (progressListenerRef.current) {
        window.electronAPI.removeListener(progressListenerRef.current)
        progressListenerRef.current = null
      }
    }
  }, [])

  // 选择MD文件
  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI.invoke('show-open-dialog', {
        properties: ['openFile'],
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      const filePaths = result?.data?.filePaths || result?.filePaths
      if (filePaths && filePaths.length > 0) {
        const filePath = filePaths[0]
        setSelectedFilePath(filePath)
        const fileName = filePath.split(/[/\\]/).pop().replace(/\.md$/i, '')
        form.setFieldsValue({
          standardName: fileName,
          version: '1.0',
          category: inferCategoryFromName(fileName),
          aliases: ''
        })
        setModalVisible(true)
      }
    } catch (error) {
      message.error('选择文件失败: ' + error.message)
    }
  }

  // 上传规范
  const handleUpload = async () => {
    try {
      const values = await form.validateFields()
      if (!selectedFilePath) {
        message.warning('请先选择Markdown文件')
        return
      }

      // 关闭填写弹窗，打开进度弹窗
      setModalVisible(false)
      setProgressVisible(true)
      setProgressPercent(0)
      setProgressStage('chunk')
      setProgressMessage('正在读取文件...')
      setProgressSteps({})
      setUploading(true)

      // 注册进度监听
      progressListenerRef.current = window.electronAPI.on('standards:upload-progress', (data) => {
        setProgressPercent(data.percent || 0)
        setProgressStage(data.stage || '')
        setProgressMessage(data.message || '')
        setProgressSteps(prev => ({
          ...prev,
          [data.stage]: {
            label: data.stageLabel || data.stage,
            message: data.message,
            done: data.stage === 'done' || data.percent >= 100
          }
        }))
      })

      const result = await window.electronAPI.invoke('standards:upload', {
        filePath: selectedFilePath,
        standardName: values.standardName,
        version: values.version,
        category: values.category,
        aliases: values.aliases,
      })

      // 移除监听
      if (progressListenerRef.current) {
        window.electronAPI.removeListener(progressListenerRef.current)
        progressListenerRef.current = null
      }

      // 检查结果
      if (result && result.success === false) {
        message.error('上传规范失败: ' + extractErrorMessage(result.error, '未知错误'))
        setProgressVisible(false)
      } else {
        setProgressPercent(100)
        setProgressStage('done')
        setProgressMessage('知识包构建完成')
        message.success('规范上传成功')
        // 延迟关闭进度弹窗
        setTimeout(() => {
          setProgressVisible(false)
          loadStandards()
        }, 1500)
      }
    } catch (error) {
      if (error.errorFields) {
        // 表单验证错误，恢复弹窗状态
        setProgressVisible(false)
        setModalVisible(true)
        return
      }
      message.error('上传规范失败: ' + error.message)
      setProgressVisible(false)
    } finally {
      setUploading(false)
      form.resetFields()
      setSelectedFilePath('')
    }
  }

  // 关闭进度弹窗（仅失败时可手动关闭）
  const handleProgressClose = () => {
    if (progressListenerRef.current) {
      window.electronAPI.removeListener(progressListenerRef.current)
      progressListenerRef.current = null
    }
    setProgressVisible(false)
  }

  // 取消上传弹窗
  const handleCancelModal = () => {
    setModalVisible(false)
    form.resetFields()
    setSelectedFilePath('')
  }

  // 删除规范
  const handleDelete = async (standardId) => {
    try {
      await window.electronAPI.invoke('standards:delete', { standardId })
      message.success('规范已删除')
      loadStandards()
    } catch (error) {
      message.error('删除失败: ' + error.message)
    }
  }

  // 根据当前阶段获取 Steps 的状态
  const getStepStatus = (stageKey, index) => {
    const stageData = progressSteps[stageKey]
    const stageKeys = PROGRESS_STAGES.map(s => s.key)
    const currentIndex = stageKeys.indexOf(progressStage)
    const stageDoneKeys = ['chunk', 'extract', 'embed', 'save']

    if (stageData && stageData.done) return 'finish'
    if (index === currentIndex || (stageKey === progressStage)) return 'process'
    // 已完成的阶段
    const currentIdx = stageDoneKeys.indexOf(progressStage)
    if (currentIdx >= 0 && index < currentIdx) return 'finish'
    // done 阶段所有步骤完成
    if (progressStage === 'done') return 'finish'
    return 'wait'
  }

  // 表格列定义
  const columns = [
    {
      title: '规范名称',
      dataIndex: 'name',
      key: 'name',
      render: (text) => (
        <Space>
          <FileTextOutlined />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 120,
      render: (text) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (text) => <Tag color="geekblue">{text || '其他'}</Tag>,
    },
    {
      title: '质量',
      dataIndex: 'quality',
      key: 'quality',
      width: 110,
      render: (quality) => getQualityTag(quality),
    },
    {
      title: '条款数',
      dataIndex: 'totalClauses',
      key: 'totalClauses',
      width: 100,
      render: (count) => count != null ? `${count} 条` : '-',
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (text) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title="确定删除此规范？"
          description="删除后规范条款将无法恢复"
          onConfirm={() => handleDelete(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            size="small"
          >
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={4}>
          <Title level={4} style={{ margin: 0 }}>
            <FileTextOutlined style={{ marginRight: 8 }} />
            规范管理
          </Title>
          <Text type="secondary">
            上传施工规范 Markdown 文件，并设置分类和别名。AI 会解析规范条款，系统会标记结构化质量并用于配合比审查。
          </Text>
        </Space>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={uploading}
            onClick={handleSelectFile}
          >
            上传规范MD
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadStandards}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        {standards.length === 0 && !loading ? (
          <Empty
            description="暂无规范，请点击上方按钮上传Markdown文件"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={standards}
            rowKey="id"
            size="middle"
            pagination={false}
          />
        )}
      </Spin>

      {/* 上传信息填写弹窗 */}
      <Modal
        title="上传规范"
        open={modalVisible}
        onOk={handleUpload}
        onCancel={handleCancelModal}
        confirmLoading={uploading}
        okText="确认上传"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">已选择文件：</Text>
          <Text strong ellipsis style={{ maxWidth: '100%', display: 'inline-block' }}>
            {selectedFilePath.split(/[/\\]/).pop()}
          </Text>
        </div>
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            name="standardName"
            label="规范名称"
            rules={[{ required: true, message: '请输入规范名称' }]}
          >
            <Input placeholder="例如：JGJ 55-2011 普通混凝土配合比设计规程" />
          </Form.Item>
          <Form.Item
            name="version"
            label="版本"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="例如：1.0 或 2011版" />
          </Form.Item>
          <Form.Item
            name="category"
            label="规范分类"
            rules={[{ required: true, message: '请选择规范分类' }]}
          >
            <Select options={CATEGORY_OPTIONS} placeholder="请选择规范分类" />
          </Form.Item>
          <Form.Item
            name="aliases"
            label="别名"
          >
            <Input placeholder="例如：JGJ55、公路桥涵；多个别名可用逗号分隔" />
          </Form.Item>
        </Form>
        <Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
          需要联网，系统将通过DeepSeek AI解析Markdown中的规范条款。解析时间视文件大小而定，请耐心等待。
        </Paragraph>
      </Modal>

      {/* 上传进度弹窗 */}
      <Modal
        title="正在解析规范"
        open={progressVisible}
        onCancel={progressStage !== 'done' ? handleProgressClose : undefined}
        footer={progressStage !== 'done' ? [
          <Button key="close" onClick={handleProgressClose}>关闭</Button>
        ] : null}
        closable={progressStage !== 'done'}
        maskClosable={false}
        width={520}
      >
        <div style={{ marginBottom: 24 }}>
          <Steps
            size="small"
            current={PROGRESS_STAGES.findIndex(s => s.key === progressStage)}
            items={PROGRESS_STAGES.map((stage, index) => ({
              title: stage.title,
              status: getStepStatus(stage.key, index),
            }))}
          />
        </div>

        <Progress
          percent={progressPercent}
          status={progressStage === 'done' ? 'success' : 'active'}
          strokeColor={{
            '0%': '#108ee9',
            '100%': '#87d068',
          }}
        />

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          {progressStage === 'done' ? (
            <Space>
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
              <Text strong style={{ color: '#52c41a' }}>解析完成！</Text>
            </Space>
          ) : (
            <Space>
              <LoadingOutlined spin />
              <Text type="secondary">{progressMessage}</Text>
            </Space>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default StandardsManager
