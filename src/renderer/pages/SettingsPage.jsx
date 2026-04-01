import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Select, Button, message, Table, Modal, Upload, Space, Divider, Alert } from 'antd';
import { DownloadOutlined, UploadOutlined, SaveOutlined, ReloadOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';

const { Option } = Select;

const SettingsPage = () => {
  const [params, setParams] = useState([]);
  const [form] = Form.useForm();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingParam, setEditingParam] = useState(null);

  // 加载系统参数
  useEffect(() => {
    const loadParams = async () => {
      console.log('开始加载系统参数');
      try {
        const result = await window.electron.ipcRenderer.invoke('get-all-params');
        console.log('收到系统参数响应:', result);
        if (result.success) {
          console.log('系统参数数据:', result.data);
          setParams(result.data);
        } else {
          console.error('获取系统参数失败:', result.error);
          message.error('获取系统参数失败');
        }
      } catch (error) {
        console.error('获取系统参数时发生错误:', error);
        message.error('获取系统参数失败');
      }
    };

    loadParams();
  }, []);

  // 打开添加/编辑参数模态框
  const showModal = (param = null) => {
    setEditingParam(param);
    if (param) {
      form.setFieldsValue({
        name: param.name,
        value: param.value,
        type: param.type,
        description: param.description
      });
    } else {
      form.resetFields();
    }
    setIsModalVisible(true);
  };

  // 关闭模态框
  const handleCancel = () => {
    setIsModalVisible(false);
  };

  // 保存参数
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const result = await window.electron.ipcRenderer.invoke('set-param', values);
      if (result.success) {
        message.success('参数保存成功');
        setIsModalVisible(false);
        // 重新加载参数
        const loadResult = await window.electron.ipcRenderer.invoke('get-all-params');
        if (loadResult.success) {
          setParams(loadResult.data);
        }
      } else {
        message.error('参数保存失败');
      }
    } catch (error) {
      console.error('保存参数时发生错误:', error);
      message.error('参数保存失败');
    }
  };

  // 删除参数
  const handleDelete = (name) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除该参数吗？',
      onOk: async () => {
        try {
          const result = await window.electron.ipcRenderer.invoke('delete-param', name);
          if (result.success) {
            message.success('参数删除成功');
            // 重新加载参数
            const loadResult = await window.electron.ipcRenderer.invoke('get-all-params');
            if (loadResult.success) {
              setParams(loadResult.data);
            }
          } else {
            message.error('参数删除失败');
          }
        } catch (error) {
          console.error('删除参数时发生错误:', error);
          message.error('参数删除失败');
        }
      }
    });
  };

  // 备份数据库
  const handleBackup = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('backup-database');
      if (result.success) {
        message.success(`数据库备份成功，备份文件路径：${result.data}`);
      } else {
        message.error('数据库备份失败');
      }
    } catch (error) {
      console.error('备份数据库时发生错误:', error);
      message.error('数据库备份失败');
    }
  };

  // 恢复数据库
  const handleRestore = async () => {
    // 这里需要实现文件选择功能，暂时使用模拟路径
    const backupPath = prompt('请输入备份文件路径：');
    if (backupPath) {
      try {
        const result = await window.electron.ipcRenderer.invoke('restore-database', backupPath);
        if (result.success) {
          message.success('数据库恢复成功');
          // 重新加载参数
          const loadResult = await window.electron.ipcRenderer.invoke('get-all-params');
          if (loadResult.success) {
            setParams(loadResult.data);
          }
        } else {
          message.error('数据库恢复失败');
        }
      } catch (error) {
        console.error('恢复数据库时发生错误:', error);
        message.error('数据库恢复失败');
      }
    }
  };

  // 导入数据
  const handleImport = async (file) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('import-data', file.path);
      if (result.success) {
        message.success('数据导入成功');
      } else {
        message.error('数据导入失败');
      }
    } catch (error) {
      console.error('导入数据时发生错误:', error);
      message.error('数据导入失败');
    }
  };

  // 导出数据
  const handleExport = async () => {
    // 这里需要实现文件保存功能，暂时使用模拟路径
    const exportPath = prompt('请输入导出文件路径：');
    if (exportPath) {
      try {
        const result = await window.electron.ipcRenderer.invoke('export-data', exportPath);
        if (result.success) {
          message.success('数据导出成功');
        } else {
          message.error('数据导出失败');
        }
      } catch (error) {
        console.error('导出数据时发生错误:', error);
        message.error('数据导出失败');
      }
    }
  };

  // 系统参数表格列定义
  const columns = [
    {
      title: '参数名称',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: '参数值',
      dataIndex: 'value',
      key: 'value'
    },
    {
      title: '参数类型',
      dataIndex: 'type',
      key: 'type',
      render: (type) => {
        switch (type) {
          case 'system': return '系统';
          case 'mixdesign': return '配合比';
          case 'backup': return '备份';
          default: return type;
        }
      }
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: '操作',
      key: 'action',
      render: (text, record) => (
        <Space size="middle">
          <Button type="primary" size="small" onClick={() => showModal(record)}>编辑</Button>
          <Button danger size="small" onClick={() => handleDelete(record.name)}>删除</Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 className="page-title">系统设置</h2>
        <p className="page-subtitle">管理系统参数和数据</p>
      </div>
      
      {/* 系统参数设置 */}
      <Card className="custom-card" title="系统参数设置" style={{ marginBottom: 24 }}>
        <div className="action-bar" style={{ marginBottom: 24 }}>
          <Button type="primary" className="custom-btn" icon={<PlusOutlined />} onClick={() => showModal()}>添加参数</Button>
        </div>
        <Table 
          className="custom-table"
          columns={columns} 
          dataSource={params} 
          rowKey="name"
          pagination={{ 
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`
          }}
        />
      </Card>

      {/* 数据管理 */}
      <Card className="custom-card" title="数据管理" style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert message="数据管理操作请谨慎执行，建议在操作前先备份数据库" type="warning" showIcon />
          <div className="action-bar" style={{ marginTop: 16 }}>
            <Button type="primary" className="custom-btn" icon={<SaveOutlined />} onClick={handleBackup}>备份数据库</Button>
            <Button className="custom-btn" icon={<ReloadOutlined />} onClick={handleRestore}>恢复数据库</Button>
            <Button className="custom-btn" icon={<UploadOutlined />} onClick={() => document.getElementById('import-file').click()}>导入数据</Button>
            <Button className="custom-btn" icon={<DownloadOutlined />} onClick={handleExport}>导出数据</Button>
            <input 
              id="import-file" 
              type="file" 
              style={{ display: 'none' }} 
              onChange={(e) => e.target.files[0] && handleImport(e.target.files[0])} 
            />
          </div>
        </Space>
      </Card>

      {/* 关于系统 */}
      <Card className="custom-card" title="关于系统">
        <div style={{ padding: '16px', background: '#f9f9f9', borderRadius: '8px' }}>
          <p style={{ marginBottom: 8 }}>混凝土配合比设计软件</p>
          <p style={{ marginBottom: 8 }}>版本：1.0.0</p>
          <p style={{ marginBottom: 8 }}>基于 Electron + React + SQLite 开发</p>
          <p>依据标准：JGJ 55, GB 50010-2010, GB 50204-2015, JGJ/T 193-2009</p>
        </div>
      </Card>

      {/* 添加/编辑参数模态框 */}
      <Modal
        className="custom-modal"
        title={editingParam ? '编辑参数' : '添加参数'}
        open={isModalVisible}
        onOk={handleSave}
        onCancel={handleCancel}
        width={600}
      >
        <Form className="custom-form" form={form} layout="vertical">
          <Form.Item
            name="name"
            label="参数名称"
            rules={[{ required: true, message: '请输入参数名称' }]}
          >
            <Input placeholder="请输入参数名称" />
          </Form.Item>
          <Form.Item
            name="value"
            label="参数值"
            rules={[{ required: true, message: '请输入参数值' }]}
          >
            <Input placeholder="请输入参数值" />
          </Form.Item>
          <Form.Item
            name="type"
            label="参数类型"
            rules={[{ required: true, message: '请选择参数类型' }]}
          >
            <Select placeholder="请选择参数类型">
              <Option value="system">系统</Option>
              <Option value="mixdesign">配合比</Option>
              <Option value="backup">备份</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input placeholder="请输入参数描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SettingsPage;