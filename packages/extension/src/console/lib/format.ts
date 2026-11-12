/**
 * 控制台格式化工具
 */

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`
  return formatDate(ts)
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function wordCount(article: { markdown?: string; html?: string; content?: string }): number {
  const text = article.markdown || article.html || article.content || ''
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .length
}

export function contentKind(article: { markdown?: string; html?: string; content?: string }): 'markdown' | 'html' {
  if (article.markdown) return 'markdown'
  return 'html'
}

export const STAGE_TEXT: Record<string, string> = {
  starting: '准备中',
  uploading_images: '上传图片',
  saving: '保存中',
  completed: '完成',
  failed: '失败',
}

export function reviewText(status?: string): string | null {
  switch (status) {
    case 'published':
      return '已发布'
    case 'reviewing':
      return '审核中'
    case 'rejected':
      return '未过审'
    default:
      return null
  }
}

/** 从平台 homepage 猜一个「去登录」地址（大多数平台首页即登录入口） */
export function loginHint(platformName: string): string {
  // 这几个平台登录态藏得比较深，给具体入口而不是泛泛的「请先登录」
  if (platformName.includes('头条')) {
    return '请在浏览器打开 mp.toutiao.com 登录头条号（不是 www.toutiao.com），登录后回到这里点「重新检测」'
  }
  if (platformName.includes('语雀')) {
    return '请在浏览器打开 yuque.com 登录，且账号下至少有一个知识库；登录后回到这里点「重新检测」'
  }
  if (platformName.includes('小红书')) {
    return '请在浏览器打开 creator.xiaohongshu.com 登录创作者中心，登录后回到这里点「重新检测」'
  }
  return `请先登录 ${platformName}，再回到控制台点「重新检测」`
}
