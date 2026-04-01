import React from 'react'
import { Card, Typography, Row, Col, Statistic } from 'antd'

const { Title, Paragraph } = Typography

function Home() {
  return (
    <div>
      <Title level={2}>欢迎使用混凝土配合比设计软件</Title>
      <Paragraph>
        本软件用于混凝土配合比的设计和计算，支持多种材料的管理和配合比方案的保存。
      </Paragraph>
      
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col span={8}>
          <Card hoverable>
            <Statistic title="配合比设计" value="100+" suffix="方案" />
            <Paragraph style={{ marginTop: 16 }}>
              快速设计和计算混凝土配合比，满足不同强度等级的需求。
            </Paragraph>
          </Card>
        </Col>
        <Col span={8}>
          <Card hoverable>
            <Statistic title="材料管理" value="50+" suffix="种" />
            <Paragraph style={{ marginTop: 16 }}>
              管理水泥、骨料、外加剂等多种混凝土材料的参数。
            </Paragraph>
          </Card>
        </Col>
        <Col span={8}>
          <Card hoverable>
            <Statistic title="系统设置" value="10+" suffix="项" />
            <Paragraph style={{ marginTop: 16 }}>
              配置系统参数，优化配合比设计流程。
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Home
