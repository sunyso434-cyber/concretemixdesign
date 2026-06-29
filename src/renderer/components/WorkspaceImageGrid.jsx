import React, { useEffect, useState } from 'react'
import { Empty, Spin, message } from 'antd'

export default function WorkspaceImageGrid() {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)

  const loadImages = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.vision.list()
      if (result?.success) {
        setImages(result.data || [])
      } else {
        message.error(result?.error || '读取图片列表失败')
        setImages([])
      }
    } catch (err) {
      message.error('读取图片列表异常：' + (err.message || '未知错误'))
      setImages([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadImages()
  }, [])

  if (loading) return <Spin />
  if (!images.length) return <Empty description="工作区暂无图片" />

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      gap: 16,
      padding: 16
    }}>
      {images.map(img => (
        <div key={img.path} className="image-card">
          <img
            src={`file://${img.path}`}
            alt={img.name}
            style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 4 }}
          />
          <div className="image-name">{img.name}</div>
        </div>
      ))}
    </div>
  )
}
