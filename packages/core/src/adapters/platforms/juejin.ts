/**
 * 掘金适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta, ReviewStatus } from '../../types'
import type { PublishOptions } from '../types'
import { signAWS4, crc32 } from '../../lib'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Juejin')

// ImageX 服务常量
const IMAGEX_AID = '2608'
const IMAGEX_SERVICE_ID = '73owjymdk6'

// 生成 UUID (用于 ImageX API)
function generateUUID(): string {
  return 'xxxxxxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  ) + Date.now().toString()
}

// ImageX Token 响应类型
interface ImageXTokenResponse {
  data?: {
    token: {
      AccessKeyId: string
      SecretAccessKey: string
      SessionToken: string
      ExpiredTime: string  // ISO 日期字符串 "2026-01-14T00:15:24+08:00"
      CurrentTime: string
    }
  }
  err_no?: number
  err_msg?: string
}

// 解析后的 Token
interface ImageXToken {
  AccessKeyId: string
  SecretAccessKey: string
  SessionToken: string
  ExpiredTime: number  // Unix 时间戳（毫秒）
}

// ImageX ApplyUpload 响应类型
interface ImageXApplyUploadResponse {
  ResponseMetadata: {
    RequestId: string
    Action: string
    Version: string
    Service: string
    Region: string
  }
  Result: {
    RequestId: string
    UploadAddress: {
      StoreInfos: Array<{
        StoreUri: string
        Auth: string
        UploadID: string
      }>
      UploadHosts: string[]
      SessionKey: string
    }
  }
}

// ImageX CommitUpload 响应类型
interface ImageXCommitUploadResponse {
  ResponseMetadata: {
    RequestId: string
    Action: string
    Version: string
    Service: string
    Region: string
  }
  Result: {
    RequestId: string
    Results: Array<{
      Uri: string
      UriStatus: number
    }>
    PluginResult: Array<{
      FileName: string
      ImageUri: string
      ImageWidth: number
      ImageHeight: number
      ImageMd5: string
      ImageFormat: string
      ImageSize: number
    }>
  }
}

export class JuejinAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'juejin',
    name: '掘金',
    icon: 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png',
    homepage: 'https://juejin.cn',
    capabilities: ['article', 'draft', 'publish', 'image_upload', 'categories', 'tags', 'cover'],
  }

  /** 预处理配置: 掘金使用 Markdown 格式 */
  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  private cachedCsrfToken: string | null = null
  private cachedImageXToken: ImageXToken | null = null
  private imageXTokenExpiry: number = 0
  private uuid: string = generateUUID()

  /** 掘金 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://api.juejin.cn/*',
      headers: {
        'Origin': 'https://juejin.cn',
        'Referer': 'https://juejin.cn/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://imagex.bytedanceapi.com/*',
      headers: {
        'Origin': 'https://juejin.cn',
        'Referer': 'https://juejin.cn/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch('https://api.juejin.cn/user_api/v1/user/get', {
        method: 'GET',
        credentials: 'include',
      })

      const data = await response.json() as {
        data?: {
          user_id?: string
          user_name?: string
          avatar_large?: string
        }
      }

      if (data.data?.user_id) {
        return {
          isAuthenticated: true,
          userId: data.data.user_id,
          username: data.data.user_name,
          avatar: data.data.avatar_large,
        }
      }

      return { isAuthenticated: false }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 获取 CSRF Token (参考 DSL juejin.transform.ts)
   */
  private async getCsrfToken(): Promise<string> {
    if (this.cachedCsrfToken) {
      return this.cachedCsrfToken
    }

    // 使用 runtime.fetch 以便 extension 能正确处理
    const response = await this.runtime.fetch('https://api.juejin.cn/user_api/v1/sys/token', {
      method: 'HEAD',
      headers: {
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.10',
      },
      credentials: 'include',
    })

    const wareToken = response.headers.get('x-ware-csrf-token')
    if (!wareToken) {
      logger.warn('CSRF token not found in response headers')
      throw new Error('Failed to get CSRF token')
    }

    // Token 格式: "0,{actual_token},86370000,success,{session_id}"
    const parts = wareToken.split(',')
    if (parts.length < 2) {
      throw new Error('Invalid CSRF token format')
    }

    this.cachedCsrfToken = parts[1]
    logger.debug('Got CSRF token:', this.cachedCsrfToken.substring(0, 10) + '...')
    return this.cachedCsrfToken
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish...')

      // 1. 获取 CSRF token
      const csrfToken = await this.getCsrfToken()

      // 2. 使用预处理好的 markdown（Content Script 已转换）
      // 掘金使用 Markdown 格式
      let markdown = article.markdown || ''

      // 3. 处理图片（上传到掘金图床）
      markdown = await this.processImages(
        markdown,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: [
            'juejin.cn', 'p1-juejin', 'p3-juejin',
            'p6-juejin', 'p9-juejin', 'byteimg.com'
          ],
          onProgress: options?.onImageProgress,
        }
      )

      // 6. 创建草稿 (参数来自 DSL juejin.yaml + juejin.transform.ts prepareBody)
      const createResponse = await this.runtime.fetch(
        'https://api.juejin.cn/content_api/v1/article_draft/create',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-secsdk-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            brief_content: article.summary ? article.summary.slice(0, 100) : '',
            category_id: '0',
            cover_image: '',
            edit_type: 10,
            html_content: 'deprecated',
            link_url: '',
            mark_content: markdown,
            tag_ids: [],
            title: article.title,
          }),
        }
      )

      // 检查响应状态和内容
      const responseText = await createResponse.text()
      logger.debug('Create draft response:', createResponse.status, responseText.substring(0, 300))

      if (!createResponse.ok) {
        throw new Error(`创建草稿失败: ${createResponse.status} - ${responseText}`)
      }

      let createData: { data?: { id?: string }; err_msg?: string; err_no?: number }
      try {
        createData = JSON.parse(responseText)
      } catch {
        throw new Error(`创建草稿失败: 响应不是有效 JSON - ${responseText.substring(0, 100)}`)
      }

      // 检查业务错误
      if (createData.err_no && createData.err_no !== 0) {
        throw new Error(createData.err_msg || `创建草稿失败: 错误码 ${createData.err_no}`)
      }

      if (!createData.data?.id) {
        throw new Error(createData.err_msg || '创建草稿失败: 无效响应')
      }

      const draftId = createData.data.id
      logger.debug('Draft created:', draftId)

      const draftUrl = `https://juejin.cn/editor/drafts/${draftId}`

      // 4. 自动发布（仅在明确要求且平台支持时）
      if (this.shouldPublish(options)) {
        try {
          const { url: publishUrl, articleId } = await this.publishDraft(draftId, csrfToken)
          const review = await this.resolveReviewStatus(articleId, publishUrl, options)

          return this.createResult(true, {
            postId: articleId,
            postUrl: review.url || publishUrl,
            draftOnly: false,
            reviewStatus: review.status,
            reviewStatusText: review.detail || this.reviewStatusText(review.status),
            reviewChecked: true,
            message: review.detail || this.reviewMessage(review.status),
          })
        } catch (publishError) {
          logger.warn('Publish failed, draft kept:', publishError)
          return this.createResult(true, {
            postId: draftId,
            postUrl: draftUrl,
            draftOnly: true,
            message: `草稿已保存，但自动发布失败：${(publishError as Error).message}`,
          })
        }
      }

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: true,
        message: options?.draftOnly === false ? this.unsupportedPublishMessage() : undefined,
      })
    }).catch((error) => this.createResult(false, {
      error: (error as Error).message,
    }))
  }

  /**
   * 发布掘金草稿
   * @returns 文章公开地址
   */
  private async publishDraft(
    draftId: string,
    csrfToken: string
  ): Promise<{ url: string; articleId: string }> {
    const response = await this.runtime.fetch(
      'https://api.juejin.cn/content_api/v1/article/publish',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-secsdk-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          draft_id: draftId,
          sync_to_org: false,
          column_ids: '',
          theme_ids: '',
          coupon: 0,
          encrypt_type: 0,
          source: 1,
        }),
      }
    )

    const text = await response.text()
    logger.debug('Publish response:', response.status, text.substring(0, 300))

    let data: { err_no?: number; err_msg?: string; data?: { article_id?: string; draft_id?: string } } = {}
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`发布失败: 响应不是有效 JSON - ${text.substring(0, 100)}`)
    }

    if (!response.ok || (data.err_no && data.err_no !== 0)) {
      throw new Error(data.err_msg || `发布失败: ${response.status}`)
    }

    const articleId = data.data?.article_id || draftId
    return { url: `https://juejin.cn/post/${articleId}`, articleId }
  }

  /**
   * 轮询掘金文章审核状态
   *
   * 掘金的发布接口只负责「提交」，审核结果体现在文章详情的 verify_status：
   *   0 未审核 / 1 审核通过 / 2 审核中 / 3 审核未通过
   * 老接口里还有 status（1 已发布 / 2 未发布），作为兜底判断。
   */
  private async resolveReviewStatus(
    articleId: string,
    publishUrl: string,
    options?: PublishOptions
  ): Promise<{ status: ReviewStatus; url?: string; detail?: string }> {
    if (options?.checkReviewStatus === false) {
      return { status: 'unknown', url: publishUrl }
    }

    return this.pollReviewStatus(
      async () => {
        const response = await this.runtime.fetch(
          'https://api.juejin.cn/content_api/v1/article/detail',
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article_id: articleId }),
          }
        )

        if (!response.ok) {
          throw new Error(`查询文章状态失败: ${response.status}`)
        }

        const raw = (await response.json()) as {
          err_no?: number
          err_msg?: string
          data?: {
            article_info?: {
              status?: number
              verify_status?: number
              article_id?: string
              forbid_reason?: string
            }
          }
        }

        if (raw.err_no && raw.err_no !== 0) {
          throw new Error(raw.err_msg || `查询文章状态失败: ${raw.err_no}`)
        }

        const info = raw.data?.article_info
        return {
          status: this.mapVerifyStatus(info?.verify_status, info?.status),
          url: info?.article_id ? `https://juejin.cn/post/${info.article_id}` : publishUrl,
          detail: info?.forbid_reason ? `审核未通过：${info.forbid_reason}` : undefined,
        }
      },
      { timeoutMs: options?.reviewTimeoutMs }
    )
  }

  /**
   * 掘金状态字段 → 统一审核状态
   */
  private mapVerifyStatus(verifyStatus?: number, status?: number): ReviewStatus {
    return mapJuejinVerifyStatus(verifyStatus, status)
  }

  /**
   * 审核状态对应的提示文案
   */
  private reviewMessage(status: ReviewStatus): string {
    switch (status) {
      case 'published':
        return '已发布，文章已公开'
      case 'reviewing':
        return '已提交，掘金审核中（通常几分钟）'
      case 'rejected':
        return '已提交，但审核未通过，请到掘金后台查看'
      default:
        return '已提交，审核状态未取到，请稍后到掘金确认'
    }
  }

  /**
   * 通过 Blob 上传图片（覆盖基类方法）
   * 需要设置动态请求头规则以支持 MCP 调用
   */
  async uploadImage(file: Blob, _filename?: string): Promise<string> {
    return this.withHeaderRules(this.HEADER_RULES, () => this.uploadImageBinaryInternal(file))
  }

  /**
   * 通过 URL 上传图片
   * 支持远程 URL 和 data URI，都使用 ImageX 流程
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    try {
      let blob: Blob

      if (src.startsWith('data:')) {
        // data URI 直接转 blob
        logger.debug('Detected data URI, converting to blob')
        blob = await fetch(src).then(r => r.blob())
      } else {
        // 远程 URL：先下载再上传
        logger.debug('Downloading remote image:', src.substring(0, 80))
        const response = await this.runtime.fetch(src, {
          method: 'GET',
        })

        if (!response.ok) {
          logger.warn('Failed to download image:', response.status)
          return { url: src }
        }

        blob = await response.blob()
      }

      // 使用 ImageX 流程上传
      const url = await this.uploadImageBinaryInternal(blob)
      logger.debug('Uploaded image:', src.substring(0, 50), '->', url)
      return { url }
    } catch (error) {
      logger.warn('Failed to upload image by URL:', src, error)
      return { url: src } // 失败时返回原 URL
    }
  }

  /**
   * 获取 ImageX 上传凭证
   */
  private async getImageXToken(): Promise<ImageXToken> {
    // 检查缓存是否有效（提前 60 秒过期）
    if (this.cachedImageXToken && Date.now() < this.imageXTokenExpiry - 60000) {
      return this.cachedImageXToken
    }

    const url = `https://api.juejin.cn/imagex/v2/gen_token?aid=${IMAGEX_AID}&uuid=${this.uuid}&client=web`
    const response = await this.runtime.fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const responseText = await response.text()
    logger.debug('gen_token response:', responseText.substring(0, 500))

    let data: ImageXTokenResponse
    try {
      data = JSON.parse(responseText)
    } catch {
      throw new Error(`Invalid JSON response from gen_token: ${responseText.substring(0, 200)}`)
    }

    if (data.err_no && data.err_no !== 0) {
      throw new Error(data.err_msg || `Failed to get ImageX token: err_no=${data.err_no}`)
    }

    const tokenData = data.data?.token
    if (!tokenData || !tokenData.AccessKeyId || !tokenData.SecretAccessKey) {
      throw new Error(`Invalid ImageX token response: ${responseText.substring(0, 200)}`)
    }

    // 解析 ISO 日期为时间戳
    const expiredTime = new Date(tokenData.ExpiredTime).getTime()

    this.cachedImageXToken = {
      AccessKeyId: tokenData.AccessKeyId,
      SecretAccessKey: tokenData.SecretAccessKey,
      SessionToken: tokenData.SessionToken,
      ExpiredTime: expiredTime,
    }
    this.imageXTokenExpiry = expiredTime

    logger.debug('Got ImageX token, expires at:', tokenData.ExpiredTime)

    return this.cachedImageXToken
  }

  /**
   * 申请图片上传
   */
  private async applyImageUpload(token: ImageXToken): Promise<ImageXApplyUploadResponse['Result']['UploadAddress']> {
    const url = `https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${IMAGEX_SERVICE_ID}`

    // 生成 AWS4 签名
    const signResult = await signAWS4({
      method: 'GET',
      url,
      accessKeyId: token.AccessKeyId,
      secretAccessKey: token.SecretAccessKey,
      securityToken: token.SessionToken,
      region: 'cn-north-1',
      service: 'imagex',
    })

    const response = await this.runtime.fetch(url, {
      method: 'GET',
      headers: {
        ...signResult.headers,
      },
    })

    const data = await response.json() as ImageXApplyUploadResponse

    if (!data.Result?.UploadAddress) {
      throw new Error('Failed to apply image upload')
    }

    return data.Result.UploadAddress
  }

  /**
   * 上传文件到 TOS
   */
  private async uploadToTOS(
    uploadAddress: ImageXApplyUploadResponse['Result']['UploadAddress'],
    file: Blob
  ): Promise<void> {
    const storeInfo = uploadAddress.StoreInfos[0]
    const uploadHost = uploadAddress.UploadHosts[0]

    if (!storeInfo || !uploadHost) {
      throw new Error('Invalid upload address')
    }

    // 构建上传 URL
    const uploadUrl = `https://${uploadHost}/${storeInfo.StoreUri}`

    // 计算 CRC32
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    const crc32Value = crc32(uint8Array)

    logger.debug('Uploading to TOS:', uploadUrl, 'size:', file.size, 'crc32:', crc32Value)

    // 上传文件
    const response = await this.runtime.fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': storeInfo.Auth,
        'Content-Type': file.type || 'application/octet-stream',
        'Content-CRC32': crc32Value,
      },
      body: file,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`TOS upload failed: ${response.status} ${text}`)
    }

    logger.debug('TOS upload success')
  }

  /**
   * 提交图片上传
   */
  private async commitImageUpload(
    token: ImageXToken,
    sessionKey: string
  ): Promise<ImageXCommitUploadResponse['Result']> {
    const url = `https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&SessionKey=${encodeURIComponent(sessionKey)}&ServiceId=${IMAGEX_SERVICE_ID}`

    // 生成 AWS4 签名
    const signResult = await signAWS4({
      method: 'POST',
      url,
      accessKeyId: token.AccessKeyId,
      secretAccessKey: token.SecretAccessKey,
      securityToken: token.SessionToken,
      region: 'cn-north-1',
      service: 'imagex',
    })

    const response = await this.runtime.fetch(url, {
      method: 'POST',
      headers: {
        ...signResult.headers,
        'Content-Length': '0',
      },
    })

    const data = await response.json() as ImageXCommitUploadResponse

    if (!data.Result) {
      throw new Error('Failed to commit image upload')
    }

    return data.Result
  }

  /**
   * 获取图片 URL
   */
  private async getImageUrl(uri: string): Promise<string> {
    const url = `https://api.juejin.cn/imagex/v2/get_img_url?aid=${IMAGEX_AID}&uuid=${this.uuid}&uri=${encodeURIComponent(uri)}&img_type=private`

    const response = await this.runtime.fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json() as {
      data?: { main_url?: string; backup_url?: string }
      err_no?: number
      err_msg?: string
    }

    if (data.err_no && data.err_no !== 0) {
      throw new Error(data.err_msg || 'Failed to get image URL')
    }

    const imageUrl = data.data?.main_url || data.data?.backup_url
    if (!imageUrl) {
      throw new Error('Invalid image URL response')
    }

    return imageUrl
  }

  /**
   * 上传图片 (ImageX 方式) - 内部使用
   */
  private async uploadImageBinaryInternal(file: Blob): Promise<string> {
    // 1. 获取上传凭证
    const token = await this.getImageXToken()

    // 2. 申请上传
    const uploadAddress = await this.applyImageUpload(token)
    logger.debug('Apply upload success, session:', uploadAddress.SessionKey.substring(0, 50) + '...')

    // 3. 上传到 TOS
    await this.uploadToTOS(uploadAddress, file)

    // 4. 提交上传
    const commitResult = await this.commitImageUpload(token, uploadAddress.SessionKey)
    logger.debug('Commit upload success:', commitResult.Results?.[0]?.Uri)

    // 5. 获取图片 URL
    const storeUri = uploadAddress.StoreInfos[0]?.StoreUri
    if (!storeUri) {
      throw new Error('No store URI in upload address')
    }

    const imageUrl = await this.getImageUrl(storeUri)
    logger.debug('Got image URL:', imageUrl)

    return imageUrl
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    const response = await this.runtime.fetch(
      'https://api.juejin.cn/tag_api/v1/query_category_briefs',
      {
        method: 'GET',
        credentials: 'include',
      }
    )

    const data = await response.json() as {
      data?: Array<{ category_id: string; category_name: string }>
    }

    // 转换为标准 Category 格式
    return (data.data || []).map(c => ({
      id: c.category_id,
      name: c.category_name,
    }))
  }
}

/**
 * 掘金状态字段 → 统一审核状态
 *
 * verify_status 是掘金当前的审核字段，优先采信：
 *   0 未审核 / 1 审核通过 / 2 审核中 / 3 审核未通过
 * 老接口的 status（1 已发布）作为兜底。
 */
export function mapJuejinVerifyStatus(verifyStatus?: number, status?: number): ReviewStatus {
  switch (verifyStatus) {
    case 1:
      return 'published'
    case 2:
      return 'reviewing'
    case 3:
      return 'rejected'
    case 0:
      return 'reviewing'
    default:
      break
  }

  if (status === 1) return 'published'
  return 'unknown'
}
