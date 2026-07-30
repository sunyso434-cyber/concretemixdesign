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
  const spDosageDevPct = deviation?.superplasticizerDosageDeviationPct
  const hasDeviation = strengthDevPct !== null && strengthDevPct !== undefined
  const hasSpDosageDeviation = spDosageDevPct !== null && spDosageDevPct !== undefined

  // 配合比明细数据
  // 每种材料用量表 (kg/m³) — 优先方案用量(AI录入自动取)或AI传的
  const amountColumns = [
    { title: '材料名称', dataIndex: 'name', key: 'name', width: 120 },
    { title: '用量 (kg/m³)', dataIndex: 'amount', key: 'amount', render: (v) => v != null ? v : '-' }
  ]
  const amountData = [
    { key: 'water', name: '用水量', amount: record.water_amount != null ? Number(record.water_amount).toFixed(1) : null },
    { key: 'cement', name: '水泥', amount: record.cement_amount != null ? Number(record.cement_amount).toFixed(1) : null },
    { key: 'flyAsh', name: '粉煤灰', amount: record.fly_ash_amount != null ? Number(record.fly_ash_amount).toFixed(1) : null },
    { key: 'slag', name: '矿渣粉', amount: record.slag_amount != null ? Number(record.slag_amount).toFixed(1) : null },
    { key: 'lithiumSlag', name: '锂渣', amount: record.lithium_slag_amount != null ? Number(record.lithium_slag_amount).toFixed(1) : null },
    { key: 'compositePowder', name: '复合粉', amount: record.composite_powder_amount != null ? Number(record.composite_powder_amount).toFixed(1) : null },
    // 砂/石拆分：老记录只有 sand_amount/stone_amount 时，回退到砂1/石1
    { key: 'sand1', name: '砂1', amount: record.sand1_amount != null ? Number(record.sand1_amount).toFixed(1) : (record.sand_amount != null ? Number(record.sand_amount).toFixed(1) : null) },
    { key: 'sand2', name: '砂2', amount: record.sand2_amount != null ? Number(record.sand2_amount).toFixed(1) : null },
    { key: 'stone1', name: '石1', amount: record.stone1_amount != null ? Number(record.stone1_amount).toFixed(1) : (record.stone_amount != null ? Number(record.stone_amount).toFixed(1) : null) },
    { key: 'stone2', name: '石2', amount: record.stone2_amount != null ? Number(record.stone2_amount).toFixed(1) : null },
    { key: 'superplasticizer', name: '减水剂', amount: record.superplasticizer_amount != null ? Number(record.superplasticizer_amount).toFixed(1) : null },
  ]

  // 批次关联数据
  const batchFields = [
    { label: '水泥批次', value: record.cementBatchId },
    { label: '粉煤灰批次', value: record.flyAshBatchId },
    { label: '矿渣粉批次', value: record.slagBatchId },
    { label: '锂渣批次', value: record.lithiumSlagBatchId },
    { label: '复合粉批次', value: record.compositePowderBatchId },
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
        <Descriptions.Item label="水泥用量">{record.cement_amount != null ? `${record.cement_amount} kg/m³` : '-'}</Descriptions.Item>
        <Descriptions.Item label="砂率">{record.sand_ratio ? `${record.sand_ratio}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="用水量">{record.water_amount != null ? `${record.water_amount} kg/m³` : '-'}</Descriptions.Item>
        <Descriptions.Item label="粉煤灰掺量">{record.fly_ash_dosage != null ? `${record.fly_ash_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="矿渣粉掺量">{record.slag_dosage != null ? `${record.slag_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="锂渣掺量">{record.lithium_slag_dosage != null ? `${record.lithium_slag_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="复合粉掺量">{record.composite_powder_dosage != null ? `${record.composite_powder_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="减水剂掺量">{record.superplasticizer_dosage != null ? `${record.superplasticizer_dosage}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="设计坍落度">{record.slump ? `${record.slump}mm` : '-'}</Descriptions.Item>
      </Descriptions>

      {/* 每种材料用量表 (kg/m³) */}
      {amountData.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8, fontWeight: 600 }}>各材料用量表</h4>
          <Table columns={amountColumns} dataSource={amountData} size="small" pagination={false} />
        </div>
      )}

      {/* 材料批次关联 */}
      {batchData.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8, fontWeight: 600 }}>材料批次关联</h4>
          <Table columns={batchColumns} dataSource={batchData} size="small" pagination={false} />
        </div>
      )}

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
          <Descriptions.Item label="预测减水剂掺量">
            {deviation.superplasticizerDosagePredicted != null
              ? `${deviation.superplasticizerDosagePredicted.toFixed(2)}%`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="减水剂掺量偏差">
            {hasSpDosageDeviation ? (
              <Tag color={Math.abs(spDosageDevPct) > 10 ? 'red' : 'green'}>
                {spDosageDevPct > 0 ? '+' : ''}{spDosageDevPct.toFixed(1)}%
              </Tag>
            ) : '-'}
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
