/**
 * 博客园 (cnblogs.com) 适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Cnblogs')

export class CnblogsAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'cnblogs',
    name: '博客园',
    icon: 'https://www.cnblogs.com/favicon.ico',
    homepage: 'https://www.cnblogs.com',
    capabilities: ['article', 'draft', 'publish', 'image_upload'],
  }

  /** 预处理配置: 博客园使用 Markdown 格式 */
  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  private xsrfToken: string | null = null

  /** 服务端下发的请求头名（`/api/xsrf` 的 headerName，默认 X-XSRF-TOKEN） */
  private xsrfHeader = 'X-XSRF-TOKEN'

  /** 博客园 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://i.cnblogs.com/*',
      headers: {
        'Origin': 'https://i.cnblogs.com',
        'Referer': 'https://i.cnblogs.com/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://upload.cnblogs.com/*',
      headers: {
        'Origin': 'https://i.cnblogs.com',
        'Referer': 'https://i.cnblogs.com/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  /**
   * 取 CSRF 凭据
   *
   * 博客园的写接口是 ASP.NET Core 的 antiforgery 双要素校验：
   * 请求头里的串来自 `GET /api/xsrf` 的 `request` 字段，
   * 配套的 `.AspNetCore.Antiforgery.*` Cookie 由同一个响应下发（浏览器的
   * cookie jar 会自动收下）。只凭 `XSRF-TOKEN` Cookie 去拼请求头，
   * 服务端对不上，返回 400/403 —— 表现就是「明明登录了，却提示未登录」。
   *
   * 所以顺序是：先问 `/api/xsrf` 要官方串（连 headerName 一起），
   * 拿不到再退回 Cookie（值可能是 URL 编码的，必须 decode）。
   */
  private async getXsrfToken(): Promise<string | null> {
    if (this.xsrfToken) {
      return this.xsrfToken
    }

    // 1. 官方端点
    try {
      const response = await this.runtime.fetch('https://i.cnblogs.com/api/xsrf', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })

      if (response.ok) {
        const text = await response.text()
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          const request = (data.request ?? data.token ?? data.xsrfToken) as string | undefined
          const headerName = (data.headerName ?? data.header) as string | undefined
          if (request) {
            this.xsrfToken = request
            if (headerName) this.xsrfHeader = headerName
            logger.debug(`Got XSRF from /api/xsrf (header: ${this.xsrfHeader})`)
            return request
          }
        } catch {
          logger.debug('/api/xsrf 返回的不是 JSON：', text.slice(0, 120))
        }
      } else {
        logger.debug('/api/xsrf 状态码：', response.status)
      }
    } catch (error) {
      logger.debug('/api/xsrf 请求失败：', error)
    }

    // 2. 退回 Cookie
    if (this.runtime.getCookie) {
      const domains = ['i.cnblogs.com', '.cnblogs.com', 'cnblogs.com']
      for (const domain of domains) {
        const value = await this.runtime.getCookie(domain, 'XSRF-TOKEN')
        if (!value) continue
        let decoded = value
        try {
          decoded = decodeURIComponent(value)
        } catch {
          // 不是 URL 编码就原样用
        }
        this.xsrfToken = decoded
        logger.debug(`Got XSRF-TOKEN from cookie (${domain})`)
        return decoded
      }
    } else {
      logger.warn('getCookie API not available')
    }

    logger.warn('Could not find XSRF token')
    return null
  }


  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch('https://home.cnblogs.com/user/CurrentUserInfo', {
        method: 'GET',
        credentials: 'include',
      })

      const text = await response.text()

      // 解析 HTML 响应获取用户信息
      // 页面结构: <a href="/u/xxx/"><img class="pfs" src="..."></a>
      const avatarMatch = text.match(/<img[^>]+class="pfs"[^>]+src="([^"]+)"/)
      const linkMatch = text.match(/href="\/u\/([^/]+)\/"/)

      if (!linkMatch) {
        return { isAuthenticated: false }
      }

      const uid = linkMatch[1]
      const avatar = avatarMatch ? avatarMatch[1] : undefined

      return {
        isAuthenticated: true,
        userId: uid,
        username: uid,
        avatar,
      }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish to cnblogs...')

      // 1. Get XSRF-TOKEN
      const xsrfToken = await this.getXsrfToken()
      logger.info('XSRF-TOKEN:', xsrfToken ? `${xsrfToken.substring(0, 20)}...` : 'null')
      if (!xsrfToken) {
        throw new Error('获取 XSRF-TOKEN 失败，请刷新页面后重试')
      }

      // 保存 xsrfToken 供 uploadImageByUrl 使用
      this.xsrfToken = xsrfToken

      // 2. 处理图片上传
      let markdown = article.markdown || ''
      logger.debug('Markdown before processImages:', markdown.substring(0, 200))

      markdown = await this.processImages(
        markdown,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['cnblogs.com', 'img2024.cnblogs.com', 'img2023.cnblogs.com'],
          onProgress: options?.onImageProgress,
        }
      )

      logger.debug('Markdown after processImages:', markdown.substring(0, 200))

      // 3. Build request headers（头名用服务端下发的，别写死大小写）
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [this.xsrfHeader]: xsrfToken,
      }

      logger.debug('Request headers:', JSON.stringify(headers))
      logger.debug('Markdown content length:', markdown.length)

      // 4. 创建/发布文章
      const publishing = this.shouldPublish(options)
      const response = await this.runtime.fetch('https://i.cnblogs.com/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          id: null,
          postType: 2, // 2 = 文章, 1 = 随笔
          accessPermission: 0,
          title: article.title,
          url: null,
          postBody: markdown,
          categoryIds: null,
          categories: null,
          collectionIds: [],
          inSiteCandidate: false,
          inSiteHome: false,
          siteCategoryId: null,
          blogTeamIds: null,
          isPublished: publishing,
          displayOnHomePage: false,
          isAllowComments: true,
          includeInMainSyndication: false,
          isPinned: false,
          showBodyWhenPinned: false,
          isOnlyForRegisterUser: false,
          isUpdateDateAdded: false,
          entryName: null,
          description: null,
          featuredImage: null,
          tags: null,
          password: null,
          publishAt: publishing ? new Date().toISOString() : null,
          datePublished: new Date().toISOString(),
          dateUpdated: null,
          isMarkdown: true,
          isDraft: !publishing,
          autoDesc: null,
          changePostType: false,
          blogId: 0,
          author: null,
          removeScript: false,
          clientInfo: null,
          changeCreatedTime: false,
          canChangeCreatedTime: false,
          isContributeToImpressiveBugActivity: false,
          usingEditorId: 5,
          sourceUrl: null,
        }),
      })

      // 检查响应
      const responseText = await response.text()
      logger.debug('Create post response:', response.status, responseText.substring(0, 300))

      if (!response.ok) {
        // 认证类失败：让用户去重新登录，别把 403 说成「参数错误」
        if (response.status === 401 || response.status === 403) {
          this.xsrfToken = null
          throw new Error('未登录或登录已过期，请重新登录博客园')
        }
        // 400 多半是 antiforgery 双要素没对上：清掉缓存的串，下次重新取
        if (response.status === 400) {
          this.xsrfToken = null
          throw new Error(`创建草稿被拒（400）：CSRF 校验未通过或字段不合法 - ${responseText.slice(0, 200)}`)
        }
        throw new Error(`创建草稿失败: ${response.status} - ${responseText}`)
      }

      let responseData: { id?: number; blogId?: number; error?: string }
      try {
        responseData = JSON.parse(responseText)
      } catch {
        throw new Error(`创建草稿失败: 响应不是有效 JSON - ${responseText.substring(0, 100)}`)
      }

      if (!responseData.id) {
        throw new Error(responseData.error || '创建草稿失败: 无效响应')
      }

      const postId = String(responseData.id)
      const editUrl = `https://i.cnblogs.com/posts/edit;postId=${postId}`
      const publishedUrl = (responseData as { url?: string }).url || editUrl

      logger.debug('Post saved:', postId, publishing ? '(published)' : '(draft)')

      return this.createResult(true, {
        postId,
        postUrl: publishing ? publishedUrl : editUrl,
        draftOnly: !publishing,
        message: publishing ? '已直接发布' : (options?.draftOnly === false ? this.unsupportedPublishMessage() : undefined),
      })
    }).catch((error) => this.createResult(false, {
      error: (error as Error).message,
    }))
  }

  /**
   * 上传图片到博客园
   * 使用新版 CORS 上传接口
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (!this.xsrfToken) {
      throw new Error('XSRF-TOKEN 未获取')
    }

    // 下载图片
    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    // 构建 FormData
    const formData = new FormData()
    formData.append('image', imageBlob, 'image.png')
    formData.append('app', 'blog')
    formData.append('uploadType', 'Select')

    // 上传图片
    const uploadResponse = await this.runtime.fetch(
      'https://upload.cnblogs.com/v2/images/cors-upload',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-xsrf-token': this.xsrfToken,
        },
        body: formData,
      }
    )

    const responseText = await uploadResponse.text()
    logger.debug('Image upload raw response:', responseText)

    if (!uploadResponse.ok) {
      throw new Error(`图片上传失败: ${uploadResponse.status} - ${responseText}`)
    }

    let res: Record<string, unknown>
    try {
      res = JSON.parse(responseText)
    } catch {
      throw new Error(`图片上传失败: 响应不是 JSON - ${responseText.substring(0, 100)}`)
    }

    logger.debug('Image upload parsed response:', JSON.stringify(res))

    // 尝试不同的响应格式
    const imageUrl = res.data || res.url || res.imageUrl || res.src
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error(`图片上传失败: 无法获取图片 URL - ${JSON.stringify(res)}`)
    }

    logger.info('Image uploaded:', imageUrl)
    return {
      url: imageUrl,
    }
  }
}
