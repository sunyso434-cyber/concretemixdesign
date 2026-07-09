import React, { useEffect, useState } from 'react'
import { Button, Card, Divider, Input, Space, Tabs, Typography, message } from 'antd'
import PumpingFeeTab from './PumpingFeeTab'
import QuoteHistoryTab from './QuoteHistoryTab'

const { Text } = Typography

// v10.10 重写：销售报价规则表 SalesQuoteRule 整体删除,默认值由 reverse_sales_quote / forward_sales_quote
// Skill 内置;本组件只保留泵送费 + 报价历史 + 公司信息
const SalesQuoteSettings = () => {
  const [companyName, setCompanyName] = useState('')
  const [companyContact, setCompanyContact] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')

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

  return (
    <Card title="销售报价设置">
      <Tabs
        items={[
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
            style={{ width: 200 }} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>电话</Text>
          <Input placeholder="电话" value={companyPhone} onChange={e => setCompanyPhone(e.target.value)}
            style={{ width: 200 }} />
        </div>
        <Button type="primary" onClick={saveCompanyInfo} style={{ marginTop: 18 }}>保存公司信息</Button>
      </Space>
    </Card>
  )
}

export default SalesQuoteSettings
