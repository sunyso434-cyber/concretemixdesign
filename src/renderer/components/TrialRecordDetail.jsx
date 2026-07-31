import React, { useState } from 'react'
import { Tag, Descriptions, Table, Space, Button, message, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

/**
 * TrialRecordDetail - 试配记录详情展示（用于表格展开行）
 *
 * Props:
 * @param {Object} record - 单条 TrialTestRecord 数据
 */
const TrialRecordDetail = ({ record: initialRecord }) => {
  const [record, setRecord] = useState(initialRecord)
  const [repredicting, setRepredicting] = useState(false)
  const deviation = record.deviationAnalysis
  const strengthDevPct = deviation?.strengthDeviationPct
  const densityDevPct = deviation?.densityDeviationPct
  const spDosageDevPct = deviation?.superplasticizerDosageDeviationPct
  const hasDeviation = strengthDevPct !== null && strengthDevPct !== undefined
  const hasDensityDeviation = densityDevPct != null
  const hasSpDosageDeviation = spDosageDevPct !== null && spDosageDevPct !== undefined

  const handleRepredict = async () => {
    if (repredicting) return
    setRepredicting(true)
    try {
      const res = await window.electronAPI.invoke('trialtest:repredict', { id: record.id })
      if (res?.success && res.record) {
        setRecord(res.record)
        message.success('重新预测完成')
      } else {
        message.error(res?.error || '重新预测失败')
      }
    } catch (e) {
      message.error(`重新预测失败：${e.message}`)
    } finally {
      setRepredicting(false)
    }
  }

  // 配合比明细数据
  // 每种材料用量表 (kg/m³) — 优先方案用量(AI录入自动取)或AI传的
  const amountItems = [
    { name: '用水量', amount: record.water_amount != null ? Number(record.water_amount).toFixed(1) : null },
    { name: '水泥', amount: record.cement_amount != null ? Number(record.cement_amount).toFixed(1) : null },
    { name: '粉煤灰', amount: record.fly_ash_amount != null ? Number(record.fly_ash_amount).toFixed(1) : null },
    { name: '矿渣粉', amount: record.slag_amount != null ? Number(record.slag_amount).toFixed(1) : null },
    { name: '锂渣', amount: record.lithium_slag_amount != null ? Number(record.lithium_slag_amount).toFixed(1) : null },
    { name: '复合粉', amount: record.composite_powder_amount != null ? Number(record.composite_powder_amount).toFixed(1) : null },
    // 砂/石拆分：老记录只有 sand_amount/stone_amount 时，回退到砂1/石1
    { name: '砂1', amount: record.sand1_amount != null ? Number(record.sand1_amount).toFixed(1) : (record.sand_amount != null ? Number(record.sand_amount).toFixed(1) : null) },
    { name: '砂2', amount: record.sand2_amount != null ? Number(record.sand2_amount).toFixed(1) : null },
    { name: '石1', amount: record.stone1_amount != null ? Number(record.stone1_amount).toFixed(1) : (record.stone_amount != null ? Number(record.stone_amount).toFixed(1) : null) },
    { name: '石2', amount: record.stone2_amount != null ? Number(record.stone2_amount).toFixed(1) : null },
    { name: '减水剂', amount: record.superplasticizer_amount != null ? Number(record.superplasticizer_amount).toFixed(1) : null },
  ]
  // 表头拆 3 列（每行展示 3 组材料-用量），不足 3 组留空
  const groupCount = 3
  const amountColumns = []
  for (let g = 0; g < groupCount; g++) {
    amountColumns.push({ title: '材料名称', dataIndex: `n${g}`, key: `n${g}`, width: 100 })
    amountColumns.push({ title: '用量 (kg/m³)', dataIndex: `a${g}`, key: `a${g}`, render: (v) => v != null ? v : '-' })
  }
  const amountRows = []
  for (let i = 0; i < amountItems.length; i += groupCount) {
    const slice = amountItems.slice(i, i + groupCount)
    amountRows.push({
      key: i,
      n0: slice[0]?.name, a0: slice[0]?.amount,
      n1: slice[1]?.name, a1: slice[1]?.amount,
      n2: slice[2]?.name, a2: slice[2]?.amount,
    })
  }

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
  const batchItems = batchFields
    .filter(b => b.value !== null && b.value !== undefined && b.value !== '' && !(Array.isArray(b.value) && b.value.length === 0))
  const batchColumns = []
  for (let g = 0; g < groupCount; g++) {
    batchColumns.push({ title: '材料', dataIndex: `l${g}`, key: `l${g}`, width: 120 })
    batchColumns.push({ title: '批次ID', dataIndex: `v${g}`, key: `v${g}`, render: (v) => v == null ? '-' : (Array.isArray(v) ? v.join(', ') : String(v)) })
  }
  const batchRows = []
  for (let i = 0; i < batchItems.length; i += groupCount) {
    const slice = batchItems.slice(i, i + groupCount)
    batchRows.push({
      key: i,
      l0: slice[0]?.label, v0: slice[0]?.value,
      l1: slice[1]?.label, v1: slice[1]?.value,
      l2: slice[2]?.label, v2: slice[2]?.value,
    })
  }

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
      {amountItems.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8, fontWeight: 600 }}>各材料用量表</h4>
          <Table columns={amountColumns} dataSource={amountRows} size="small" pagination={false} />
        </div>
      )}

      {/* 材料批次关联 */}
      {batchItems.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ marginBottom: 8, fontWeight: 600 }}>材料批次关联</h4>
          <Table columns={batchColumns} dataSource={batchRows} size="small" pagination={false} />
        </div>
      )}

      <Descriptions title="实测值" column={2} size="small" bordered style={{ marginTop: 16 }}>
        <Descriptions.Item label="实测强度 (28d)">{record.trialTestedStrength ? `${record.trialTestedStrength} MPa` : '-'}</Descriptions.Item>
        <Descriptions.Item label="实测坍落度">{record.trialTestedSlump ? `${record.trialTestedSlump}mm` : '-'}</Descriptions.Item>
        <Descriptions.Item label="实测容重">{record.trialTestedDensity ? `${record.trialTestedDensity} kg/m³` : '-'}</Descriptions.Item>
        <Descriptions.Item label="实测减水剂掺量">{record.trialTestedDosage ? `${record.trialTestedDosage}%` : '-'}</Descriptions.Item>
      </Descriptions>

      {deviation && (() => {
        const rows = [
          {
            key: 'strength',
            l1: '预测强度 (28d)',
            v1: deviation.strengthPredicted != null ? `${deviation.strengthPredicted.toFixed(1)} MPa` : '-',
            l2: '强度偏差率',
            v2: hasDeviation ? (
              <Tag color={Math.abs(strengthDevPct) > 10 ? 'red' : 'green'}>
                {strengthDevPct > 0 ? '+' : ''}{strengthDevPct.toFixed(1)}%
              </Tag>
            ) : '-'
          },
          {
            key: 'density',
            l1: '预测容重',
            v1: deviation.densityPredicted != null ? `${deviation.densityPredicted.toFixed(1)} kg/m³` : '-',
            l2: '容重偏差率',
            v2: hasDensityDeviation ? (
              <Tag color={Math.abs(densityDevPct) > 5 ? 'red' : 'green'}>
                {densityDevPct > 0 ? '+' : ''}{densityDevPct.toFixed(1)}%
              </Tag>
            ) : '-'
          },
          {
            key: 'sp',
            l1: '预测减水剂掺量',
            v1: deviation.superplasticizerDosagePredicted != null ? `${deviation.superplasticizerDosagePredicted.toFixed(2)}%` : '-',
            l2: '减水剂掺量偏差值',
            v2: hasSpDosageDeviation ? (
              <Tag color={Math.abs(spDosageDevPct) > 10 ? 'red' : 'green'}>
                {spDosageDevPct > 0 ? '+' : ''}{spDosageDevPct.toFixed(1)}%
              </Tag>
            ) : '-'
          }
        ]
        const columns = [
          { title: '项目', dataIndex: 'l1', key: 'l1', width: 130 },
          { title: '值', dataIndex: 'v1', key: 'v1' },
          { title: '项目', dataIndex: 'l2', key: 'l2', width: 130 },
          { title: '值', dataIndex: 'v2', key: 'v2' }
        ]
        return (
          <div style={{ marginTop: 16 }}>
            {/* 标题 + 重新预测按钮 + 分析时间 同行 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h4 style={{ margin: 0, fontWeight: 600 }}>偏差分析</h4>
                <Tooltip title="重新预测">
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={repredicting}
                    onClick={handleRepredict}
                  />
                </Tooltip>
              </div>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                分析时间：{deviation.analyzedAt ? new Date(deviation.analyzedAt).toLocaleString() : '-'}
              </span>
            </div>
            <Table columns={columns} dataSource={rows} size="small" pagination={false} bordered />
          </div>
        )
      })()}

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
