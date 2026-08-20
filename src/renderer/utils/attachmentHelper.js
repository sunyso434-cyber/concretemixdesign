/**
 * 附件解析辅助函数
 * 处理上传的图片附件
 */

/**
 * 根据文件扩展名判断附件类型
 * @param {string} filename
 * @returns {'image'|'unsupported'|null}
 */
export const getAttachmentType = (filename) => {
  if (!filename) return null
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image'
  return 'unsupported'
}

/**
 * 压缩图片并转 base64
 * @param {File} file
 * @param {object} options - { maxDimension: number, quality: number, maxSizeMb: number }
 * @returns {Promise<{base64: string, sizeKB: number, originalName: string, width: number, height: number}>}
 */
export const processImageAttachment = async (file, options = {}) => {
  const maxDimension = options.maxDimension || 1024
  const quality = options.quality || 0.8
  const maxSizeMb = options.maxSizeMb || 10

  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`图片超过 ${maxSizeMb}MB，请压缩后再上传`)
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round(height * (maxDimension / width))
            width = maxDimension
          } else {
            width = Math.round(width * (maxDimension / height))
            height = maxDimension
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024)
        resolve({
          base64: dataUrl,
          sizeKB,
          originalName: file.name,
          width,
          height
        })
      }
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}
