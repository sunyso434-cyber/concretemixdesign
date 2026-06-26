import React from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import Home from './pages/Home.jsx'
import MixDesign from './pages/MixDesign.jsx'
import Material from './pages/Material.jsx'
import Setting from './pages/Setting.jsx'

const { Header, Sider, Content } = Layout

function App() {
  return (
    <Layout className="app-container">
      {/* 头部导航 */}
      <Header className="header">
        <h1 style={{ margin: 0, fontSize: '18px' }}>砼智</h1>
        <div>系统设置</div>
      </Header>
      
      <Layout>
        {/* 侧边菜单 */}
        <Sider className="sider" width={200} theme="dark">
          <Menu
            mode="inline"
            defaultSelectedKeys={['1']}
            style={{ height: '100%', borderRight: 0 }}
            items={[
              {
                key: '1',
                label: <Link to="/">首页</Link>,
              },
              {
                key: '2',
                label: <Link to="/mix-design">配合比设计</Link>,
              },
              {
                key: '3',
                label: <Link to="/material">材料管理</Link>,
              },
              {
                key: '4',
                label: <Link to="/setting">系统设置</Link>,
              },
            ]}
          />
        </Sider>
        
        {/* 内容区域 */}
        <Content className="content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/mix-design" element={<MixDesign />} />
            <Route path="/material" element={<Material />} />
            <Route path="/setting" element={<Setting />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default App
