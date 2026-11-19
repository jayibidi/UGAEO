/**
 * 各平台的本地图标（自动生成，勿手改）
 *
 * 由 scripts/fetch-platform-icons.mjs 抓取，放在 public/platform-icons 下。
 * 远程 favicon 有防盗链和 302 到 HTML 的坑，所以统一打包到本地，
 * 打包后通过 chrome.runtime.getURL 取，离线也能显示。
 */
export const PLATFORM_ICON_FILES: Record<string, string> = {
  '51cto': '51cto.png',
  'bafang': 'bafang.ico',
  'baiduzhidao': 'baiduzhidao.ico',
  'baijiahao': 'baijiahao.ico',
  'bilibili': 'bilibili.ico',
  'cnblogs': 'cnblogs.ico',
  'csdn': 'csdn.ico',
  'douban': 'douban.ico',
  'eastmoney': 'eastmoney.ico',
  'huangye88': 'huangye88.ico',
  'huxiu': 'huxiu.png',
  'imooc': 'imooc.ico',
  'infoq': 'infoq.png',
  'ithome': 'ithome.png',
  'jianshu': 'jianshu.ico',
  'jiemian': 'jiemian.ico',
  'juejin': 'juejin.png',
  'kuaidong': 'kuaidong.png',
  'netease': 'netease.ico',
  'oschina': 'oschina.ico',
  'segmentfault': 'segmentfault.jpg',
  'shunqi': 'shunqi.ico',
  'smzdm': 'smzdm.ico',
  'sohu': 'sohu.ico',
  'tencent-om': 'tencent-om.png',
  'toutiao': 'toutiao.png',
  'weibo': 'weibo.ico',
  'weixin': 'weixin.png',
  'woshipm': 'woshipm.ico',
  'xiaohongshu': 'xiaohongshu.ico',
  'xueqiu': 'xueqiu.ico',
  'yuque': 'yuque.png',
  'zhihu': 'zhihu.ico',
}

/** 取某个平台的本地图标地址；没有打包的返回 undefined，交给调用方兜底 */
export function localPlatformIcon(platformId?: string): string | undefined {
  if (!platformId) return undefined
  const file = PLATFORM_ICON_FILES[platformId]
  if (!file) return undefined
  try {
    return chrome.runtime.getURL(`platform-icons/${file}`)
  } catch {
    return `/platform-icons/${file}`
  }
}
