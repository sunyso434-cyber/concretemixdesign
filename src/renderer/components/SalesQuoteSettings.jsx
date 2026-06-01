import React, { useEffect, useState } from 'react'
import { Button, Card, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, message, Typography } from 'antd'
import { WATER_MATERIAL_ID, buildManualMixMaterials, buildMaterialOptions } from '../utils/salesQuoteMaterials.mjs'
import extractErrorMessage from '../utils/extractErrorMessage'
import PumpingFeeTab from './PumpingFeeTab'
import QuoteHistoryTab from './QuoteHistoryTab'
const { Text } = Typography

const CONCRETE_TYPES = ['普通', '泵送', '抗渗', '早强', '缓凝', '大体积', '高强']

const ruleColumns = (onEdit) => [
  {
    title: '操作',
    key: 'actions',
    fixed: 'left',
    width: 88,
    render: (_, row) => (
      <Button type="link" size="small" onClick={() => onEdit(row)}>编辑</Button>
    )
  },
  { title: '类型', dataIndex: 'concreteType', width: 100 },
  { title: '制造费', dataIndex: 'suggestedManufacturingFee', width: 90 },
  { title: '技术服务费', dataIndex: 'suggestedTechnicalServiceFee', width: 100 },
  { title: '利润率', dataIndex: 'suggestedProfitRate', width: 80, render: v => `${Number(v || 0) * 100}%` },
  { title: '税率', dataIndex: 'vatRate', width: 80, render: v => `${Number(v || 0) * 100}%` },
  { title: '启用', dataIndex: 'enabled', width: 72, render: v => (v ? '是' : '否') }
]

