import React from 'react'
import { Card, Progress, Table, Tag, List } from 'antd'

const CrackRiskGauge = ({ result }) => {
  if (!result) return null

  const { scores, riskIndex, riskLevel, recommendations } = result

  const levelColors = {
    low: '#52c41a',
    medium: '#faad14',
    high: '#fa8c16',
    extreme: '#f5222d'
  }

  const levelLabels = {
    low: '低风险',
    medium: '中等风险',
    high: '高风险',
    extreme: '极高风险'
  }

  const getScoreLevel = (score) => {
    if (score < 25) return 'low'
    if (score < 50) return 'medium'
    if (score < 75) return 'high'
    return 'extreme'
  }

  const columns = [
    {
      title: '评分维度',
      dataIndex: 'dimension',
      key: 'dimension'
    },
    {
      title: '分值',
      dataIndex: 'score',
      key: 'score',
      render: (val) => <span style={{ fontWeight: 'bold', color: levelColors[getScoreLevel(val)] }}>{val}</span>
    },
    {
      title: '等级',
      dataIndex: 'level',
      key: 'level',
      render: (level) => {
        const colors = { low: 'green', medium: 'yellow', high: 'orange', extreme: 'red' }
        return <Tag color={colors[level]}>{levelLabels[level]}</Tag>
      }
    }
  ]

  const scoreData = [
    { key: '1', dimension: '应力水平', score: scores.stressScore, level: getScoreLevel(scores.stressScore) },
    { key: '2', dimension: '温降速率', score: scores.gradientScore, level: getScoreLevel(scores.gradientScore) },
    { key: '3', dimension: '超限持续', score: scores.durationScore, level: getScoreLevel(scores.durationScore) },
    { key: '4', dimension: '材料抗裂', score: scores.materialScore, level: getScoreLevel(scores.materialScore) }
  ]

  return (
    <Card
      title="裂缝风险评估"
      size="small"
      style={{ marginTop: 16 }}
      className="crack-risk-gauge"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 16 }}>
        <Progress
          type="circle"
          percent={riskIndex}
          strokeColor={levelColors[riskLevel]}
          format={(percent) => (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 'bold' }}>{percent}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{levelLabels[riskLevel]}</div>
            </div>
          )}
        />
        <div>
          <p style={{ margin: 0, fontSize: 14, color: '#666' }}>
            综合裂缝风险指数 (RI) 基于四维度加权评分模型计算
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#999' }}>
            权重: 应力35% | 温降25% | 持续20% | 材料20%
          </p>
        </div>
      </div>

      <Table
        dataSource={scoreData}
        columns={columns}
        rowKey="key"
        pagination={false}
        size="small"
      />

      {recommendations && recommendations.length > 0 && (
        <List
          header={<span style={{ fontWeight: 'bold' }}>防控建议</span>}
          dataSource={recommendations}
          renderItem={item => (
            <List.Item style={{ padding: '8px 0' }}>
              <Tag color="orange">提醒</Tag>
              {item}
            </List.Item>
          )}
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  )
}

export default CrackRiskGauge
