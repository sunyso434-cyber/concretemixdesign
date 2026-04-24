import React, { useState, useCallback } from 'react'
import { Card, Table, Button, Space, Input, InputNumber, Upload, message, Divider, Tag } from 'antd'
import { UploadOutlined, DeleteOutlined, ExperimentOutlined, ExportOutlined, PlusOutlined, DownloadOutlined } from '@ant-design/icons'
import * as XLSX from 'xlsx'

// 必要的列名
const REQUIRED_COLUMNS = ['名称', '胶材总量kg', '粉煤灰%', '矿渣粉%', '砂率%', '用水量', '强度MPa']
const REQUIRED_COLUMNS_ALT = ['name', 'cement', 'flyAshPercent', 'slagPercent', 'sandRatio', 'waterAmount', 'strength']

const InverseCalculationPage = () => {
  const [dataSource, setDataSource] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  // 约束默认值
  const [constraints, setConstraints] = useState({
    fceMin: 48,
    fceMax: 55,
    flyAshFactorMin: 0.5,
    flyAshFactorMax: 1.0,
    slagFactorMin: 0.5,
    slagFactorMax: 1.2
  })

  // Excel 导入处理
  const handleExcelImport = (file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet)

        if (jsonData.length === 0) {
          message.error('Excel文件为空或格式不正确')
          return false
        }

        // 检查必要的列是否存在（支持新旧列名）
        const firstRow = jsonData[0]
        const firstRowKeys = Object.keys(firstRow)
        const columnMapping = {
          '名称': 'name',
          '胶材总量kg': 'cement',
          '水泥kg': 'cement', // 兼容旧列名
          '粉煤灰%': 'flyAshPercent',
          '矿渣粉%': 'slagPercent',
          '砂率%': 'sandRatio',
          '用水量': 'waterAmount',
          '强度MPa': 'strength'
        }
        // 检查是否有至少一组必需的列
        const hasRequiredColumns = REQUIRED_COLUMNS.every(col => {
          const alias = col === '胶材总量kg' ? ['胶材总量kg', '水泥kg'] : [col]
          return alias.some(aliasCol => firstRowKeys.includes(aliasCol))
        })

        if (!hasRequiredColumns) {
          const missingColumns = REQUIRED_COLUMNS.filter(col => {
            const alias = col === '胶材总量kg' ? ['胶材总量kg', '水泥kg'] : [col]
            return !alias.some(aliasCol => firstRowKeys.includes(aliasCol))
          })
          message.error(`缺少必要的列: ${missingColumns.join(', ')}`)
          return false
        }

        if (missingColumns.length > 0) {
          message.error(`缺少必要的列: ${missingColumns.join(', ')}`)
          return false
        }

        // 转换为标准字段格式（兼容新旧列名）
        const formatted = jsonData.map((row, index) => ({
          key: index.toString(),
          name: row['名称'] || row['name'] || `样本${index + 1}`,
          cement: parseFloat(row['胶材总量kg'] || row['水泥kg']) || 0,
          flyAshPercent: parseFloat(row['粉煤灰%']) || 0,
          slagPercent: parseFloat(row['矿渣粉%']) || 0,
          sandRatio: parseFloat(row['砂率%']) || 0,
          waterAmount: parseFloat(row['用水量']) || 0,
          strength: parseFloat(row['强度MPa']) || 0
        })).filter(row => row.cement > 0 || row.strength > 0)

        setDataSource(formatted)
        setResult(null) // 清空之前的结果
        message.success(`成功导入 ${formatted.length} 条数据`)
      } catch (error) {
        console.error('Excel解析失败:', error)
        message.error('Excel文件解析失败，请检查文件格式')
      }
    }
    reader.readAsArrayBuffer(file)

    return false // 阻止默认上传行为
  }

  // 删除单条数据（使用filter保持不可变性）
  const handleDelete = useCallback((index) => {
    setDataSource(prevData => prevData
      .filter((_, idx) => idx !== index)
      .map((item, idx) => ({ ...item, key: idx.toString() })))
  }, [])

  // 更新字段值（提取为独立方法）
  const updateField = useCallback((index, field, value) => {
    setDataSource(prevData => prevData.map((item, idx) =>
      idx === index ? { ...item, [field]: value } : item
    ))
  }, [])

  // 清空所有数据
  const handleClear = () => {
    setDataSource([])
    setResult(null)
    message.info('已清空数据')
  }

  // 手动添加一行数据
  const handleAddRow = () => {
    const newRow = {
      key: dataSource.length.toString(),
      name: `样本${dataSource.length + 1}`,
      cement: 0,
      flyAshPercent: 0,
      slagPercent: 0,
      sandRatio: 0,
      waterAmount: 0,
      strength: 0
    }
    setDataSource([...dataSource, newRow])
    message.info('已添加一行数据')
  }

  // 下载Excel模板
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        '名称': '样本1',
        '胶材总量kg': 400,
        '粉煤灰%': 20,
        '矿渣粉%': 10,
        '砂率%': 38,
        '用水量': 160,
        '强度MPa': 35.5
      },
      {
        '名称': '样本2',
        '胶材总量kg': 420,
        '粉煤灰%': 25,
        '矿渣粉%': 15,
        '砂率%': 37,
        '用水量': 155,
        '强度MPa': 38.2
      }
    ]
    const ws = XLSX.utils.json_to_sheet(templateData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '反算数据模板')
    XLSX.writeFile(wb, 'inverse_calculation_template.xlsx')
    message.success('模板已下载：inverse_calculation_template.xlsx')
  }

  // 调用回归计算
  const handleCalculate = async () => {
    if (dataSource.length === 0) {
      message.warning('请先导入或输入数据')
      return
    }

    if (dataSource.length < 3) {
      message.warning('样本数量不足，请至少提供3组数据进行回归计算')
      return
    }

    // 数据校验：检查负数和超出合理范围的值
    for (let i = 0; i < dataSource.length; i++) {
      const row = dataSource[i]
      if (row.cement < 0 || row.cement > 2000) {
        message.warning(`第${i + 1}行：水泥用量 ${row.cement} 不在合理范围 (0-2000kg) 内`)
        return
      }
      if (row.flyAshPercent < 0 || row.flyAshPercent > 100) {
        message.warning(`第${i + 1}行：粉煤灰比例 ${row.flyAshPercent}% 不在合理范围 (0-100%) 内`)
        return
      }
      if (row.slagPercent < 0 || row.slagPercent > 100) {
        message.warning(`第${i + 1}行：矿渣粉比例 ${row.slagPercent}% 不在合理范围 (0-100%) 内`)
        return
      }
      if (row.sandRatio < 0 || row.sandRatio > 100) {
        message.warning(`第${i + 1}行：砂率 ${row.sandRatio}% 不在合理范围 (0-100%) 内`)
        return
      }
      if (row.waterAmount < 0 || row.waterAmount > 500) {
        message.warning(`第${i + 1}行：用水量 ${row.waterAmount} 不在合理范围 (0-500kg) 内`)
        return
      }
      if (row.strength < 0 || row.strength > 100) {
        message.warning(`第${i + 1}行：强度 ${row.strength} MPa 不在合理范围 (0-100 MPa) 内`)
        return
      }
    }

    setLoading(true)
    try {
      const response = await window.electron.ipcRenderer.invoke('inverseCalculation.calculate', {
        samples: dataSource,
        constraints
      })

      if (response.success) {
        setResult(response.result)
        message.success('计算完成')
      } else {
        message.error(response.error || '计算失败')
      }
    } catch (error) {
      console.error('计算失败:', error)
      message.error(`计算失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 表格列定义
  const columns = [
    {
      title: '序号',
      dataIndex: 'key',
      key: 'key',
      width: 60,
      render: (text, record, index) => index + 1
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
      editable: true,
      render: (text, record, index) => (
        <Input
          value={text}
          onChange={(e) => updateField(index, 'name', e.target.value)}
          placeholder="样本名称"
        />
      )
    },
    {
      title: '胶材总量kg',
      dataIndex: 'cement',
      key: 'cement',
      width: 100,
      editable: true,
      render: (text, record, index) => (
        <InputNumber
          value={text}
          onChange={(value) => updateField(index, 'cement', value || 0)}
          min={0}
          precision={1}
          style={{ width: '100%' }}
          placeholder="胶材总量"
        />
      )
    },
    {
      title: '粉煤灰%',
      dataIndex: 'flyAshPercent',
      key: 'flyAshPercent',
      width: 100,
      editable: true,
      render: (text, record, index) => (
        <InputNumber
          value={text}
          onChange={(value) => updateField(index, 'flyAshPercent', value || 0)}
          min={0}
          max={100}
          precision={1}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '矿渣粉%',
      dataIndex: 'slagPercent',
      key: 'slagPercent',
      width: 100,
      editable: true,
      render: (text, record, index) => (
        <InputNumber
          value={text}
          onChange={(value) => updateField(index, 'slagPercent', value || 0)}
          min={0}
          max={100}
          precision={1}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '砂率%',
      dataIndex: 'sandRatio',
      key: 'sandRatio',
      width: 100,
      editable: true,
      render: (text, record, index) => (
        <InputNumber
          value={text}
          onChange={(value) => updateField(index, 'sandRatio', value || 0)}
          min={0}
          max={100}
          precision={1}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '用水量',
      dataIndex: 'waterAmount',
      key: 'waterAmount',
      width: 100,
      editable: true,
      render: (text, record, index) => (
        <InputNumber
          value={text}
          onChange={(value) => updateField(index, 'waterAmount', value || 0)}
          min={0}
          precision={1}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '强度MPa',
      dataIndex: 'strength',
      key: 'strength',
      width: 100,
      editable: true,
      render: (text, record, index) => (
        <InputNumber
          value={text}
          onChange={(value) => updateField(index, 'strength', value || 0)}
          min={0}
          precision={1}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, record, index) => (
        <Button
          type="link"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(index)}
        >
          删除
        </Button>
      )
    }
  ]

  // 导出结果到Excel
  const handleExport = () => {
    if (!result) {
      message.warning('没有可导出的结果')
      return
    }

    const exportData = [
      { 参数: '水泥28天胶砂强度(MPa)', 值: result.cementStrength28d.toFixed(2) },
      { 参数: '粉煤灰影响系数', 值: result.flyAshFactor.toFixed(4) },
      { 参数: '矿渣粉影响系数', 值: result.slagFactor.toFixed(4) },
      { 参数: '组合系数γ', 值: result.combinedFactor.toFixed(4) },
      { 参数: 'R²', 值: result.rSquared.toFixed(4) },
      { 参数: '残差标准差(MPa)', 值: result.residualStdDev.toFixed(2) },
      { 参数: '样本数', 值: result.sampleCount },
      { 参数: '迭代次数', 值: result.iterations }
    ]

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '回归结果')
    XLSX.writeFile(wb, 'inverse_calculation_result.xlsx')
    message.success('结果已导出到 inverse_calculation_result.xlsx')
  }

  return (
    <div>
      <div className="mb-lg">
        <h2 className="page-title">参数反算</h2>
        <p className="page-subtitle">基于配合比试验数据进行回归分析，反算水泥胶砂强度和矿物掺合料影响系数</p>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* 左侧：数据导入 + 数据预览表格 */}
        <div style={{ flex: 2, minWidth: '400px' }}>
          <Card className="custom-card" title="数据导入">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space wrap>
                <Upload
                  accept=".xlsx,.xls"
                  beforeUpload={handleExcelImport}
                  showUploadList={false}
                >
                  <Button icon={<UploadOutlined />}>导入Excel文件</Button>
                </Upload>
                <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
                  下载模板
                </Button>
                <Button type="link" icon={<PlusOutlined />} onClick={handleAddRow}>
                  手动添加
                </Button>
              </Space>
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                Excel列名：名称、胶材总量kg（或水泥kg）、粉煤灰%、矿渣粉%、砂率%、用水量、强度MPa
              </div>

              <Divider style={{ margin: '12px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>数据预览（共 {dataSource.length} 条）</span>
                <Button size="small" onClick={handleClear} disabled={dataSource.length === 0}>
                  清空数据
                </Button>
              </div>

              <Table
                dataSource={dataSource}
                columns={columns}
                pagination={{ pageSize: 10, size: 'small' }}
                size="small"
                scroll={{ x: 800 }}
                locale={{ emptyText: '暂无数据，请导入Excel文件或手动输入' }}
              />

              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Button
                  type="primary"
                  icon={<ExperimentOutlined />}
                  onClick={handleCalculate}
                  loading={loading}
                  disabled={dataSource.length === 0}
                  size="large"
                >
                  执行回归计算
                </Button>
              </div>
            </Space>
          </Card>
        </div>

        {/* 右侧：回归配置（约束范围输入） */}
        <div style={{ flex: 1, minWidth: '300px' }}>
          <Card className="custom-card" title="回归约束配置">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <div style={{ fontWeight: 500, marginBottom: 12 }}>水泥28天胶砂强度 (MPa)</div>
                <Space>
                  <InputNumber
                    value={constraints.fceMin}
                    onChange={(value) => setConstraints({ ...constraints, fceMin: value || 0 })}
                    min={0}
                    max={100}
                    precision={1}
                    addonBefore="最小值"
                    style={{ width: 140 }}
                  />
                  <InputNumber
                    value={constraints.fceMax}
                    onChange={(value) => setConstraints({ ...constraints, fceMax: value || 0 })}
                    min={0}
                    max={100}
                    precision={1}
                    addonBefore="最大值"
                    style={{ width: 140 }}
                  />
                </Space>
              </div>

              <div>
                <div style={{ fontWeight: 500, marginBottom: 12 }}>粉煤灰影响系数Kf</div>
                <Space>
                  <InputNumber
                    value={constraints.flyAshFactorMin}
                    onChange={(value) => setConstraints({ ...constraints, flyAshFactorMin: value || 0 })}
                    min={0}
                    max={5}
                    precision={3}
                    addonBefore="最小值"
                    style={{ width: 140 }}
                  />
                  <InputNumber
                    value={constraints.flyAshFactorMax}
                    onChange={(value) => setConstraints({ ...constraints, flyAshFactorMax: value || 0 })}
                    min={0}
                    max={5}
                    precision={3}
                    addonBefore="最大值"
                    style={{ width: 140 }}
                  />
                </Space>
              </div>

              <div>
                <div style={{ fontWeight: 500, marginBottom: 12 }}>矿渣粉影响系数Ks</div>
                <Space>
                  <InputNumber
                    value={constraints.slagFactorMin}
                    onChange={(value) => setConstraints({ ...constraints, slagFactorMin: value || 0 })}
                    min={0}
                    max={5}
                    precision={3}
                    addonBefore="最小值"
                    style={{ width: 140 }}
                  />
                  <InputNumber
                    value={constraints.slagFactorMax}
                    onChange={(value) => setConstraints({ ...constraints, slagFactorMax: value || 0 })}
                    min={0}
                    max={5}
                    precision={3}
                    addonBefore="最大值"
                    style={{ width: 140 }}
                  />
                </Space>
              </div>

              <Divider />

              <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#666', lineHeight: 1.8 }}>
                  <strong>说明：</strong><br />
                  1. 水泥28天胶砂强度默认值范围：48-55 MPa<br />
                  2. 粉煤灰影响系数Kf反映粉煤灰对强度的影响<br />
                  3. 矿渣粉影响系数Ks反映矿渣粉对强度的影响<br />
                  4. 组合系数γ用于同时使用两种掺合料的情况
                </div>
              </div>
            </Space>
          </Card>
        </div>
      </div>

      {/* 结果展示区域 */}
      {result && (
        <Card
          className="custom-card"
          title="回归结果"
          extra={
            <Button icon={<ExportOutlined />} onClick={handleExport}>
              导出结果
            </Button>
          }
          style={{ marginTop: 24 }}
        >
          <div className="result-grid">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div style={{ padding: 16, background: '#f8f9fa', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>水泥28天胶砂强度</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1E56A0' }}>
                  {result.cementStrength28d.toFixed(2)} <span style={{ fontSize: 12 }}>MPa</span>
                </div>
              </div>

              <div style={{ padding: 16, background: '#f8f9fa', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>粉煤灰影响系数Kf</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1E56A0' }}>
                  {result.flyAshFactor.toFixed(4)}
                </div>
              </div>

              <div style={{ padding: 16, background: '#f8f9fa', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>矿渣粉影响系数Ks</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1E56A0' }}>
                  {result.slagFactor.toFixed(4)}
                </div>
              </div>

              <div style={{ padding: 16, background: '#f8f9fa', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>组合系数γ</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1E56A0' }}>
                  {result.combinedFactor.toFixed(4)}
                </div>
              </div>
            </div>

            <Divider />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div>
                <span style={{ color: '#666' }}>R² (决定系数): </span>
                <Tag color={result.rSquared >= 0.9 ? 'success' : result.rSquared >= 0.7 ? 'warning' : 'error'}>
                  {result.rSquared.toFixed(4)}
                </Tag>
              </div>
              <div>
                <span style={{ color: '#666' }}>残差标准差: </span>
                <strong>{result.residualStdDev != null ? `${result.residualStdDev.toFixed(2)} MPa` : 'N/A'}</strong>
              </div>
              <div>
                <span style={{ color: '#666' }}>样本数: </span>
                <strong>{result.sampleCount}</strong>
              </div>
              <div>
                <span style={{ color: '#666' }}>迭代次数: </span>
                <strong>{result.iterations}</strong>
              </div>
            </div>

            {result.residuals && result.residuals.length > 0 && (
              <>
                <Divider orientation="left">各样本残差 (MPa)</Divider>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {result.residuals.map((item, index) => (
                    <Tag key={index} color={Math.abs(item.residual) < 2 ? 'success' : 'warning'}>
                      {item.name}: {item.residual.toFixed(2)}
                    </Tag>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

export default InverseCalculationPage