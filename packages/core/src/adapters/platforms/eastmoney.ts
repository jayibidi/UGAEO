/**
 * 东方财富适配器
 */
import { CodeAdapter, type ImageUploadResult } from "../code-adapter";
import type {
  Article,
  AuthResult,
  SyncResult,
  PlatformMeta,
} from "../../types";
import type { PublishOptions } from "../types";
import type { Cookie } from "../../types";
import { createLogger } from "../../lib/logger";

const logger = createLogger("Eastmoney");

/** 登录 Cookie 名（财富号前端 document.cookie 读的就是这两个） */
const LOGIN_COOKIE_NAMES = ["ct", "ut"] as const;

/** 读取时的候选名：站点改版偶尔会把短名换成带 token 的全名 */
const LOGIN_COOKIE_ALIASES: Record<string, readonly string[]> = {
  ct: ["ct", "ctoken"],
  ut: ["ut", "utoken"],
};

/** 候选 Cookie 查询目标：优先按 URL 查（等价于页面真实会带上的 Cookie），最后按域名兜底 */
const COOKIE_TARGETS = [
  "https://mp.eastmoney.com/",
  "https://www.eastmoney.com/",
  ".eastmoney.com",
] as const;

/**
 * 取「最可信」的一个同名 Cookie
 *
 * 同一账号在不同子域/路径上可能有多个同名 Cookie，先按域名具体程度、
 * 再按路径长度、最后按过期时间排序，避免拿到站点迁移遗留的失效值。
 */
function pickBestCookie(cookies: Cookie[], name: string): string {
  const hits = cookies.filter((c) => c.name === name && c.value);
  if (hits.length === 0) return "";
  hits.sort((a, b) => {
    const domainDiff =
      b.domain.replace(/^\./, "").length - a.domain.replace(/^\./, "").length;
    if (domainDiff !== 0) return domainDiff;
    const pathDiff = (b.path || "/").length - (a.path || "/").length;
    if (pathDiff !== 0) return pathDiff;
    return (b.expirationDate || 0) - (a.expirationDate || 0);
  });
  return hits[0].value;
}

interface UploadResponse {
  code: number;
  message: string;
  data?: {
    url: string;
    id: string;
  };
}

interface DraftApiResponse {
  RRquestSuccess: boolean;
  RCode: number;
  RMsg?: string;
  RData: string;
}

interface DraftResult {
  error_code?: number;
  draft_id?: string;
  me?: string;
}

interface AuthorInfoResponse {
  Success: number;
  Message?: string;
  Result?: {
    accountId?: string;
    accountName?: string;
    portrait?: string;
    relatedUid?: string;
  } | null;
}

interface MainSiteUser {
  user_id?: string | number | null;
  user_nickname?: string;
  user_name?: string | null;
}

