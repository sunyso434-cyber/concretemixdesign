import React, { useState, useEffect } from 'react'
import { Card, Button, Table, Space, Tag, Typography, Modal, Input, message, Popconfirm, Empty, Tooltip, Alert, Radio } from 'antd'
import extractErrorMessage from '../utils/extractErrorMessage'
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FolderOpenOutlined,
  EditOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  RocketOutlined,
  CodeOutlined,
  AppstoreOutlined,
  SearchOutlined,
  CalculatorOutlined,
  SafetyOutlined
} from '@ant-design/icons'

const { Text, Title, Paragraph } = Typography
const { TextArea } = Input

// 技能分类颜色
const CATEGORY_COLORS = {
  core: 'blue',
  query: 'green',
  save: 'orange',
  analysis: 'purple',
  system: 'default',
  custom: 'cyan'
}

// 技能分类中文名
const CATEGORY_NAMES = {
  core: '核心',
  query: '查询',
  save: '保存',
  analysis: '分析',
  system: '系统',
  custom: '自定义'
}

/**
 * 技能管理组件
 */
const SkillManager = () => {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(false)
  const [userDir, setUserDir] = useState('')
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editSkill, setEditSkill] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDesc, setNewSkillDesc] = useState('')
  const [newSkillTemplate, setNewSkillTemplate] = useState('query')

  // 加载技能列表
  const loadSkills = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.skill?.listAll()
      if (result?.success) {
        setSkills(result.skills || [])
      }
      const dirResult = await window.electronAPI?.skill?.getUserDir()
      if (dirResult?.success) {
        setUserDir(dirResult.dir)
      }
    } catch (error) {
      console.error('加载技能列表失败:', error)
      message.error('加载技能列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSkills()
  }, [])

  // 打开技能目录
  const handleOpenDir = async () => {
    try {
      await window.electronAPI?.skill?.openUserDir()
    } catch (error) {
      message.error('打开目录失败')
    }
  }

  // 重新加载技能
  const handleReload = async () => {
    try {
      const result = await window.electronAPI?.skill?.reload()
      if (result?.success) {
        message.success(`已重新加载 ${result.count} 个技能`)
        await loadSkills()
      }
    } catch (error) {
      message.error('重新加载失败')
    }
  }

  // 查看技能详情
  const handleViewSkill = async (skill) => {
    try {
      const result = await window.electronAPI?.invoke('skill:getInfo', { skillName: skill.name })
      if (result?.success) {
        setEditSkill(result.data)
        setEditContent(result.data.content)
        setEditModalVisible(true)
      }
    } catch (error) {
      // 如果获取详情失败，显示基本信息
      setEditSkill({ skillName: skill.name, content: `// ${skill.description}\n// 文件: ${skill.filePath || '未知'}` })
      setEditContent(`// ${skill.description}`)
      setEditModalVisible(true)
    }
  }

  // 删除技能
  const handleDeleteSkill = async (skillName) => {
    try {
      const result = await window.electronAPI?.invoke('skill:delete', { skillName })
      if (result?.success) {
        message.success(`技能 "${skillName}" 已删除`)
        await loadSkills()
      } else {
        message.error(extractErrorMessage(result?.error, '删除失败'))
      }
    } catch (error) {
      message.error('删除失败: ' + error.message)
    }
  }

  // 创建新技能
  const handleCreateSkill = async () => {
    if (!newSkillName.trim()) {
      message.error('请输入技能名称')
      return
    }

    try {
      const result = await window.electronAPI?.invoke('skill:create', {
        skillName: newSkillName.trim(),
        description: newSkillDesc.trim() || '自定义技能',
        functionality: newSkillDesc.trim() || '自定义功能',
        template: newSkillTemplate
      })

      if (result?.success) {
        message.success('技能创建成功！')
        setCreateModalVisible(false)
        setNewSkillName('')
        setNewSkillDesc('')
        await loadSkills()
      } else {
        message.error(extractErrorMessage(result?.error, '创建失败'))
      }
    } catch (error) {
      message.error('创建失败: ' + error.message)
    }
  }

  // 复制技能名称
  const handleCopyName = (name) => {
    navigator.clipboard.writeText(`/${name}`)
    message.success('已复制命令: /' + name)
  }

  // 表格列定义
  const columns = [
    {
      title: '技能名称',
      dataIndex: 'name',
      key: 'name',
      render: (name, record) => (
        <Space>
          <CodeOutlined style={{ color: '#1890ff' }} />
          <Text strong>/{name}</Text>
          {!record.builtin && (
            <Tag color="gold" style={{ fontSize: 11 }}>自定义</Tag>
          )}
        </Space>
      )
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc) => (
        <Tooltip title={desc}>
          <Text type="secondary">{desc}</Text>
        </Tooltip>
      )
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 80,
      render: (category) => (
        <Tag color={CATEGORY_COLORS[category]}>
          {CATEGORY_NAMES[category] || category}
        </Tag>
      )
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 80,
      render: (version) => <Text type="secondary">{version || '1.0.0'}</Text>
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="复制命令">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopyName(record.name)}
            />
          </Tooltip>
          {!record.builtin && (
            <>
              <Tooltip title="查看详情">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleViewSkill(record)}
                />
              </Tooltip>
              <Popconfirm
                title="确定删除此技能？"
                description="删除后无法恢复，需要重新创建"
                onConfirm={() => handleDeleteSkill(record.name)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="删除技能">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </Space>
      )
    }
  ]

  // 分离内置技能和用户技能
  const builtinSkills = skills.filter(s => s.builtin !== false)
  const userSkills = skills.filter(s => s.builtin === false)

  return (
    <div className="skill-manager">
      {/* 头部说明 */}
      <Alert
        message="技能系统"
        description={
          <div>
            <Paragraph style={{ margin: 0 }}>
              技能是 AI 的扩展能力。输入 <Text strong>/</Text> 可查看所有可用技能。
              用户自定义技能放在: <Text code>{userDir || '~/.concrete-mixdesign/skills/'}</Text>
            </Paragraph>
          </div>
        }
        type="info"
        showIcon
        icon={<AppstoreOutlined />}
        style={{ marginBottom: 16 }}
      />

      {/* 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateModalVisible(true)}
          >
            创建新技能
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={handleOpenDir}
          >
            打开技能目录
          </Button>
        </Space>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleReload}
          loading={loading}
        >
          重新加载
        </Button>
      </div>

      {/* 用户自定义技能 */}
      {userSkills.length > 0 && (
        <Card
          title={
            <Space>
              <RocketOutlined />
              <span>自定义技能</span>
              <Tag>{userSkills.length}</Tag>
            </Space>
          }
          size="small"
          style={{ marginBottom: 16 }}
        >
          <Table
            dataSource={userSkills}
            columns={columns}
            rowKey="name"
            size="small"
            pagination={false}
          />
        </Card>
      )}

      {/* 内置技能 */}
      <Card
        title={
          <Space>
            <AppstoreOutlined />
            <span>内置技能</span>
            <Tag>{builtinSkills.length}</Tag>
          </Space>
        }
        size="small"
      >
        <Table
          dataSource={builtinSkills}
          columns={columns}
          rowKey="name"
          size="small"
          pagination={false}
        />
      </Card>

      {/* 创建技能弹窗 */}
      <Modal
        title="创建新技能"
        open={createModalVisible}
        onOk={handleCreateSkill}
        onCancel={() => {
          setCreateModalVisible(false)
          setNewSkillName('')
          setNewSkillDesc('')
          setNewSkillTemplate('query')
        }}
        okText="创建"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong>技能模板</Text>
            <Radio.Group
              value={newSkillTemplate}
              onChange={(e) => setNewSkillTemplate(e.target.value)}
              style={{ marginTop: 8, width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Radio.Button value="query" style={{ width: '100%', height: 'auto', padding: '8px 12px', textAlign: 'left' }}>
                  <Space>
                    <SearchOutlined />
                    <div>
                      <div><Text strong>查询类</Text></div>
                      <Text type="secondary" style={{ fontSize: 12 }}>查询数据、搜索记录、检索信息</Text>
                    </div>
                  </Space>
                </Radio.Button>
                <Radio.Button value="calculate" style={{ width: '100%', height: 'auto', padding: '8px 12px', textAlign: 'left' }}>
                  <Space>
                    <CalculatorOutlined />
                    <div>
                      <div><Text strong>计算类</Text></div>
                      <Text type="secondary" style={{ fontSize: 12 }}>工程计算、数值分析、公式求解</Text>
                    </div>
                  </Space>
                </Radio.Button>
                <Radio.Button value="check" style={{ width: '100%', height: 'auto', padding: '8px 12px', textAlign: 'left' }}>
                  <Space>
                    <SafetyOutlined />
                    <div>
                      <div><Text strong>检查类</Text></div>
                      <Text type="secondary" style={{ fontSize: 12 }}>合规校验、参数验证、规则检查</Text>
                    </div>
                  </Space>
                </Radio.Button>
              </Space>
            </Radio.Group>
          </div>
          <div>
            <Text strong>技能名称（英文）</Text>
            <Input
              placeholder="例如: scc_mix_design"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
              style={{ marginTop: 8 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              只能使用英文、数字和下划线
            </Text>
          </div>
          <div>
            <Text strong>功能描述</Text>
            <TextArea
              placeholder="描述这个技能的功能，AI 会根据这个描述决定何时调用"
              value={newSkillDesc}
              onChange={(e) => setNewSkillDesc(e.target.value)}
              rows={3}
              style={{ marginTop: 8 }}
            />
          </div>
        </Space>
      </Modal>

      {/* 查看技能详情弹窗 */}
      <Modal
        title={`技能详情: ${editSkill?.skillName || ''}`}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false)
          setEditSkill(null)
          setEditContent('')
        }}
        footer={[
          <Button key="close" onClick={() => setEditModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={700}
      >
        {editSkill && (
          <div>
            <Alert
              message="技能文件路径"
              description={editSkill.filePath}
              type="info"
              style={{ marginBottom: 16 }}
            />
            <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, maxHeight: 400, overflow: 'auto' }}>
              <pre style={{ margin: 0, fontFamily: 'Monaco, Menlo, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {editContent}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default SkillManager
