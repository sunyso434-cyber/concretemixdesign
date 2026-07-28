/**
 * TrainingPanel.jsx
 * 训练 UI 面板 - 模型管理/训练/回滚/模型对比
 *
 * 布局：
 *   1. 模型状态概览（当前版本 + 指标）
 *   2. 训练控制（重新训练按钮 + 进度条）
 *   3. 训练历史（版本列表 + 指标对比 + 回滚）
 *
 * 审查 N3: Worker Thread 推送进度 via IPC event training:progress
 * 审查 M3: 回滚用文件复制
 * 审查 M4: 训练锁防并发
 * 审查 P12: 组件卸载时 removeAllListeners('training:progress')
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Card, Button, Progress, Table, Tag, Space, Typography, Spin,
  message, Popconfirm, Statistic, Row, Col, Empty, Tooltip, Divider, Badge
} from 'antd'
import {
  ReloadOutlined, RollbackOutlined, ExperimentOutlined,
  CheckCircleOutlined, CloseCircleOutlined, HistoryOutlined,
  BarChartOutlined, DatabaseOutlined, RobotOutlined, WarningOutlined
} from '@ant-design/icons'

const { Text, Title, Paragraph } = Typography

// ============ IPC 工具 ============

// 用 window.electron.ipcRenderer 调用（兼容旧 API）
const ipc = window.electron?.ipcRenderer || window.electronAPI

/**
 * 安全调用 invoke，失败返回兜底
 */
async function safeInvoke(channel, args) {
  try {
    return await ipc.invoke(channel, args)
  } catch (e) {
    console.error(`IPC ${channel} 调用失败:`, e)
    return null
  }
}

// ============ 训练面板主组件 ============

