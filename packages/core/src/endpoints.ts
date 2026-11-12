/**
 * 对外地址的唯一真源
 *
 * 为什么单独抽一个文件：这些地址原来散落在 6 个地方（AI 客户端、内容脚本白名单、
 * 远程配置、版本检查、更新提示、分享文案），改域名要 grep 全仓，漏一个就是线上 404
 * 或者「白名单没放行导致接口静默失败」。
 *
 * 约定：
 * - 业务请求只走 API_ORIGIN 下的路径，不引第三方 CDN
 * - 仓库/发布地址用于「检查更新」「问题反馈」，与产品域名分开维护
 */

/** 产品服务端根地址（写死，不读环境变量：扩展分发出去后没有构建期注入的机会） */
export const API_ORIGIN = 'https://api.ugooto-ai.com'

/** OpenAI 兼容中转站（含 /v1） */
export const AI_BASE_URL = `${API_ORIGIN}/v1`

/** Web 控制台 */
export const CONSOLE_URL = `${API_ORIGIN}/console`

/** 远程公告配置 */
export const REMOTE_CONFIG_URL = `${API_ORIGIN}/config.json`

/** 版本检查清单 */
export const VERSION_CHECK_URL = `${API_ORIGIN}/version.json`

/** 代码仓库与发布页 */
export const REPO_URL = 'https://github.com/jayibidi/UGAEO'
export const RELEASES_URL = `${REPO_URL}/releases/latest`
export const ISSUES_URL = `${REPO_URL}/issues`
