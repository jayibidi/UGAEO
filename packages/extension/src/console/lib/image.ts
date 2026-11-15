/**
 * 图片粘贴辅助：把剪贴板里的图片压成 dataURL，直接嵌进正文
 *
 * 为什么要压：一张手机截图原图 3~8 MB，转 base64 再 +33%，几十张就能把
 * chrome.storage.local 撑爆（虽然有 unlimitedStorage，但读写会明显变慢，
 * 同步时往平台传也更慢）。统一缩到 1400px 宽、JPEG 0.82，肉眼看不出差别。
 */

const MAX_WIDTH = 1400
const QUALITY = 0.82

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

function loadBitmap(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void; close: () => void }> {
  // createImageBitmap 在 Chrome 50+ 可用，比 Image + objectURL 少一次解码
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then(bitmap => ({
      width: bitmap.width,
      height: bitmap.height,
      draw: ctx => ctx.drawImage(bitmap, 0, 0),
      close: () => bitmap.close(),
    }))
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () =>
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw: ctx => ctx.drawImage(image, 0, 0),
        close: () => URL.revokeObjectURL(url),
      })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    image.src = url
  })
}

/**
 * File → dataURL
 *
 * 非图片或解码失败时抛错，由调用方决定是否提示；
 * GIF 不压缩（canvas 会丢掉动画），原样读取。
 */
export async function imageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('不是图片文件')
  if (file.type === 'image/gif') return readAsDataUrl(file)

  const bitmap = await loadBitmap(file)
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return readAsDataUrl(file)

    // JPEG 没有透明通道，先铺白底，否则 PNG 截图会变成黑块
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    if (scale !== 1) {
      ctx.imageSmoothingQuality = 'high'
      ctx.scale(scale, scale)
    }
    bitmap.draw(ctx)

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob) return readAsDataUrl(file)
    // 压完反而更大（小图）就用原图
    return blob.size < file.size ? readAsDataUrl(blob) : readAsDataUrl(file)
  } finally {
    bitmap.close()
  }
}
