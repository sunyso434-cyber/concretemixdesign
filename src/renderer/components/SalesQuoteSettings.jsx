import React, { useEffect, useState } from 'react'
import { Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Table, Tabs, message } from 'antd'

const SalesQuoteSettings = () => {
  const [rules, setRules] = useState([])
  const [mixes, setMixes] = useState([])
  const [editingRule, setEditingRule] = useState(null)
  const [ruleForm] = Form.useForm()

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
                  { title: '来源', dataIndex: 'source' }
                ]}
              />
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
    </Card>
  )
}

export default SalesQuoteSettings