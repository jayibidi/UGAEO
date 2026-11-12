/**
 * Cookie 查询条件构造
 *
 * `chrome.cookies.getAll` 的 `domain` 参数只接受**纯域名**（如 `toutiao.com`），
 * 传 URL / origin（如 `https://mp.toutiao.com`）会匹配不到任何 Cookie，
 * 因为它会拿整串去和 Cookie 的 domain 字段比对。
 *
 * 早期实现把 origin 直接塞进 domain 过滤，导致头条号、小红书这类「页面驱动」
 * 平台登录后依然显示「未登录」—— `sessionid` 实际存在 `.toutiao.com` 上，
 * 而按 origin 当 domain 查是查不到的。
 *
 * 这里统一成两种语义：
 * - 传 URL / origin：按 `url` 查询，返回**会发送到该地址的全部 Cookie**，
 *   包含父域（`.toutiao.com`）上的登录态，这是最符合直觉的行为
 * - 传域名：按 `domain` 查询，去掉前导点，包含其子域
 */
export interface CookieQuery {
  url?: string
  domain?: string
  name?: string
}

export function buildCookieQuery(target: string, name?: string): CookieQuery {
  const value = (target || '').trim()
  const query: CookieQuery = {}

  if (/^https?:\/\//i.test(value)) {
    // 只保留 origin：带路径会让个别浏览器版本匹配失败
    try {
      query.url = new URL(value).origin + '/'
    } catch {
      query.url = value
    }
  } else {
    // 去掉前导点与尾部斜杠，避免 `.yuque.com` 这类写法被当成非法域名
    query.domain = value.replace(/^\.+/, '').replace(/\/+$/, '')
  }

  if (name) query.name = name
  return query
}
