// src/renderer/components/RestoreConfirmModal.jsx
import React from 'react'
import { Modal, Typography, Space } from 'antd'
import { WarningFilled } from '@ant-design/icons'

const { Text, Paragraph } = Typography

const RestoreConfirmModal = ({ backupPath, onConfirm, onCancel }) => {
  const fileName = backupPath ? backupPath.split(/[\\/]/).pop() : ''

  return (
    <Modal
      title={
        <Space>
          <WarningFilled style={{ color: '#faad14' }} />
          确认恢复数据库
        </Space>
      }
      open={true}
      onOk={onConfirm}
      onCancel={onCancel}
      okText="确认恢复"
      okButtonProps={{ danger: true }}
      cancelText="取消"
    >
      <Paragraph>
        此操作将用所选备份覆盖所有现有数据，包括：
      </Paragraph>
      <ul>
        <li>材料库（水泥、砂石、减水剂等）</li>
        <li>配合比方案</li>
        <li>系统参数</li>
      </ul>
      <Paragraph>
        <Text strong>此操作无法撤销。</Text>
      </Paragraph>
      <Paragraph type="secondary">
        即将恢复的文件：{fileName}
      </Paragraph>
    </Modal>
  )
}

export default RestoreConfirmModal