const SalesQuoteSettings = () => {
  const [rules, setRules] = useState([])
  const [mixes, setMixes] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [editingRule, setEditingRule] = useState(null)
  const [ruleModalVisible, setRuleModalVisible] = useState(false)
  const [ruleForm] = Form.useForm()
  const [editingMix, setEditingMix] = useState(null)
  const [mixForm] = Form.useForm()
  const [mixModalVisible, setMixModalVisible] = useState(false)
  const [mixMaterials, setMixMaterials] = useState([])
  const [companyName, setCompanyName] = useState('')
  const [companyContact, setCompanyContact] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')

  // Load company info from localStorage on mount
  useEffect(() => {
    setCompanyName(localStorage.getItem('salesQuote_companyName') || '')
    setCompanyContact(localStorage.getItem('salesQuote_companyContact') || '')
    setCompanyPhone(localStorage.getItem('salesQuote_companyPhone') || '')
  }, [])

  const saveCompanyInfo = () => {
    localStorage.setItem('salesQuote_companyName', companyName)
    localStorage.setItem('salesQuote_companyContact', companyContact)
    localStorage.setItem('salesQuote_companyPhone', companyPhone)
    message.success('公司信息已保存')
  }

  const loadData = async () => {
    const ruleResult = await window.electronAPI.invoke('salesQuote:listRules')
    const mixResult = await window.electronAPI.invoke('salesQuote:listBasicMixDesigns', {})
    if (ruleResult.success) {
      setRules(ruleResult.data)
    } else {
      message.error(extractErrorMessage(ruleResult.error, '加载报价规则失败'))
    }
    if (mixResult.success) {
      setMixes(mixResult.data)
    } else {
      message.error(extractErrorMessage(mixResult.error, '加载基础配合比失败'))
    }
  }

  const loadMaterials = async () => {
    const result = await window.electronAPI.invoke('getAllMaterials')
    if (result?.success) {
      setAllMaterials(result.data || [])
    }
  }

  useEffect(() => {
    loadData()
    loadMaterials()
  }, [])

  const openRuleEditor = (row) => {
    setEditingRule(row)
    setRuleModalVisible(true)
    ruleForm.setFieldsValue({
      ...row,
      keywords: (row.keywords || []).join('，'),
      costDrivers: (row.costDrivers || []).join('\n'),
      productionDifficulties: (row.productionDifficulties || []).join('\n'),
      minTechnicalServiceFee: row.technicalServiceFeeRange?.[0],
      maxTechnicalServiceFee: row.technicalServiceFeeRange?.[1]
    })
  }

  const openRuleCreator = () => {
    setEditingRule(null)
    ruleForm.resetFields()
    ruleForm.setFieldsValue({
      concreteType: '',
      keywords: '',
      costDrivers: '',
      productionDifficulties: '',
      suggestedSlump: 180,
      suggestedManufacturingFee: 18,
      suggestedTechnicalServiceFee: 0,
      minTechnicalServiceFee: 0,
      maxTechnicalServiceFee: 0,
      suggestedProfitRate: 0.12,
      suggestedTransportDistance: 20,
      suggestedTransportUnitPrice: 2.5,
      vatRate: 0.13,
      quoteRangeDelta: 5,
      enabled: true
    })
    setRuleModalVisible(true)
  }

  useEffect(() => {
    if (!editingRule) return
    ruleForm.setFieldsValue({
      ...editingRule,
      keywords: (editingRule.keywords || []).join('，'),
      costDrivers: (editingRule.costDrivers || []).join('\n'),
      productionDifficulties: (editingRule.productionDifficulties || []).join('\n'),
      minTechnicalServiceFee: editingRule.technicalServiceFeeRange?.[0],
      maxTechnicalServiceFee: editingRule.technicalServiceFeeRange?.[1]
    })
  }, [editingRule, ruleForm])

  const saveRule = async () => {
    const values = await ruleForm.validateFields()
    const result = await window.electronAPI.invoke('salesQuote:updateRule', {
      id: editingRule.id,
      data: {
        ...values,
        keywords: String(values.keywords || '').split(/[，,]/).map(item => item.trim()).filter(Boolean),
        costDrivers: String(values.costDrivers || '').split(/\n/).filter(Boolean),
        productionDifficulties: String(values.productionDifficulties || '').split(/\n/).filter(Boolean),
        technicalServiceFeeRange: [values.minTechnicalServiceFee || 0, values.maxTechnicalServiceFee || 0]
      }
    })
    if (result.success) {
      message.success('规则已保存')
      setEditingRule(null)
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '保存失败'))
    }
  }

  const saveRuleWithCreate = async () => {
    const values = await ruleForm.validateFields()
    const data = {
      ...values,
      keywords: String(values.keywords || '').split(/[,，;；、\n]/).map(item => item.trim()).filter(Boolean),
      costDrivers: String(values.costDrivers || '').split(/\n/).map(item => item.trim()).filter(Boolean),
      productionDifficulties: String(values.productionDifficulties || '').split(/\n/).map(item => item.trim()).filter(Boolean),
      technicalServiceFeeRange: [values.minTechnicalServiceFee || 0, values.maxTechnicalServiceFee || 0]
    }
    const result = editingRule
      ? await window.electronAPI.invoke('salesQuote:updateRule', { id: editingRule.id, data })
      : await window.electronAPI.invoke('salesQuote:createRule', data)
    if (result.success) {
      message.success('规则已保存')
      setEditingRule(null)
      setRuleModalVisible(false)
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '保存失败'))
    }
  }

  const setMixFormFields = (row) => {
    mixForm.setFieldsValue({
      name: row.name,
      strengthGrade: row.strengthGrade,
      concreteType: row.concreteType,
      slump: row.slump,
      remarks: row.remarks
    })
  }

  const handleEditMix = (row) => {
    setEditingMix(row)
    setMixFormFields(row)
    setMixMaterials((row.materials || []).map((m, i) => ({
      ...m,
      materialId: !m.materialId && (m.materialType === '水' || m.materialName === '水') ? WATER_MATERIAL_ID : m.materialId,
      _rowKey: m.materialId ? `mat-${m.materialId}` : `row-${i}`
    })))
    setMixModalVisible(true)
  }

  const handleAddMix = () => {
    setEditingMix(null)
    mixForm.resetFields()
    setMixMaterials([])
    setMixModalVisible(true)
  }

  const addMaterialRow = () => {
    setMixMaterials(prev => [...prev, { _rowKey: `new-${Date.now()}`, materialId: null, materialType: '', materialName: '', usage: null }])
  }

  const updateMaterialRow = (index, patch) => {
    setMixMaterials(prev => {
      const next = [...prev]
      const row = { ...next[index], ...patch }
      if (patch.materialId === WATER_MATERIAL_ID) {
        row.materialType = '水'
        row.materialName = '水'
      } else if (patch.materialId != null) {
        const mat = allMaterials.find(m => m.id === patch.materialId)
        if (mat) {
          row.materialType = mat.type
          row.materialName = mat.name
        }
      }
      next[index] = row
      return next
    })
  }

  const removeMaterialRow = (index) => {
    setMixMaterials(prev => prev.filter((_, i) => i !== index))
  }

  const handleSaveMix = async () => {
    const values = await mixForm.validateFields()
    const materials = buildManualMixMaterials(mixMaterials)
    if (materials.length === 0) {
      message.error('请至少添加一种材料并填写用量（kg/m³）')
      return
    }
    const payload = {
      ...values,
      materials
    }
    let result
    if (editingMix) {
      result = await window.electronAPI.invoke('salesQuote:updateBasicMixDesign', { id: editingMix.id, data: payload })
    } else {
      result = await window.electronAPI.invoke('salesQuote:createBasicMixDesign', payload)
    }
    if (result.success) {
      message.success(editingMix ? '已更新' : '已创建')
      setMixModalVisible(false)
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '保存失败'))
    }
  }

  const handleDeleteMix = async (row) => {
    if (!confirm(`确认删除 "${row.name}" 吗？`)) return
    const result = await window.electronAPI.invoke('salesQuote:deleteBasicMixDesign', row.id)
    if (result.success) {
      message.success('已删除')
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '删除失败'))
    }
  }

  const handleSetDefault = async (row) => {
    const result = await window.electronAPI.invoke('salesQuote:setDefaultBasicMixDesign', row.id)
    if (result.success) {
      message.success('已设为默认')
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '设置失败'))
    }
  }

  return (
    <Card title="销售报价设置">
      <Tabs
        items={[
          {
            key: 'rules',
            label: '报价规则',
            children: (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Button type="primary" size="small" onClick={openRuleCreator}>新增报价规则</Button>
                </div>
                <Table
                className="custom-table"
                rowKey="id"
                dataSource={rules}
                pagination={false}
                scroll={{ x: 720 }}
                locale={{ emptyText: '暂无报价规则，请重启应用或检查数据库初始化' }}
                columns={ruleColumns(openRuleEditor)}
                onRow={(row) => ({
                  onDoubleClick: () => openRuleEditor(row),
                  style: { cursor: 'pointer' }
                })}
              />
              </div>
            )
          },
          {
            key: 'mixes',
            label: '基础配合比库',
            children: (
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Button type="primary" size="small" onClick={handleAddMix}>新增基础配合比</Button>
                </div>
                <Table
                className="custom-table"
                rowKey="id"
                dataSource={mixes}
                pagination={false}
                scroll={{ x: 800 }}
                columns={[
                  { title: '名称', dataIndex: 'name' },
                  { title: '强度', dataIndex: 'strengthGrade' },
                  { title: '类型', dataIndex: 'concreteType' },
                  { title: '坍落度', dataIndex: 'slump' },
                  { title: '默认', dataIndex: 'isDefault', render: v => v ? '是' : '否' },
                  { title: '来源', dataIndex: 'source' },
                  {
                    title: '操作',
                    render: (_, row) => (
                      <Space>
                        <Button size="small" onClick={() => handleEditMix(row)}>编辑</Button>
                        <Button size="small" onClick={() => handleSetDefault(row)} disabled={row.isDefault}>设为默认</Button>
                        <Button size="small" danger onClick={() => handleDeleteMix(row)}>删除</Button>
                      </Space>
                    )
                  }
                ]}
                />
              </div>
            )
          },
          {
            key: 'pumpingFees',
            label: '泵送费清单',
            children: <PumpingFeeTab />
          },
          {
            key: 'history',
            label: '报价历史',
            children: <QuoteHistoryTab />
          }
        ]}
      />

      <Modal
        title={editingRule ? `编辑报价规则 - ${editingRule.concreteType}` : '新增报价规则'}
        open={ruleModalVisible}
        onOk={saveRuleWithCreate}
        onCancel={() => { setEditingRule(null); setRuleModalVisible(false); ruleForm.resetFields() }}
        destroyOnClose
        width={640}
      >
        <Form form={ruleForm} layout="vertical" preserve={false}>
          <Form.Item name="concreteType" label="混凝土类型" rules={[{ required: true, message: '请输入混凝土类型' }]}>
            <Input disabled={!!editingRule} placeholder="例如：抗冻、抗裂、低收缩" />
          </Form.Item>
          <Form.Item name="keywords" label="触发关键词">
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="suggestedManufacturingFee" label="制造费(元/m³)">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="suggestedTechnicalServiceFee" label="技术服务费(元/m³)">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="minTechnicalServiceFee" label="技术服务费下限">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="maxTechnicalServiceFee" label="技术服务费上限">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="suggestedProfitRate" label="利润率(小数)">
              <InputNumber min={0} max={1} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="vatRate" label="税率(小数)">
              <InputNumber min={0} max={1} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="suggestedTransportDistance" label="建议运距(km)">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="suggestedTransportUnitPrice" label="运输单价(元/km/m³)">
              <InputNumber min={0} step={0.1} style={{ width: 140 }} />
            </Form.Item>
          </Space>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingMix ? '编辑基础配合比' : '新增基础配合比'}
        open={mixModalVisible}
        onOk={handleSaveMix}
        onCancel={() => setMixModalVisible(false)}
        destroyOnClose
        width={820}
      >
        <Form form={mixForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="strengthGrade" label="强度等级" rules={[{ required: true, message: '请输入强度等级' }]}>
              <Input style={{ width: 120 }} placeholder="如 C35" />
            </Form.Item>
            <Form.Item name="concreteType" label="混凝土类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select
                style={{ width: 140 }}
                options={CONCRETE_TYPES.map(value => ({ value, label: value }))}
              />
            </Form.Item>
            <Form.Item name="slump" label="坍落度">
              <InputNumber style={{ width: 120 }} addonAfter="mm" min={0} />
            </Form.Item>
          </Space>
          <Form.Item name="remarks" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        <Divider orientation="left" plain>材料用量</Divider>
        <div style={{ marginBottom: 8 }}>
          <Button type="dashed" size="small" onClick={addMaterialRow}>
            添加材料
          </Button>
          {allMaterials.length === 0 && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>材料库为空时仍可先添加水</Text>
          )}
        </div>
        <Table
          size="small"
          pagination={false}
          dataSource={mixMaterials}
          rowKey={(row) => row._rowKey || row.materialId}
          locale={{ emptyText: '请添加材料并填写单方用量' }}
          columns={[
            {
              title: '材料',
              width: 280,
              render: (_, row, index) => (
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择材料"
                  value={row.materialId || undefined}
                  showSearch
                  optionFilterProp="label"
                  options={buildMaterialOptions(allMaterials)}
                  onChange={(materialId) => updateMaterialRow(index, { materialId })}
                />
              )
            },
            { title: '类型', dataIndex: 'materialType', width: 90 },
            {
              title: '单方用量(kg/m³)',
              width: 140,
              render: (_, row, index) => (
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={1}
                  value={row.usage}
                  onChange={(usage) => updateMaterialRow(index, { usage })}
                />
              )
            },
            {
              title: '操作',
              width: 72,
              render: (_, __, index) => (
                <Button type="link" size="small" danger onClick={() => removeMaterialRow(index)}>删除</Button>
              )
            }
          ]}
        />
      </Modal>

      <Divider style={{ margin: '16px 0' }} />
      <Typography.Title level={5}>公司信息（导出用）</Typography.Title>
      <Space wrap align="start">
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>公司名称</Text>
          <Input placeholder="公司名称" value={companyName} onChange={e => setCompanyName(e.target.value)}
            style={{ width: 200 }} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>联系人</Text>
          <Input placeholder="联系人" value={companyContact} onChange={e => setCompanyContact(e.target.value)}
            style={{ width: 120 }} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>联系电话</Text>
          <Input placeholder="联系电话" value={companyPhone} onChange={e => setCompanyPhone(e.target.value)}
            style={{ width: 140 }} />
        </div>
        <Button type="primary" onClick={saveCompanyInfo}>保存</Button>
      </Space>
    </Card>
  )
}

export default SalesQuoteSettings
