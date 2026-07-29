import React from 'react'
import { Tag, Descriptions, Table, Space } from 'antd'

/**
 * TrialRecordDetail - 试配记录详情展示（用于表格展开行）
 *
 * Props:
 * @param {Object} record - 单条 TrialTestRecord 数据
 */
const TrialRecordDetail = ({ record }) => {
  const deviation = record.deviationAnalysis
  const strengthDevPct = deviation?.strengthDeviationPct
  const hasDeviation = strengthDevPct !== null && strengthDevPct !== undefined

  // 配合比明细数据
  const mixColumns = [
    { title: '材料名称', dataIndex: 'name', key: 'name' },
    { title: '用量', dataIndex: 'amount', key: 'amount', render: (v) => `${v} kg/m³` }
  ]
  const mixData = [
    { key: 'cement', name: '水泥', amount: record.cement_amount ?? '-' },
    { key: 'flyAsh', name: '粉煤灰', amount: record.fly_ash_dosage ? `${record.fly_ash_dosage}%` : '-' },
    { key: 'slag', name: '矿渣粉', amount: record.slag_dosage ? `${record.slag_dosage}%` : '-' },
    { key: 'water', name: '水', amount: record.water_amount ?? '-' },
    { key: 'superplasticizer', name: '减水剂', amount: record.superplasticizer_dosage ? `${record.superplasticizer_dosage}%` : '-' },
  ]

  // 批次关联数据
  const batchFields = [
    { label: '水泥批次', value: record.cementBatchId },
    { label: '粉煤灰批次', value: record.flyAshBatchId },
    { label: '矿渣粉批次', value: record.slagBatchId },
    { label: '砂批次', value: record.sandBatchId },
    { label: '石批次', value: record.stoneBatchId },
    { label: '减水剂批次', value: record.superplasticizerBatchId },
  ]
  const batchData = batchFields
    .filter(b => b.value !== null && b.value !== undefined && b.value !== '' && !(Array.isArray(b.value) && b.value.length === 0))
    .map((b, i) => ({ key: i, ...b }))
  const batchColumns = [
    { title: '材料', dataIndex: 'label', key: 'label' },
    { title: '批次ID', dataIndex: 'value', key: 'value', render: (v) => Array.isArray(v) ? v.join(', ') : String(v) }
  ]

  return (
    <div style={{ padding: '12px 0' }}>
      <Descriptions title="配合比设计参数" column={2} size="small" bordered>
        <Descriptions.Item label="水胶比">{record.water_binder_ratio ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="砂率">{record.sand_ratio ? `${record.sand_ratio}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="粉煤灰掺量">{record.fly_ash_dosage ? `${record.fly_ash_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="矿渣粉掺量">{record.slag_dosage ? `${record.slag_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="设计坍落度">{record.slump ? `${record.slump}mm` : '-'}</Descriptions.Item>
        <Descriptions.Item label="减水剂掺量">{record.superplasticizer_dosage ? `${record.superplasticizer_dosage}%` : '-'}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="实测值" column={2} size="small" bordered style={{ marginTop: 16 }}>
        <Descriptions.Item label="实测强度 (28d)">{record.trialTestedStrength ? `${record.trialTestedStrength} MPa` : '-'}</Descriptions.Item>
        <Descriptions.Item label="实测坍落度">{record.trialTestedSlump ? `${record.trialTestedSlump}mm` : '-'}</Descriptions.Item>
        <Descriptions.Item label="实测容重">{record.trialTestedDensity ? `${record.trialTestedDensity} kg/m³` : '-'}</Descriptions.Item>
        <Descriptions.Item label="实测减水剂掺量">{record.trialTestedDosage ? `${record.trialTestedDosage}%` : '-'}</Descriptions.Item>
      </Descriptions>

      {deviation && (
        <Descriptions title="偏差分析" column={2} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label="预测强度 (28d)">
            {deviation.strengthPredicted ? `${deviation.strengthPredicted.toFixed(1)} MPa` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="强度偏差率">
            {hasDeviation ? (
              <Tag color={Math.abs(strengthDevPct) > 10 ? 'red' : 'green'}>
                {strengthDevPct > 0 ? '+' : ''}{strengthDevPct.toFixed(1)}%
              </Tag>
            ) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="预测容重">
            {deviation.densityPredicted ? `${deviation.densityPredicted.toFixed(1)} kg/m³` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="坍落度偏差">
            {deviation.slumpDeviation !== null && deviation.slumpDeviation !== undefined
              ? `${deviation.slumpDeviation > 0 ? '+' : ''}${deviation.slumpDeviation}mm`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="分析时间">{deviation.analyzedAt ? new Date(deviation.analyzedAt).toLocaleString() : '-'}</Descriptions.Item>
        </Descriptions>
      )}

      {record.trialNotes && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8, fontWeight: 600 }}>试配备注</h4>
          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{record.trialNotes}</div>
        </div>
      )}

      {record.trialOperator && (
        <div style={{ marginTop: 8, color: 'var(--text-tertiary)', fontSize: 12 }}>
          操作人：{record.trialOperator}
          {record.trainedModelVersion && ` | 模型版本：${record.trainedModelVersion}`}
        </div>
      )}
    </div>
  )
}

export default TrialRecordDetail
