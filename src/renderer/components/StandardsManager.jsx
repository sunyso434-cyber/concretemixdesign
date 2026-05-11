import React, { useState, useEffect } from 'react'
import { Button, Table, Upload, message, Typography, Space, Tag, Popconfirm, Empty, Spin, Modal, Input, Form } from 'antd'
import { UploadOutlined, DeleteOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

const StandardsManager = () => {
  const [standards, setStandards] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [form] = Form.useForm()

  // 加载规范列表
  const loadStandards = async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.invoke('standards:list')
      setStandards(list || [])
    } catch (error) {
      message.error('加载规范列表失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStandards()
  }, [])

  // 选择PDF文件
  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI.invoke('show-open-dialog', {
        properties: ['openFile'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result && result.filePaths && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        setSelectedFilePath(filePath)
        // 从文件名中提取默认规范名称
        const fileName = filePath.split(/[/\\]/).pop().replace(/\.pdf$/i, '')
        form.setFieldsValue({ standardName: fileName, version: '1.0' })
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
        message.warning('请先选择PDF文件')
        return
      }

      setUploading(true)
      const standardId = 'std_' + Date.now()
      await window.electronAPI.invoke('standards:upload', {
        filePath: selectedFilePath,
        standardId,
        standardName: values.standardName,
        version: values.version,
      })
      message.success('规范上传成功')
      setModalVisible(false)
      form.resetFields()
      setSelectedFilePath('')
      loadStandards()
    } catch (error) {
      if (error.errorFields) {
        // 表单验证错误，不额外提示
        return
      }
      message.error('规范上传失败: ' + error.message)
    } finally {
      setUploading(false)
    }
  }

  // 取消上传
  const handleCancelUpload = () => {
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

  // 表格列定义
  const columns = [
    {
      title: '规范名称',
      dataIndex: 'standardName',
      key: 'standardName',
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
      title: '条款数',
      dataIndex: 'clauseCount',
      key: 'clauseCount',
      width: 100,
      render: (count) => count != null ? `${count} 条` : '-',
    },
    {
      title: '上传时间',
      dataIndex: 'uploadTime',
      key: 'uploadTime',
      width: 180,
      render: (text) => text || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title="确定删除此规范？"
          description="删除后规范条款将无法恢复"
          onConfirm={() => handleDelete(record.standardId)}
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
            上传施工规范PDF文件，AI将自动解析规范条款，用于配合比设计的合规性校验。上传需要联网，用于AI解析规范条款。
          </Text>
        </Space>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Space>
          <Upload
            accept=".pdf"
            showUploadList={false}
            beforeUpload={() => false}
            customRequest={() => handleSelectFile()}
          >
            <Button
              type="primary"
              icon={<UploadOutlined />}
              loading={uploading}
            >
              上传规范PDF
            </Button>
          </Upload>
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
            description="暂无规范，请点击上方按钮上传PDF文件"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={standards}
            rowKey="standardId"
            size="middle"
            pagination={false}
          />
        )}
      </Spin>

      <Modal
        title="上传规范"
        open={modalVisible}
        onOk={handleUpload}
        onCancel={handleCancelUpload}
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
        </Form>
        <Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
          上传需要联网，AI将解析规范PDF中的条款内容。解析时间视文件大小而定，请耐心等待。
        </Paragraph>
      </Modal>
    </div>
  )
}

export default StandardsManager