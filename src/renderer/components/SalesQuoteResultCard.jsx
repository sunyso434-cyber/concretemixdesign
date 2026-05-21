import React from 'react'
import { Button, Card, Descriptions, Divider, Space, Table, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'

const { Text } = Typography

const money = (value) => Number(value || 0).toFixed(2)

const SalesQuoteResultCard = ({ data }) => {
  const columns = [
    { title: '材料类型', dataIndex: 'materialType', key: 'materialType' },
    { title: '材料名称', dataIndex: 'materialName', key: 'materialName' },
    { title: '用量(kg/m³)', dataIndex: 'usage', key: 'usage', render: money },
    { title: '本次单价(元/吨)', dataIndex: 'unitPrice', key: 'unitPrice', render: money },
    { title: '成本(元/m³)', dataIndex: 'cost', key: 'cost', render: money }
  ]

  const handleExport = async () => {
    const dialogResult = await window.electronAPI.invoke('show-save-dialog', {
      title: '导出报价单',
      defaultPath: `销售报价-${data.strengthGrade}-${data.concreteType}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (dialogResult?.data?.canceled || !dialogResult?.data?.filePath) return
    const result = await window.electronAPI.invoke('salesQuote:exportExcel', {
      filePath: dialogResult.data.filePath,
      quote: data,
      customerNote: '本报价为单方报价，含运输费、泵送费和13%增值税。'
    })
    if (result.success) message.success('报价单已导出')
    else message.error(result.error || '报价单导出失败')
  }

  return (
    <Card size="small" title={`${data.strengthGrade} ${data.concreteType} 单方报价建议`} style={{ marginBottom: 8, maxWidth: 720 }}>
      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="建议报价区间">{money(data.quoteRange?.min)} - {money(data.quoteRange?.max)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="建议成交价">{money(data.suggestedDealPrice)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="内部底线价">{money(data.internalFloorPrice)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="税费">含 {(Number(data.vatRate || 0) * 100).toFixed(0)}% 增值税</Descriptions.Item>
      </Descriptions>
      <Divider style={{ margin: '12px 0' }} />
      <Text strong>材料成本明细</Text>
      <Table columns={columns} dataSource={data.materialDetails || []} rowKey={(row) => `${row.materialId}-${row.materialName}`} pagination={false} size="small" style={{ marginTop: 8 }} />
      <Divider style={{ margin: '12px 0' }} />
      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="材料成本小计">{money(data.materialCostSubtotal)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="制造费">{money(data.manufacturingFee)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="技术服务费">{money(data.technicalServiceFee)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="基础利润">{money(data.baseProfit)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="运输费">{money(data.transportFee)} 元/m³</Descriptions.Item>
        <Descriptions.Item label="泵送费">{money(data.pumpingFee)} 元/m³</Descriptions.Item>
      </Descriptions>
      <Space style={{ marginTop: 12 }}>
        <Button icon={<DownloadOutlined />} type="primary" onClick={handleExport}>导出 Excel 报价单</Button>
      </Space>
    </Card>
  )
}

export default SalesQuoteResultCard