const TrainingPanel = () => {
  const [loading, setLoading] = useState(true)
  const [training, setTraining] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)
  const [modelInfo, setModelInfo] = useState(null)
  const [error, setError] = useState(null)

  // 加载模型信息
  const loadInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await safeInvoke('training:getInfo')
      if (result && result.success) {
        setModelInfo(result)
      } else {
        setError('无法加载模型信息')
      }
    } catch (e) {
      setError(`加载失败: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    loadInfo()
  }, [loadInfo])

  // 监听训练进度（审查 P12：返回值清理监听器）
  useEffect(() => {
    let progressListenerId = null

    if (ipc?.on) {
      progressListenerId = ipc.on('training:progress', (data) => {
        if (data && data.message) {
          setProgressMsg(data.message)
          // 从消息中解析进度百分比
          const percent = extractProgressPercent(data.message)
          if (percent !== null) {
            setProgressPercent(percent)
          }
        }
      })
    }

    return () => {
      // 审查 P12：组件卸载时清理监听器
      if (progressListenerId !== null) {
        try {
          ipc.removeListener(progressListenerId)
        } catch (e) {
          // 忽略清理错误
        }
      }
      // 额外清理（防止漏清理）
      try {
        if (ipc.removeAllListeners) {
          ipc.removeAllListeners('training:progress')
        }
      } catch (e) {
        // 忽略
      }
    }
  }, [])

  // ============ 训练 ============

  const handleStartTraining = async () => {
    setTraining(true)
    setProgressMsg('正在启动训练...')
    setProgressPercent(0)
    setError(null)

    try {
      const result = await safeInvoke('training:run')
      if (result && result.success) {
        message.success('训练完成！新模型已生效')
        setProgressMsg('训练完成')
        setProgressPercent(100)
        // 重新加载模型信息
        await loadInfo()
      } else {
        const errMsg = result?.error || '训练失败，请查看控制台'
        message.error(errMsg)
        setError(errMsg)
        setProgressMsg('')
      }
    } catch (e) {
      const errMsg = `训练异常: ${e.message}`
      message.error(errMsg)
      setError(errMsg)
    } finally {
      setTraining(false)
    }
  }

  // ============ 回滚 ============

  const handleRollback = async (version) => {
    try {
      const result = await safeInvoke('training:rollback', { version })
      if (result && result.success) {
        message.success(`已回滚到版本: ${version || '最新归档'}`)
        await loadInfo()
      } else {
        message.error(result?.error || '回滚失败')
      }
    } catch (e) {
      message.error(`回滚异常: ${e.message}`)
    }
  }

  // ============ 渲染 ============

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>
          <Text type="secondary">加载模型信息...</Text>
        </div>
      </div>
    )
  }

  const { summary, models, history, trialRecordCount } = modelInfo || {}
  const hasModels = models?.some(m => m.exists)

  return (
    <div className="training-panel">
      {/* ====== 模型状态概览 ====== */}
      <Card
        title={
          <Space>
            <RobotOutlined />
            <span>模型状态</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        {error && !hasModels && (
          <div style={{ marginBottom: 16 }}>
            <Text type="danger">
              <CloseCircleOutlined /> {error}
            </Text>
          </div>
        )}

        <Row gutter={[16, 16]}>
          {/* 模型状态 */}
          <Col xs={12} sm={6}>
            <Statistic
              title="模型状态"
              value={summary?.message || '未知'}
              prefix={summary?.status === 'user' ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : summary?.status === 'builtin' ? <RobotOutlined /> : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ fontSize: 16 }}
            />
          </Col>

          {/* 模型数量 */}
          <Col xs={12} sm={6}>
            <Statistic
              title="可用模型"
              value={models?.filter(m => m.exists).length || 0}
              suffix={`/ ${models?.length || 0}`}
              prefix={<BarChartOutlined />}
            />
          </Col>

          {/* 训练样本数 */}
          <Col xs={12} sm={6}>
            <Statistic
              title="训练样本数"
              value={summary?.totalSamples || 0}
              prefix={<DatabaseOutlined />}
              suffix="条"
            />
          </Col>

          {/* 试配数据 */}
          <Col xs={12} sm={6}>
            <Statistic
              title="试配数据"
              value={trialRecordCount || 0}
              prefix={<ExperimentOutlined />}
              suffix="条"
            />
          </Col>
        </Row>

        {/* 模型详情列表 */}
        {hasModels && (
          <div style={{ marginTop: 16 }}>
            <Divider orientation="left" style={{ fontSize: 13 }}>各模型指标</Divider>
            <Row gutter={[12, 12]}>
              {models?.filter(m => m.exists).map(model => (
                <Col xs={24} sm={8} key={model.key}>
                  <Card
                    size="small"
                    type="inner"
                    title={
                      <Space>
                        <Text strong>{model.label}</Text>
                        <Tag color={model.source === 'user' ? 'green' : 'default'} style={{ fontSize: 11 }}>
                          {model.source === 'user' ? '用户训练' : '内置'}
                        </Tag>
                      </Space>
                    }
                  >
                    {model.trainingInfo ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>RMSE</Text>
                          <Text style={{ fontSize: 12 }}>{model.trainingInfo.rmse?.toFixed(4) || '-'}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>R²</Text>
                          <Text style={{ fontSize: 12 }}>{model.trainingInfo.r_squared?.toFixed(4) || '-'}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>MAE</Text>
                          <Text style={{ fontSize: 12 }}>{model.trainingInfo.mae?.toFixed(4) || '-'}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>树数量</Text>
                          <Text style={{ fontSize: 12 }}>{model.treeCount}</Text>
                        </div>
                        {model.trainingInfo.samples && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>训练样本</Text>
                            <Text style={{ fontSize: 12 }}>{model.trainingInfo.samples}</Text>
                          </div>
                        )}
                      </div>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>占位模型（无训练指标）</Text>
                    )}
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}
      </Card>

      {/* ====== 训练控制 ====== */}
      <Card
        title={
          <Space>
            <ExperimentOutlined />
            <span>模型训练</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
          基于试配记录数据重新训练模型。训练期间 UI 保持可用，不会卡死。
          {trialRecordCount === 0 && (
            <span style={{ color: '#faad14', marginLeft: 8 }}>
              <WarningOutlined /> 当前无试配记录，训练将仅使用基座数据。
            </span>
          )}
        </Paragraph>

        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 训练按钮 */}
          <Space>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={training}
              disabled={training}
              onClick={handleStartTraining}
            >
              {training ? '训练中...' : '重新训练'}
            </Button>

            {training && (
              <Tooltip title="训练完成后进度自动消失">
                <Button
                  size="small"
                  type="default"
                  onClick={() => {
                    setProgressMsg('')
                    setProgressPercent(0)
                  }}
                >
                  清除进度
                </Button>
              </Tooltip>
            )}
          </Space>

          {/* 训练进度（审查 N3：由 Worker Thread 推送） */}
          {training && (
            <div style={{ marginTop: 8 }}>
              <Progress
                percent={progressPercent}
                format={() => ''}
                strokeColor={{
                  from: '#108ee9',
                  to: '#87d068',
                }}
                style={{ marginBottom: 4 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {progressMsg || '训练进行中...'}
                </Text>
                <Spin size="small" />
              </div>
            </div>
          )}

          {/* 非训练时显示最近一次进度消息 */}
          {!training && progressMsg && progressMsg !== '训练完成' && (
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {progressMsg}
              </Text>
            </div>
          )}
        </Space>
      </Card>

      {/* ====== 训练历史 ====== */}
      <Card
        title={
          <Space>
            <HistoryOutlined />
            <span>模型版本历史</span>
          </Space>
        }
        size="small"
      >
        {(!history || history.length === 0) ? (
          <Empty
            description={
              <Text type="secondary">暂无历史版本。训练模型后，旧版本会自动归档。</Text>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table
            dataSource={history}
            rowKey="version"
            pagination={false}
            size="small"
            columns={[
              {
                title: '版本号',
                dataIndex: 'version',
                key: 'version',
                width: 160,
                render: (ver) => (
                  <Text code style={{ fontSize: 12 }}>{ver}</Text>
                )
              },
              {
                title: '包含模型',
                dataIndex: 'models',
                key: 'models',
                width: 200,
                render: (models) => (
                  <Space size={4} wrap>
                    {models?.map(m => (
                      <Tag key={m.target} color="blue" style={{ fontSize: 11 }}>
                        {m.target.replace(/_/g, ' ')}
                      </Tag>
                    ))}
                  </Space>
                )
              },
              {
                title: 'RMSE',
                dataIndex: 'models',
                key: 'rmse',
                width: 120,
                render: (models) => {
                  const avgRmse = models
                    ?.filter(m => m.rmse != null)
                    .reduce((s, m, _, arr) => s + m.rmse / arr.length, 0)
                  return avgRmse ? <Text style={{ fontSize: 12 }}>{avgRmse.toFixed(4)}</Text> : '-'
                }
              },
              {
                title: 'R²',
                dataIndex: 'models',
                key: 'rSquared',
                width: 100,
                render: (models) => {
                  const avgR2 = models
                    ?.filter(m => m.rSquared != null)
                    .reduce((s, m, _, arr) => s + m.rSquared / arr.length, 0)
                  return avgR2 ? (
                    <Text style={{ fontSize: 12, color: avgR2 > 0.7 ? '#52c41a' : avgR2 > 0.5 ? '#faad14' : '#ff4d4f' }}>
                      {avgR2.toFixed(4)}
                    </Text>
                  ) : '-'
                }
              },
              {
                title: '样本数',
                dataIndex: 'models',
                key: 'samples',
                width: 80,
                render: (models) => {
                  const sample = models?.find(m => m.samples != null)
                  return sample ? <Text style={{ fontSize: 12 }}>{sample.samples}</Text> : '-'
                }
              },
              {
                title: '操作',
                key: 'action',
                width: 100,
                render: (_, record) => (
                  <Popconfirm
                    title="回滚到此版本？"
                    description="当前模型将被覆盖"
                    onConfirm={() => handleRollback(record.version)}
                    okText="确认回滚"
                    cancelText="取消"
                  >
                    <Button
                      size="small"
                      icon={<RollbackOutlined />}
                      disabled={training}
                    >
                      回滚
                    </Button>
                  </Popconfirm>
                )
              }
            ]}
          />
        )}
      </Card>
    </div>
  )
}

// ============ 辅助函数 ============

/**
 * 从进度消息中提取百分比
 * 匹配格式："TPE trial 10/50" → 20% 或 "[target] 完成" → 按目标进度
 */
function extractProgressPercent(message) {
  if (!message) return null

  // TPE trial 进度: "TPE trial 10/50 (strength_28d): RMSE=5.1234"
  const tpeMatch = message.match(/TPE trial (\d+)\/(\d+)/)
  if (tpeMatch) {
    return Math.round((parseInt(tpeMatch[1]) / parseInt(tpeMatch[2])) * 100)
  }

  // 目标完成: "[target] 完成" → 按目标数算进度
  if (message.includes('完成]')) return null // 由总进度控制

  // 整体阶段
  if (message.includes('加载 XGBoost')) return 2
  if (message.includes('加载完成')) return 5
  if (message.includes('构建特征矩阵')) return 8
  if (message.includes('TPE 调参开始')) return 15
  if (message.includes('训练最终模型')) return 65
  if (message.includes('计算 5 折 CV')) return 80
  if (message.includes('转换模型格式')) return 85
  if (message.includes('训练完成')) return 95

  return null
}

export default TrainingPanel
