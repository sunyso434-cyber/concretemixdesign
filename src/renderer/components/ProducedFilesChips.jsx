import React from 'react'
import { Typography } from 'antd'
import { FileDoneOutlined } from '@ant-design/icons'
import FileMessageCard from './FileMessageCard'
import { extractProducedFiles } from '../utils/producedFiles'

const { Text } = Typography

/**
 * v0.9.x 输出优化：assistant 消息的"本轮产出文件"chips
 * 从消息 timeline 提取产出文件（workspace_writeFile 等），复用 FileMessageCard
 * （打开/显示文件夹/复制路径），无产出时返回 null。
 */
const ProducedFilesChips = ({ timeline, onOpenMd }) => {
  const files = extractProducedFiles(timeline)
  if (files.length === 0) return null

  return (
    <div style={{ marginTop: 6 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <FileDoneOutlined /> 本轮产出
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {files.map((f, idx) => (
          <FileMessageCard key={`${f.path}-${idx}`} file={f} onOpenMd={onOpenMd} />
        ))}
      </div>
    </div>
  )
}

export default ProducedFilesChips
