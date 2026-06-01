import React, { useState, useEffect } from 'react'
import { Button, Card, Collapse, InputNumber, Space, Table, Typography, message, Modal, Checkbox, Spin, Input } from 'antd'
import { DownloadOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import extractErrorMessage from '../utils/extractErrorMessage'

const { Text } = Typography
const { Panel } = Collapse

const money = (value) => Number(value || 0).toFixed(2)

const SalesQuoteResultCard = ({ data, ruleDefaults, pumpingFeeItems = [] }) => {
  const [loading, setLoading] = useState(false)
  const [pricing, setPricing] = useState({
    manufacturingFee: data.manufacturingFee || 0,
    technicalServiceFee: data.technicalServiceFee || 0,
    profitRate: data.profitRate || 0.12,
    transportDistance: data.transportDistance || 20,
    transportUnitPrice: data.transportUnitPrice || 2.5,
    marketAdjustmentRate: data.marketAdjustmentRate || 0,
    vatRate: data.vatRate || 0.13
  })
  const [materialOverrides, setMaterialOverrides] = useState({})
  const [selectedPumpingIds, setSelectedPumpingIds] = useState(
    (data.pumpingFeeItems || []).map(p => p.itemId)
  )
  const [result, setResult] = useState(data)
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [remarks, setRemarks] = useState('')

  const recalculate = async (pricingParams, overrides, pumpingIds) => {
    setLoading(true)
    try {
      const selectedItems = pumpingFeeItems
        .filter(p => pumpingIds.includes(p.id))
        .map(p => ({ itemId: p.id, name: p.name, unitPrice: p.unitPrice }))
      const calcResult = await window.electronAPI.invoke('salesQuote:calculate', {
        basicMix: {
          strengthGrade: result.strengthGrade,
          concreteType: result.concreteType,
          slump: result.slump,
          materials: (result.materialDetails || []).map(m => ({
            materialId: m.materialId,
            materialType: m.materialType,
            materialName: m.materialName,
            usage: m.usage,
            price: overrides[m.materialId] != null ? overrides[m.materialId] : m.unitPrice
          }))
        },
        pricing: {
          manufacturingFee: pricingParams.manufacturingFee,
          technicalServiceFee: pricingParams.technicalServiceFee,
          profitRate: pricingParams.profitRate,
          transportDistance: pricingParams.transportDistance,
          transportUnitPrice: pricingParams.transportUnitPrice,
          marketAdjustmentRate: pricingParams.marketAdjustmentRate,
          vatRate: pricingParams.vatRate,
          materialPriceOverrides: overrides,
          pumpingFeeItems: selectedItems
        }
      })
      if (calcResult.success) setResult(calcResult.data)
      else message.error(extractErrorMessage(calcResult.error))
    } catch (e) {
      message.error('报价重算失败')
    } finally {
      setLoading(false)
    }
  }

  const handleParamChange = (field, value) => {
    const updated = { ...pricing, [field]: value }
    setPricing(updated)
    recalculate(updated, materialOverrides, selectedPumpingIds)
  }

  const handleMaterialPriceChange = (materialId, newPrice) => {
    const updated = { ...materialOverrides, [materialId]: newPrice }
    setMaterialOverrides(updated)
    recalculate(pricing, updated, selectedPumpingIds)
  }

  const handlePumpingToggle = (id, checked) => {
    const updated = checked
      ? [...selectedPumpingIds, id]
      : selectedPumpingIds.filter(pid => pid !== id)
    setSelectedPumpingIds(updated)
    recalculate(pricing, materialOverrides, updated)
  }

  const handleSaveQuote = async () => {
    const saveResult = await window.electronAPI.invoke('salesQuote:saveQuote', {
      strengthGrade: result.strengthGrade,
      concreteType: result.concreteType,
      slump: result.slump,
      pricingParams: pricing,
      materialPriceOverrides: materialOverrides,
      materialDetails: result.materialDetails,
      selectedPumpingItems: pumpingFeeItems.filter(p => selectedPumpingIds.includes(p.id)),
      resultSnapshot: result,
      remarks
    })
    if (saveResult.success) {
      message.success('报价已保存到历史记录')
      setSaveModalVisible(false)
    } else {
      message.error(extractErrorMessage(saveResult.error))
    }
  }

  const handleExport = async () => {
    const dialogResult = await window.electronAPI.invoke('show-save-dialog', {
      title: '导出报价单',
      defaultPath: `销售报价-${result.strengthGrade}-${result.concreteType}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (dialogResult?.data?.canceled || !dialogResult?.data?.filePath) return
    const selectedItems = pumpingFeeItems
      .filter(p => selectedPumpingIds.includes(p.id))
      .map(p => ({ itemId: p.id, name: p.name, unitPrice: p.unitPrice }))
    const exportResult = await window.electronAPI.invoke('salesQuote:exportExcel', {
      filePath: dialogResult.data.filePath,
      quote: { ...result, pumpingFeeItems: selectedItems },
      customerNote: '本报价为单方报价，含运输费、泵送费和13%增值税。'
    })
    if (exportResult.success) message.success('报价单已导出')
    else message.error(extractErrorMessage(exportResult.error, '报价单导出失败'))
  }

  const handleReset = () => {
    if (ruleDefaults) {
      const resetPricing = {
        manufacturingFee: ruleDefaults.suggestedManufacturingFee || data.manufacturingFee || 18,
        technicalServiceFee: ruleDefaults.suggestedTechnicalServiceFee || data.technicalServiceFee || 0,
        profitRate: ruleDefaults.suggestedProfitRate || data.profitRate || 0.12,
        transportDistance: ruleDefaults.suggestedTransportDistance || data.transportDistance || 20,
        transportUnitPrice: ruleDefaults.suggestedTransportUnitPrice || data.transportUnitPrice || 2.5,
        marketAdjustmentRate: data.marketAdjustmentRate || 0,
        vatRate: ruleDefaults.vatRate || data.vatRate || 0.13
      }
      setPricing(resetPricing)
      setMaterialOverrides({})
      setSelectedPumpingIds([])
      recalculate(resetPricing, {}, [])
    }
  }

  const materialColumns = [
    { title: '材料类型', dataIndex: 'materialType', key: 'materialType' },
    { title: '材料名称', dataIndex: 'materialName', key: 'materialName' },
    { title: '用量(kg/m³)', dataIndex: 'usage', key: 'usage', render: money },
    {
      title: '本次单价(元/吨)',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      render: (val, row) => {
        const overridden = materialOverrides[row.materialId] != null
        return (
          <span>
            <Text
              type={overridden ? 'warning' : undefined}
              style={overridden ? {} : { color: '#1890ff', cursor: 'pointer' }}
              onClick={() => {
                const newPrice = parseFloat(prompt('修改单价(元/吨):', overridden ? materialOverrides[row.materialId] : val))
                if (!isNaN(newPrice) && newPrice >= 0) {
                  handleMaterialPriceChange(row.materialId, newPrice)
                }
              }}
            >
              {overridden ? materialOverrides[row.materialId] : val}
            </Text>
            {overridden && <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>(原价:{money(val)})</Text>}
          </span>
        )
      }
    },
    { title: '成本(元/m³)', dataIndex: 'cost', key: 'cost', render: money }
  ]

  return (
    <Spin spinning={loading}>
      <Card size="small" style={{ marginBottom: 8, maxWidth: 800 }}>
        {/* Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text strong style={{ fontSize: 16 }}>{result.strengthGrade} {result.concreteType} 单方报价建议</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            含运输费 · 含13%增值税 · 泵送费另附
          </Text>
        </div>

        {/* Three-column highlight */}
        <div style={{ display: 'flex', textAlign: 'center', marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: '1px solid #f0f0f0' }}>
          <div style={{ flex: 1, padding: '12px 8px', background: '#f6ffed' }}>
            <div style={{ fontSize: 12, color: '#52c41a' }}>建议报价区间</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#52c41a' }}>
              {money(result.quoteRange?.min)} - {money(result.quoteRange?.max)}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>元/m³</div>
          </div>
          <div style={{ flex: 1, padding: '12px 8px', background: '#e6f7ff' }}>
            <div style={{ fontSize: 12, color: '#1890ff' }}>建议成交价</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#1890ff' }}>
              {money(result.suggestedDealPrice)}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>元/m³</div>
          </div>
          <div style={{ flex: 1, padding: '12px 8px', background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#999' }}>内部底线价</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#d9d9d9' }}>
              {money(result.internalFloorPrice)}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>元/m³</div>
          </div>
        </div>

        <Collapse defaultActiveKey={['params', 'pumping', 'materials']} style={{ background: 'transparent' }} bordered={false}>
          {/* Panel 1: Quick Parameter Adjustment */}
          <Panel header="⚡ 快速调整参数" key="params">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4, padding: 6 }}>
                <div style={{ fontSize: 11, color: '#999' }}>制造费(元/m³)</div>
                <InputNumber size="small" min={0} step={1} value={pricing.manufacturingFee}
                  onChange={v => handleParamChange('manufacturingFee', v)} style={{ width: '100%' }} />
              </div>
              <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4, padding: 6 }}>
                <div style={{ fontSize: 11, color: '#999' }}>技术服务费(元/m³)</div>
                <InputNumber size="small" min={0} step={1} value={pricing.technicalServiceFee}
                  onChange={v => handleParamChange('technicalServiceFee', v)} style={{ width: '100%' }} />
              </div>
              <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4, padding: 6 }}>
                <div style={{ fontSize: 11, color: '#999' }}>基础利润率</div>
                <InputNumber size="small" min={0} max={1} step={0.01} value={pricing.profitRate}
                  onChange={v => handleParamChange('profitRate', v)} style={{ width: '100%' }}
                  formatter={v => `${(Number(v) * 100).toFixed(0)}%`} parser={v => Number(v?.replace('%', '')) / 100} />
              </div>
            </div>
            {/* Transport fee section */}
            <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#d48806', marginBottom: 6 }}>🚛 运输费（自动计算）</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#999' }}>运距(km)</div>
                  <InputNumber size="small" min={0} step={1} value={pricing.transportDistance}
                    onChange={v => handleParamChange('transportDistance', v)} style={{ width: '100%' }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#999' }}>运输单价(元/km/m³)</div>
                  <InputNumber size="small" min={0} step={0.1} value={pricing.transportUnitPrice}
                    onChange={v => handleParamChange('transportUnitPrice', v)} style={{ width: '100%' }} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: '#999' }}>运输费 =</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: '#1890ff' }}>
                    {money((pricing.transportDistance || 0) * (pricing.transportUnitPrice || 0))}
                  </div>
                  <div style={{ fontSize: 10, color: '#999' }}>
                    {pricing.transportDistance} × {pricing.transportUnitPrice}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 4, padding: 6 }}>
                <div style={{ fontSize: 11, color: '#999' }}>市场调价系数</div>
                <InputNumber size="small" min={-0.5} max={0.5} step={0.01} value={pricing.marketAdjustmentRate}
                  onChange={v => handleParamChange('marketAdjustmentRate', v)} style={{ width: '100%' }}
                  formatter={v => `${(Number(v) * 100).toFixed(0)}%`} parser={v => Number(v?.replace('%', '')) / 100} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Button size="small" icon={<ReloadOutlined />} onClick={handleReset}>从规则恢复默认值</Button>
              </div>
              <div></div>
            </div>
          </Panel>

          {/* Panel 2: Pumping Fee Checklist */}
          <Panel header={`🏗️ 泵送费报价${selectedPumpingIds.length > 0 ? `（已选 ${selectedPumpingIds.length} 项）` : ''}`} key="pumping">
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
              勾选本项目需要的泵送方式（不影响混凝土单方价格，独立计算）
            </Text>
            {pumpingFeeItems.length === 0 ? (
              <Text type="secondary">暂无泵送方式，请先在设置中添加</Text>
            ) : (
              <div>
                {pumpingFeeItems.map(item => (
                  <div key={item.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center' }}>
                    <Checkbox
                      checked={selectedPumpingIds.includes(item.id)}
                      onChange={e => handlePumpingToggle(item.id, e.target.checked)}
                    />
                    <span style={{ flex: 1, marginLeft: 8 }}>{item.name}</span>
                    <span style={{ fontWeight: 'bold', minWidth: 80, textAlign: 'right' }}>{money(item.unitPrice)} 元/m³</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Panel 3: Material Details */}
          <Panel header="📋 材料成本明细" key="materials">
            <Table columns={materialColumns} dataSource={result.materialDetails || []}
              rowKey={(row) => `${row.materialId}-${row.materialName}`} pagination={false} size="small" />
            <div style={{ textAlign: 'right', marginTop: 8, fontWeight: 'bold' }}>
              材料成本小计: {money(result.materialCostSubtotal)} 元/m³
            </div>
          </Panel>

          {/* Panel 4: Cost Breakdown (collapsed by default) */}
          <Panel header="💰 费用构成" key="costs">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <CostRow label="材料成本小计" value={result.materialCostSubtotal} />
              <CostRow label="市场调价影响" value={result.marketAdjustmentAmount} />
              <CostRow label="制造费" value={result.manufacturingFee} />
              <CostRow label="技术服务费" value={result.technicalServiceFee} />
              <CostRow label="基础利润" value={result.baseProfit} />
              <CostRow label={`运输费（${result.transportDistance || 0}km × ${result.transportUnitPrice || 0}元/km/m³）`} value={result.transportFee} highlight />
              <CostRow label={`税费（${((result.vatRate || 0) * 100).toFixed(0)}%增值税）`} value={result.vatAmount} />
              <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 8, paddingTop: 8 }}>
                <CostRow label="内部底线价" value={result.internalFloorPrice} bold />
              </div>
            </div>
          </Panel>
        </Collapse>

        {/* Bottom Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <Button icon={<SaveOutlined />} onClick={() => setSaveModalVisible(true)}>保存报价</Button>
          <Button icon={<DownloadOutlined />} type="primary" onClick={handleExport}>导出 Excel</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>从规则恢复</Button>
        </div>
      </Card>

      {/* Save Modal */}
      <Modal title="保存报价到历史记录" open={saveModalVisible} onOk={handleSaveQuote}
        onCancel={() => setSaveModalVisible(false)} destroyOnClose>
        <div style={{ marginBottom: 8 }}>
          <Text>添加备注（可选）：</Text>
        </div>
        <Input.TextArea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="本次报价的备注信息..." />
      </Modal>
    </Spin>
  )
}

// Helper component for cost rows
const CostRow = ({ label, value, highlight, bold }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', padding: '4px 0',
    fontWeight: bold ? 'bold' : 'normal',
    background: highlight ? '#fff7e6' : 'transparent',
    borderRadius: highlight ? 4 : 0,
    paddingLeft: highlight ? 8 : 0,
    paddingRight: highlight ? 8 : 0
  }}>
    <span>{label}</span>
    <span>{money(value)} 元/m³</span>
  </div>
)

export default SalesQuoteResultCard
