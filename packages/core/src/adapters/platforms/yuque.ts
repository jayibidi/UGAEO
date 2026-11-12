/**
 * 语雀适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Yuque')

interface YuqueUserInfo {
  id: number
  name: string
  avatar_url: string
}

interface YuqueBook {
  target_id: number
  user: YuqueUserInfo
}

export class YuqueAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'yuque',
    name: '语雀',
    icon: 'https://gw.alipayobjects.com/zos/rmsportal/UTjFYEzMSYVwzxIGVhMu.png',
    homepage: 'https://www.yuque.com/dashboard',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  /** 预处理配置: 语雀使用 Markdown 格式 (转换为 lake) */
  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
    // doPreFilter + processDocCode (旧版)
    removeSpecialTags: true,
    removeSpecialTagsWithParent: true,
    processCodeBlocks: true,
  }

  private userInfo: YuqueUserInfo | null = null
  private bookId: number | null = null
  private csrfToken: string = ''
  private currentPostId: number | null = null

  /** 语雀 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://www.yuque.com/api/*',
      headers: {
        'Origin': 'https://www.yuque.com',
        'Referer': 'https://www.yuque.com/dashboard',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  /**
   * 解析语雀的 CSRF token
   *
   * 语雀改版比较频繁，cookie 名从 `ctoken` 换成过 `yuque_ctoken`，
   * 不同账号/子域也可能只留其一，所以按「Cookie → 页面 meta」依次兜底，
   * 取不到返回 null（由调用方决定是否报错）。
   */
  private async resolveCsrfToken(): Promise<string | null> {
    if (this.runtime.getCookie) {
      for (const name of ['yuque_ctoken', 'ctoken', '_yuque_ctoken']) {
        const value = await this.runtime.getCookie('yuque.com', name)
        if (value) return value
      }
    }
    return this.fetchCsrfTokenFromPage()
  }

  /** 兜底：从 dashboard 页面的 meta / 内联脚本里提取 token */
  private async fetchCsrfTokenFromPage(): Promise<string | null> {
    try {
      const response = await this.runtime.fetch('https://www.yuque.com/dashboard', {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) return null
      const html = await response.text()
      const matched =
        html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/csrf[-_]?token["']?\s*[:=]\s*["']([A-Za-z0-9_-]{8,})["']/i)
      return matched ? matched[1] : null
    } catch {
      return null
    }
  }

  /** 发布路径专用：拿不到 token 就没法发 POST，直接报可读错误 */
  private async getCsrfToken(): Promise<string> {
    const token = await this.resolveCsrfToken()
    if (!token) {
      throw new Error('请先登录语雀')
    }
    return token
  }

  /** 请求「常用知识库」接口，可选带站点头（语雀对缺 Referer 的请求会 403） */
  private requestCommonUsed(withHeaders: boolean): Promise<Response> {
    const call = () =>
      this.runtime.fetch('https://www.yuque.com/api/mine/common_used', {
        method: 'GET',
        credentials: 'include',
        headers: this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {},
      })
    return withHeaders ? this.withHeaderRules(this.HEADER_RULES, call) : call()
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      this.csrfToken = (await this.resolveCsrfToken()) || ''
      logger.debug('checkAuth: csrf token', this.csrfToken ? 'found' : 'missing')

      let response = await this.requestCommonUsed(false)
      if (response.status === 403) {
        response = await this.requestCommonUsed(true)
      }

      if (response.status === 401 || response.status === 403) {
        return { isAuthenticated: false, error: '语雀登录态已失效，请重新登录' }
      }
      if (!response.ok) {
        return { isAuthenticated: false, error: `语雀接口返回 ${response.status}` }
      }

      const res = await response.json() as {
        data?: {
          books?: YuqueBook[]
        }
      }

      logger.debug('checkAuth response:', res)

      const books = res.data?.books
      if (!Array.isArray(books)) {
        return { isAuthenticated: false, error: '语雀返回数据异常，请稍后重试' }
      }

      const firstBook = books[0]
      if (firstBook?.user) {
        this.userInfo = firstBook.user
        this.bookId = firstBook.target_id

        return {
          isAuthenticated: true,
          userId: String(firstBook.user.id),
          username: firstBook.user.name,
          avatar: firstBook.user.avatar_url,
        }
      }

      // 账号还没有任何知识库时 books 为空，但这依然是已登录状态
      return { isAuthenticated: true }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', (error as Error).message)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish...')

      if (!this.userInfo || !this.bookId) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录语雀')
        }
      }

      if (!this.bookId) {
        throw new Error('语雀账号下没有可用知识库，请先在语雀创建一个知识库后再同步')
      }

      // 发布前再确认一次 token（页面可能已重新签发），拿不到就没法发 POST
      this.csrfToken = await this.getCsrfToken()

      const createResponse = await this.runtime.fetch(
        'https://www.yuque.com/api/docs',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': this.csrfToken,
          },
          body: JSON.stringify({
            title: article.title,
            type: 'Doc',
            format: 'lake',
            book_id: this.bookId,
            status: 0,
          }),
        }
      )

      const createRes = await createResponse.json() as {
        data?: { id: number }
        message?: string
      }

      logger.debug('Create doc response:', createRes)

      if (!createRes.data?.id) {
        throw new Error(createRes.message || '创建文档失败')
      }

      const postId = createRes.data.id
      this.currentPostId = postId

      // Use pre-processed markdown content directly
      let markdown = article.markdown || ''

      // Process images in markdown
      markdown = await this.processImages(
        markdown,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['yuque.com', 'cdn.nlark.com'],
          onProgress: options?.onImageProgress,
        }
      )

      const convertResponse = await this.runtime.fetch(
        'https://www.yuque.com/api/docs/convert',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': this.csrfToken,
          },
          body: JSON.stringify({
            from: 'markdown',
            to: 'lake',
            content: markdown,
          }),
        }
      )

      const convertRes = await convertResponse.json() as {
        data?: { content: string }
      }

      if (!convertRes.data?.content) {
        throw new Error('内容转换失败')
      }

      const lakeContent = convertRes.data.content

      const saveResponse = await this.runtime.fetch(
        `https://www.yuque.com/api/docs/${postId}/content`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': this.csrfToken,
          },
          body: JSON.stringify({
            format: 'lake',
            body_asl: lakeContent,
            body: `<div class="lake-content" typography="traditional">${lakeContent}</div>`,
            body_html: `<div class="lake-content" typography="traditional">${lakeContent}</div>`,
            draft_version: 0,
            sync_dynamic_data: false,
            save_type: 'auto',
            edit_type: 'Lake',
          }),
        }
      )

      const saveRes = await saveResponse.json()
      logger.debug('Save response:', saveRes)

      const draftUrl = `https://www.yuque.com/go/doc/${postId}/edit`

      return this.createResult(true, {
        postId: String(postId),
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      })
    }).catch((error) => this.createResult(false, {
      error: (error as Error).message,
    }))
  }

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (!this.currentPostId) {
      throw new Error('文档 ID 未设置')
    }

    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    const formData = new FormData()
    formData.append('file', imageBlob, 'image.jpg')

    const uploadUrl = `https://www.yuque.com/api/upload/attach?attachable_type=Doc&attachable_id=${this.currentPostId}&type=image`
    const uploadResponse = await this.runtime.fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-csrf-token': this.csrfToken,
      },
      body: formData,
    })

    const res = await uploadResponse.json() as {
      data?: {
        attachment_id: string
        url: string
      }
    }

    logger.debug('Image upload response:', res)

    if (!res.data?.url) {
      throw new Error('图片上传失败')
    }

    return {
      url: res.data.url,
    }
  }
}