export class EastmoneyAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: "eastmoney",
    name: "东方财富",
    icon: "https://mp.eastmoney.com/collect/pc_article/favicon.ico",
    homepage: "https://mp.eastmoney.com",
    capabilities: ["article", "draft", "image_upload", "cover"],
  };

  /** 预处理配置 */
  readonly preprocessConfig = {
    outputFormat: "html" as const,
    removeComments: true,
    removeSpecialTags: true,
    processCodeBlocks: true,
    convertSectionToDiv: true,
    removeEmptyLines: true,
    removeEmptyDivs: true,
    removeNestedEmptyContainers: true,
    unwrapSingleChildContainers: true,
    unwrapNestedFigures: true,
    removeTrailingBr: true,
    removeDataAttributes: true,
    removeSrcset: true,
    removeSizes: true,
    compactHtml: true,
  };

  private ctoken: string = "";
  private utoken: string = "";
  private deviceId: string = "";

  /** 获取或生成持久化 deviceId（32位大写 hex） */
  private async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    const stored = await this.runtime.storage.get<string>("eastmoney_deviceId");
    if (stored) {
      this.deviceId = stored;
      return this.deviceId;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    this.deviceId = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join("");
    await this.runtime.storage.set("eastmoney_deviceId", this.deviceId);
    return this.deviceId;
  }

  /** API Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: "*://mp.eastmoney.com/*",
      headers: {
        Origin: "https://mp.eastmoney.com",
        HOST: "emfront.eastmoney.com",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  /** 鉴权请求头：财富号/主站接口都会校验来源，缺 Referer 时可能直接回「未登录」 */
  private readonly AUTH_HEADER_RULES = [
    {
      urlFilter: "*://caifuhaoapi.eastmoney.com/*",
      headers: {
        Origin: "https://mp.eastmoney.com",
        Referer: "https://mp.eastmoney.com/collect/pc_article/index.html",
      },
      resourceTypes: ["xmlhttprequest"],
    },
    {
      urlFilter: "*://gbapi.eastmoney.com/*",
      headers: {
        Origin: "https://mp.eastmoney.com",
        Referer: "https://mp.eastmoney.com/collect/pc_article/index.html",
      },
      resourceTypes: ["xmlhttprequest"],
    },
  ];

  async checkAuth(): Promise<AuthResult> {
    try {
      await this.fetchToken();
    } catch (error) {
      logger.debug("checkAuth: cookie missing -", error);
      return { isAuthenticated: false, error: (error as Error).message };
    }

    return this.withAuthHeaders(async () => {
      // 1. 财富号作者接口（官方创作平台判定登录态的地方）
      let authorError = "";
      try {
        const data = await this.fetchAuthorInfo();
        logger.debug("checkAuth getauthorinfo:", data);

        if (data.Success === 1 && data.Result?.accountId) {
          return {
            isAuthenticated: true,
            userId: String(data.Result.accountId),
            username: data.Result.accountName,
            avatar: data.Result.portrait,
          };
        }
        authorError = `财富号接口返回 ${data.Success}${
          data.Message ? `（${data.Message}）` : ""
        }`;
      } catch (error) {
        authorError = `财富号接口请求失败：${(error as Error).message}`;
      }

      // 2. 兜底：主站接口，用于区分「Cookie 无效」和「账号没有财富号权限」
      try {
        const user = await this.fetchMainSiteUser();
        if (user?.userId) {
          return {
            isAuthenticated: true,
            userId: user.userId,
            username: user.nickname,
            error: `${authorError}；已按东方财富主站登录态判定，若发布失败可能是该账号未开通财富号`,
          };
        }
        return {
          isAuthenticated: false,
          error: `${authorError}；主站接口同样未返回账号，请确认已在浏览器登录东方财富`,
        };
      } catch (error) {
        logger.debug("checkAuth: main site probe failed -", error);
        return {
          isAuthenticated: false,
          error: authorError || (error as Error).message,
        };
      }
    });
  }

  /**
   * 在鉴权请求头规则下执行
   *
   * 规则注入属于增强手段，失败时降级为普通请求，不能让整个检测直接报错；
   * 只回收本次新增的规则 id，避免与发布流程的规则互相清除。
   */
  private async withAuthHeaders<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.runtime.headerRules) return fn();

    const before = this.headerRuleIds.length;
    try {
      await this.addHeaderRules(this.AUTH_HEADER_RULES);
    } catch (error) {
      logger.warn("add auth header rules failed, continue without", error);
      return fn();
    }

    const created = this.headerRuleIds.slice(before);
    try {
      return await fn();
    } finally {
      this.headerRuleIds = this.headerRuleIds.filter(
        (id) => !created.includes(id),
      );
      for (const id of created) {
        try {
          await this.runtime.headerRules?.remove(id);
        } catch {
          // 规则可能已被其他流程清理
        }
      }
    }
  }

  /** 财富号作者信息 */
  private async fetchAuthorInfo(): Promise<AuthorInfoResponse> {
    const params = await this.buildCommonParams();
    const response = await this.runtime.fetch(
      `https://caifuhaoapi.eastmoney.com/api/v2/getauthorinfo?${params.toString()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { "x-requested-with": "fetch" },
      },
    );
    return (await response.json()) as AuthorInfoResponse;
  }

  /** 主站用户信息（JSONP 接口，判断 ct/ut 是否为有效登录凭据） */
  private async fetchMainSiteUser(): Promise<{
    userId?: string;
    nickname?: string;
  } | null> {
    const params = await this.buildCommonParams({
      callback: "ugaeo_cb",
      version: "200",
    });
    const response = await this.runtime.fetch(
      `https://gbapi.eastmoney.com/userinfo/api/user/UserInfo4jsonp?${params.toString()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { "x-requested-with": "fetch" },
      },
    );
    const text = await response.text();
    const jsonp = text.match(/^\s*[\w$.]+\(([\s\S]*)\)\s*;?\s*$/);
    const raw = jsonp ? jsonp[1] : text;

    let user: MainSiteUser;
    try {
      user = JSON.parse(raw) as MainSiteUser;
    } catch {
      throw new Error("主站用户接口返回内容无法解析");
    }

    if (!user.user_id) return null;
    return {
      userId: String(user.user_id),
      nickname: user.user_nickname || user.user_name || undefined,
    };
  }

  /** 与创作平台前端一致的公共参数（缺 product/plat 等字段时接口会直接回「未登录」） */
  private async buildCommonParams(
    extra: Record<string, string> = {},
  ): Promise<URLSearchParams> {
    return new URLSearchParams({
      platform: "",
      deviceid: await this.getDeviceId(),
      version: "100",
      plat: "web",
      product: "CFH",
      ctoken: this.ctoken,
      utoken: this.utoken,
      ...extra,
    });
  }

  /** 从 cookie 读取 token */
  private async fetchToken(): Promise<void> {
    const found: Record<string, string> = {};

    for (const target of COOKIE_TARGETS) {
      let cookies: Cookie[] = [];
      try {
        cookies = await this.runtime.cookies.get(target);
      } catch (error) {
        logger.debug(`read cookies from ${target} failed:`, error);
        continue;
      }
      for (const [key, names] of Object.entries(LOGIN_COOKIE_ALIASES)) {
        if (found[key]) continue;
        for (const name of names) {
          const value = pickBestCookie(cookies, name);
          if (value) {
            found[key] = value;
            break;
          }
        }
      }
      if (found.ct && found.ut) break;
    }

    // 老接口兼容：运行时若实现了单值读取，逐域名再兜一次
    if ((!found.ct || !found.ut) && this.runtime.getCookie) {
      for (const domain of [".eastmoney.com", "eastmoney.com", "mp.eastmoney.com"]) {
        for (const [key, names] of Object.entries(LOGIN_COOKIE_ALIASES)) {
          if (found[key]) continue;
          for (const name of names) {
            try {
              const value = await this.runtime.getCookie(domain, name);
              if (value) {
                found[key] = value;
                break;
              }
            } catch {
              // 忽略，继续尝试
            }
          }
        }
      }
    }

    if (!found.ct || !found.ut) {
      const missing = LOGIN_COOKIE_NAMES.filter((n) => !found[n]).join(" / ");
      const present = await this.describeEastmoneyCookies();
      throw new Error(
        `浏览器中没有找到东方财富登录 Cookie（缺少 ${missing}）。` +
          `该域下现有 Cookie：${present}。` +
          `请先在同一浏览器打开 https://mp.eastmoney.com 完成登录，再回到控制台点「重新检测」`,
      );
    }

    this.ctoken = found.ct;
    this.utoken = found.ut;
  }

  /** 诊断用：列出 eastmoney.com 域下现有的 Cookie 名（不含值） */
  private async describeEastmoneyCookies(): Promise<string> {
    try {
      const cookies = await this.runtime.cookies.get(".eastmoney.com");
      const names = Array.from(new Set(cookies.map((c) => c.name))).sort();
      if (names.length === 0) return "（空，说明当前浏览器从未访问过东方财富或处于无痕窗口）";
      const head = names.slice(0, 12).join(", ");
      return names.length > 12 ? `${head} 等 ${names.length} 个` : head;
    } catch {
      return "（读取失败）";
    }
  }

  async publish(
    article: Article,
    options?: PublishOptions,
  ): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      await this.fetchToken();
      logger.info("Starting publish to eastmoney...");

      // 1. 创建空草稿，获取 draft_id
      const draftId = await this.createDraft(article.title);
      logger.debug("Draft created:", draftId);

      // 2. 处理图片（基于预处理后的 HTML）
      const content = await this.processImages(
        article.html || "",
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ["gbres.dfcfw.com"],
          onProgress: options?.onImageProgress,
        },
      );

      // 3. 更新草稿内容
      await this.updateDraft(draftId, article.title, content);
      logger.debug("Draft updated");

      const draftUrl = `https://mp.eastmoney.com/collect/pc_article/index.html#/?id=${draftId}`;

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      });
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      }),
    );
  }

  /** 构造 API 参数 */
  private async buildParm(params: {
    draftid?: string;
    title: string;
    text: string;
  }): Promise<object[]> {
    const deviceid = await this.getDeviceId();
    return [
      { ip: "$IP$" },
      { deviceid },
      { version: "100" },
      { plat: "web" },
      { product: "CFH" },
      { ctoken: this.ctoken },
      { utoken: this.utoken },
      { draftid: params.draftid ?? "" },
      { drafttype: "0" },
      { type: "0" },
      { title: encodeURIComponent(params.title) },
      { text: encodeURIComponent(params.text) },
      { columns: "2" },
      { cover: "" },
      { issimplevideo: "0" },
      { videos: "" },
      { vods: "" },
      { isoriginal: "0" },
      { tgProduct: "" },
      { spcolumns: "" },
      { textsource: "0" },
      { replyauthority: "" },
      { modules: encodeURIComponent("[]") },
    ];
  }

  /** 调用草稿 API */
  private async callDraftApi(parm: object[], draftId?: string): Promise<DraftResult> {
    const pageUrl = draftId
      ? `https://mp.eastmoney.com/collect/pc_article/index.html#/?id=${draftId}`
      : "https://mp.eastmoney.com/collect/pc_article/index.html#/";

    const body = JSON.stringify({
      pageUrl,
      path: "draft/api/Article/SaveDraft",
      parm: JSON.stringify(parm),
    });

    const response = await this.runtime.fetch(
      "https://emfront.eastmoney.com/apifront/Tran/GetData?platform=",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );

    const responseText = await response.text();
    logger.debug(
      "Draft API response:",
      response.status,
      responseText.substring(0, 200),
    );

    if (!response.ok) {
      throw new Error(`草稿 API 请求失败: ${response.status}`);
    }

    let rawData: DraftApiResponse;
    try {
      rawData = JSON.parse(responseText);
    } catch {
      throw new Error("草稿 API 响应不是有效 JSON");
    }

    if (!rawData.RRquestSuccess || rawData.RCode !== 200) {
      throw new Error(`草稿 API 错误: ${rawData.RMsg || "未知错误"}`);
    }

    let innerData: DraftResult;
    try {
      innerData = JSON.parse(rawData.RData);
    } catch {
      throw new Error("无法解析草稿响应数据");
    }

    if (innerData.error_code !== 0) {
      throw new Error(`草稿业务错误: ${innerData.me || "未知错误"}`);
    }

    return innerData;
  }

  private async createDraft(title: string): Promise<string> {
    const parm = await this.buildParm({
      title,
      text: '<div class="xeditor_content cfh_web"></div>',
    });
    const result = await this.callDraftApi(parm);
    if (!result.draft_id) {
      throw new Error("创建草稿失败: 响应缺少 draft_id");
    }
    return result.draft_id;
  }

  private async updateDraft(
    draftId: string,
    title: string,
    content: string,
  ): Promise<void> {
    const parm = await this.buildParm({
      draftid: draftId,
      title,
      text: `<div class="xeditor_content cfh_web">${content}</div>`,
    });
    await this.callDraftApi(parm, draftId);
  }

  /** URL 上传图片 */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    // data URI 使用二进制上传
    if (src.startsWith("data:")) {
      logger.debug("Detected data URI, using binary upload");
      const blob = await this.dataUriToBlob(src);
      return this.uploadImageBlob(blob);
    }

    // 远程 URL 使用链接上传接口
    const response = await this.runtime.fetch(
      "https://gbapi.eastmoney.com/iimage/image/byLink?platform=",
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          noinlist: "1",
          linkUrl: src,
          ctoken: this.ctoken,
          utoken: this.utoken,
        }),
      },
    );

    const res = (await response.json()) as UploadResponse;
    if (res.code === 200 && res.data?.url) {
      return { url: res.data.url };
    }
    throw new Error(
      `图片上传失败: ${res.message || "未知错误"} (code: ${res.code})`,
    );
  }

  /** 上传图片 Blob */
  private async uploadImageBlob(file: Blob): Promise<ImageUploadResult> {
    const ext = file.type.split("/")[1] || "png";
    const filename = `${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append("file", file, filename);
    formData.append("noinlist", "1");
    formData.append("utoken", this.utoken);
    formData.append("ctoken", this.ctoken);

    const response = await this.runtime.fetch(
      "https://gbapi.eastmoney.com/iimage/image?platform=",
      {
        method: "POST",
        credentials: "include",
        body: formData,
      },
    );

    const res = (await response.json()) as UploadResponse;
    if (res.code === 200 && res.data?.url) {
      return { url: res.data.url };
    }
    throw new Error(
      `图片上传失败: ${res.message || "未知错误"} (code: ${res.code})`,
    );
  }
}
