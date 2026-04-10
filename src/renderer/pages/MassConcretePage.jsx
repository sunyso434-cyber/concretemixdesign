// src/renderer/pages/MassConcretePage.jsx
import React, { useState, useEffect } from 'react'
import { Card, Tabs, Button, Space, message, Modal } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setActiveTab, setCurrentScheme, resetState, setMixDesignData, setAdiabaticTempData, setStressData, setInsulationData } from '../../store/massConcreteSlice'
import MixDesignTab from './massConcrete/MixDesignTab'
import TempRiseTab from './massConcrete/TempRiseTab'
import StressTab from './massConcrete/StressTab'
import InsulationTab from './massConcrete/InsulationTab'
import HistoryPanel from './massConcrete/HistoryPanel'

const { TabPane } = Tabs

/**
 * 大体积混凝土模块主页面组件
 * 基于 GB 50496-2018 大体积混凝土施工标准
 */
const MassConcretePage = () => {
  const dispatch = useDispatch()
  const activeTab = useSelector(state => state.massConcrete.activeTab)
  const currentScheme = useSelector(state => state.massConcrete.currentScheme)
  const mixDesignData = useSelector(state => state.massConcrete.mixDesignData)
  const adiabaticTempData = useSelector(state => state.massConcrete.adiabaticTempData)
  const stressData = useSelector(state => state.massConcrete.stressData)
  const insulationData = useSelector(state => state.massConcrete.insulationData)

  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  // 处理Tab切换
  const handleTabChange = (key) => {
    dispatch(setActiveTab(key))
  }

  // 配合比计算完成后的回调
  const handleMixDesignCalculate = () => {
    console.log('配合比计算完成，自动跳转到温升计算')
    // 可选：自动跳转到温升计算标签页
    // dispatch(setActiveTab('temprise'))
  }

  // 温升计算完成后的回调
  const handleTempRiseCalculate = () => {
    console.log('温升计算完成')
  }

  // 应力计算完成后的回调
  const handleStressCalculate = () => {
    console.log('应力计算完成')
  }

  // 保温计算完成后的回调
  const handleInsulationCalculate = () => {
    console.log('保温计算完成')
  }

  // Tab配置
  const tabItems = [
    {
      key: 'mixdesign',
      label: '配合比设计',
      children: <MixDesignTab onCalculate={handleMixDesignCalculate} />
    },
    {
      key: 'temprise',
      label: '温升计算',
      children: <TempRiseTab onCalculate={handleTempRiseCalculate} />
    },
    {
      key: 'stress',
      label: '应力计算',
      children: <StressTab onCalculate={handleStressCalculate} />
    },
    {
      key: 'insulation',
      label: '保温计算',
      children: <InsulationTab onCalculate={handleInsulationCalculate} />
    }
  ]

  // 加载方案时恢复数据
  const handleLoadScheme = (scheme) => {
    // 如果方案包含之前保存的数据，恢复到Redux
    if (scheme.mixDesignData) {
      dispatch(setMixDesignData(scheme.mixDesignData))
    }
    if (scheme.adiabaticTempData) {
      dispatch(setAdiabaticTempData(scheme.adiabaticTempData))
    }
    if (scheme.stressData) {
      dispatch(setStressData(scheme.stressData))
    }
    if (scheme.insulationData) {
      dispatch(setInsulationData(scheme.insulationData))
    }
    dispatch(setCurrentScheme(scheme))
    message.success(`已加载方案: ${scheme.name}`)
  }

  // 保存当前方案
  const handleSaveScheme = async () => {
    try {
      const schemeData = {
        name: currentScheme?.name || `大体积混凝土方案 ${Date.now()}`,
        projectName: currentScheme?.projectName || '',
        createdAt: new Date().toISOString(),
        mixDesignData,
        adiabaticTempData,
        stressData,
        insulationData,
        strength: mixDesignData?.strength || ''
      }

      const result = await window.electron.ipcRenderer.invoke('mc_saveScheme', schemeData)

      if (result.success) {
        message.success('方案保存成功')
        setSaveModalVisible(false)
      } else {
        message.error(result.error || '保存失败')
      }
    } catch (error) {
      console.error('保存方案失败:', error)
      message.error('保存方案失败')
    }
  }

  // 导出报告
  const handleExportReport = async () => {
    setExportLoading(true)
    try {
      // 检查是否有数据可导出
      if (!mixDesignData && !adiabaticTempData && !stressData && !insulationData) {
        message.warning('请先进行计算后再导出报告')
        setExportLoading(false)
        return
      }

      const result = await window.electron.ipcRenderer.invoke('mc_exportReport', {
        schemeName: currentScheme?.name || '未命名方案',
        mixDesignData,
        adiabaticTempData,
        stressData,
        insulationData
      })

      if (result.success) {
        message.success('报告导出成功')
      } else {
        message.error(result.error || '导出失败')
      }
    } catch (error) {
      console.error('导出报告失败:', error)
      message.error('导出报告失败')
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <div className="mass-concrete-page">
      {/* 页面标题 */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: 24,
          fontWeight: 600,
          color: '#171A20',
          margin: 0
        }}>
          大体积混凝土
        </h1>
        <p style={{
          fontSize: 14,
          color: '#666666',
          margin: '8px 0 0 0'
        }}>
          基于 GB 50496-2018 大体积混凝土施工标准
        </p>
      </div>

      {/* 主内容区域 */}
      <div style={{
        display: 'flex',
        gap: 24,
        alignItems: 'flex-start'
      }}>
        {/* 左侧主内容 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 标签页 */}
          <Card className="custom-card" bodyStyle={{ padding: 0 }}>
            <Tabs
              activeKey={activeTab}
              onChange={handleTabChange}
              type="card"
              items={tabItems}
              style={{ padding: '0 16px' }}
            />
          </Card>

          {/* 底部操作按钮 */}
          <div style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12
          }}>
            <Button
              type="primary"
              className="custom-btn"
              onClick={() => setSaveModalVisible(true)}
            >
              保存方案
            </Button>
            <Button
              className="custom-btn"
              onClick={handleExportReport}
              loading={exportLoading}
            >
              导出报告
            </Button>
          </div>
        </div>

        {/* 右侧历史面板 */}
        <div style={{ width: 380, flexShrink: 0 }}>
          <HistoryPanel onLoadScheme={handleLoadScheme} />
        </div>
      </div>

      {/* 保存方案确认弹窗 */}
      <Modal
        className="custom-modal"
        title="保存方案"
        open={saveModalVisible}
        onOk={handleSaveScheme}
        onCancel={() => setSaveModalVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <p>确定要保存当前方案吗？</p>
        <p style={{ fontSize: 12, color: '#666666', marginTop: 8 }}>
          方案将包含配合比设计、温度升幅、温度应力和保温计算的全部数据。
        </p>
      </Modal>
    </div>
  )
}

export default MassConcretePage