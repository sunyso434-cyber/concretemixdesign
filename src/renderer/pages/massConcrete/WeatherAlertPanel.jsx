import React, { useState } from 'react'
import { Card, Form, InputNumber, Select, Button, Alert, List, Tag, Space, Divider } from 'antd'

const WeatherAlertPanel = ({ onEvaluate }) => {
  const [weatherData, setWeatherData] = useState({
    temperature: 15,
    windSpeed: 3,
    solarRadiation: 500,
    humidity: 60,
    cloudCover: 5
  })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleEvaluate = async () => {
    setLoading(true)
    try {
      const response = await window.electron.ipcRenderer.invoke('mc_evaluateWeatherImpact', {
        weather: weatherData,
        alertThresholds: {}
      })
      if (response.success) {
        setResult(response.data)
        onEvaluate?.(response.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const getAlertTypeName = (type) => {
    const names = { wind: '大风', cold_wave: '寒潮', rain: '降雨' }
    return names[type] || type
  }

  const getAlertColor = (level) => {
    const colors = {
      green: '#52c41a',
      blue: '#1890ff',
      yellow: '#faad14',
      orange: '#fa8c16',
      red: '#f5222d'
    }
    return colors[level] || 'default'
  }

  return (
    <Card title="气象条件影响评估" size="small" style={{ marginTop: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Card type="inner" size="small" title="气象参数输入">
          <Form layout="inline">
            <Form.Item label="环境温度(°C)">
              <InputNumber
                value={weatherData.temperature}
                onChange={(v) => setWeatherData({ ...weatherData, temperature: v })}
                step={1}
                style={{ width: 90 }}
              />
            </Form.Item>
            <Form.Item label="风速(m/s)">
              <InputNumber
                value={weatherData.windSpeed}
                onChange={(v) => setWeatherData({ ...weatherData, windSpeed: v })}
                min={0}
                max={20}
                step={0.5}
                style={{ width: 90 }}
              />
            </Form.Item>
            <Form.Item label="太阳辐射(W/m²)">
              <InputNumber
                value={weatherData.solarRadiation}
                onChange={(v) => setWeatherData({ ...weatherData, solarRadiation: v })}
                min={0}
                max={1200}
                step={50}
                style={{ width: 110 }}
              />
            </Form.Item>
            <Form.Item label="湿度(%)">
              <InputNumber
                value={weatherData.humidity}
                onChange={(v) => setWeatherData({ ...weatherData, humidity: v })}
                min={0}
                max={100}
                step={5}
                style={{ width: 90 }}
              />
            </Form.Item>
            <Form.Item label="云量(0-10)">
              <InputNumber
                value={weatherData.cloudCover}
                onChange={(v) => setWeatherData({ ...weatherData, cloudCover: v })}
                min={0}
                max={10}
                step={1}
                style={{ width: 80 }}
              />
            </Form.Item>
          </Form>
        </Card>

        <Button
          type="primary"
          onClick={handleEvaluate}
          loading={loading}
        >
          评估气象影响
        </Button>

        {result && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {/* 预警信息 */}
            <Card type="inner" size="small" title="气象预警">
              <Space direction="vertical" style={{ width: '100%' }}>
                {result.alerts?.map((alert, idx) => (
                  <Alert
                    key={idx}
                    type={alert.level === 'green' ? 'success' : alert.level === 'blue' ? 'info' : alert.level}
                    message={
                      <Space>
                        <Tag color={getAlertColor(alert.level)}>
                          {getAlertTypeName(alert.type)} {alert.level === 'green' ? '正常' : alert.level}
                        </Tag>
                      </Space>
                    }
                    description={alert.message}
                    showIcon
                  />
                ))}
              </Space>
            </Card>

            {/* 修正系数 */}
            <Card type="inner" size="small" title="影响修正系数">
              <Space size="large">
                <div>
                  <span style={{ color: '#666' }}>日照影响系数:</span>
                  <span style={{ marginLeft: 8, fontWeight: 'bold', fontSize: 16 }}>
                    {result.coefficients?.sunFactor}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#666' }}>风速影响系数:</span>
                  <span style={{ marginLeft: 8, fontWeight: 'bold', fontSize: 16 }}>
                    {result.coefficients?.windFactor}
                  </span>
                </div>
              </Space>
              <Divider style={{ margin: '12px 0' }} />
              <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
                日照影响系数用于修正表面温升计算，风速影响系数用于修正散热系数
              </p>
            </Card>

            {/* 建议措施 */}
            {result.measures?.length > 0 && (
              <Card type="inner" size="small" title="施工建议">
                <List
                  dataSource={result.measures}
                  renderItem={item => (
                    <List.Item style={{ padding: '6px 0' }}>
                      <Tag color="orange">提醒</Tag>
                      {item}
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </Space>
        )}
      </Space>
    </Card>
  )
}

export default WeatherAlertPanel