import React, { useEffect, useState } from 'react'
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, message, Typography } from 'antd'
const { Text } = Typography

const SalesQuoteSettings = () => {
  const [rules, setRules] = useState([])
  const [mixes, setMixes] = useState([])
  const [editingRule, setEditingRule] = useState(null)
  const [ruleForm] = Form.useForm()
  const [editingMix, setEditingMix] = useState(null)
  const [mixForm] = Form.useForm()
  const [mixModalVisible, setMixModalVisible] = useState(false)
  const [mixMaterials, setMixMaterials] = useState([])

  const loadData = async () => {
    const ruleResult = await window.electronAPI.invoke('salesQuote:listRules')
    const mixResult = await window.electronAPI.invoke('salesQuote:listBasicMixDesigns', {})
    if (ruleResult.success) setRules(ruleResult.data)
    if (mixResult.success) setMixes(mixResult.data)
  }

  useEffect(() => { loadData() }, [])

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
      message.error(result.error || '保存失败')
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
    setMixMaterials(row.materials || [])
    setMixModalVisible(true)
  }

  const handleAddMix = () => {
    setEditingMix(null)
    mixForm.resetFields()
    setMixMaterials([])
    setMixModalVisible(true)
  }

  const handleSaveMix = async () => {
    const values = await mixForm.validateFields()
    const payload = {
      ...values,
      materials: mixMaterials
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
      message.error(result.error || '保存失败')
    }
  }

  const handleDeleteMix = async (row) => {
    if (!confirm(`确认删除 "${row.name}" 吗？`)) return
    const result = await window.electronAPI.invoke('salesQuote:deleteBasicMixDesign', row.id)
    if (result.success) {
      message.success('已删除')
      loadData()
    } else {
      message.error(result.error || '删除失败')
    }
  }

  const handleSetDefault = async (row) => {
    const result = await window.electronAPI.invoke('salesQuote:setDefaultBasicMixDesign', row.id)
    if (result.success) {
      message.success('已设为默认')
      loadData()
    } else {
      message.error(result.error || '设置失败')
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
              <Table
                rowKey="id"
                dataSource={rules}
                pagination={false}
                columns={[
                  { title: '类型', dataIndex: 'concreteType' },
                  { title: '制造费', dataIndex: 'suggestedManufacturingFee' },
                  { title: '技术服务费', dataIndex: 'suggestedTechnicalServiceFee' },
                  { title: '利润率', dataIndex: 'suggestedProfitRate', render: v => `${Number(v || 0) * 100}%` },
                  { title: '税率', dataIndex: 'vatRate', render: v => `${Number(v || 0) * 100}%` },
                  {
                    title: '操作',
                    render: (_, row) => (
                      <Button size="small" onClick={() => {
                        setEditingRule(row)
                        ruleForm.setFieldsValue({
                          ...row,
                          keywords: (row.keywords || []).join('，'),
                          costDrivers: (row.costDrivers || []).join('\n'),
                          productionDifficulties: (row.productionDifficulties || []).join('\n'),
                          minTechnicalServiceFee: row.technicalServiceFeeRange?.[0],
                          maxTechnicalServiceFee: row.technicalServiceFeeRange?.[1]
                        })
                      }}>编辑</Button>
                    )
                  }
                ]}
              />
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
                rowKey="id"
                dataSource={mixes}
                pagination={false}
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
          }
        ]}
      />

      <Modal title="编辑报价规则" open={!!editingRule} onOk={saveRule} onCancel={() => setEditingRule(null)}>
        <Form form={ruleForm} layout="vertical">
          <Form.Item name="keywords" label="触发关键词">
            <Input />
          </Form.Item>
          <Form.Item name="salesExplanation" label="销售解释">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="costDrivers" label="成本提升点">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="productionDifficulties" label="生产技术难点">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space>
            <Form.Item name="suggestedManufacturingFee" label="制造费">
              <InputNumber />
            </Form.Item>
            <Form.Item name="suggestedTechnicalServiceFee" label="技术服务费">
              <InputNumber />
            </Form.Item>
            <Form.Item name="suggestedProfitRate" label="利润率">
              <InputNumber step={0.01} />
            </Form.Item>
            <Form.Item name="vatRate" label="税率">
              <InputNumber step={0.01} />
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
        width={700}
      >
        <Form form={mixForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="strengthGrade" label="强度等级" rules={[{ required: true, message: '请输入强度等级' }]}>
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="concreteType" label="混凝土类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select style={{ width: 120 }} options={[
                { value: '普通', label: '普通' },
                { value: '泵送', label: '泵送' },
                { value: '抗渗', label: '抗渗' },
                { value: '早强', label: '早强' }
              ]} />
            </Form.Item>
            <Form.Item name="slump" label="坍落度">
              <InputNumber style={{ width: 100 }} addonAfter="mm" />
            </Form.Item>
          </Space>
          <Form.Item name="remarks" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        {mixMaterials.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">材料明细（共 {mixMaterials.length} 种）</Text>
            <Table
              size="small"
              pagination={false}
              dataSource={mixMaterials}
              rowKey="materialId"
              columns={[
                { title: '类型', dataIndex: 'materialType' },
                { title: '名称', dataIndex: 'materialName' },
                { title: '用量(kg)', dataIndex: 'usage' }
              ]}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>材料明细不支持在线编辑，如需修改请删除后重新创建</Text>
          </div>
        )}
      </Modal>
    </Card>
  )
}

export default SalesQuoteSettings