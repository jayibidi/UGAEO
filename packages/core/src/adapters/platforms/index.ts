/**
 * 平台适配器导出 (公开)
 * 私有适配器位于 private/ 子目录，通过 import.meta.glob 动态加载
 */
import type { PlatformAdapter } from '../types'

import { DoubanAdapter } from './douban'
import { XueqiuAdapter } from './xueqiu'
import { SohuAdapter } from './sohu'
import { WoshipmAdapter } from './woshipm'
import { ZhihuAdapter } from './zhihu'
import { JuejinAdapter } from './juejin'
import { CSDNAdapter } from './csdn'
import { WeiboAdapter } from './weibo'
import { BilibiliAdapter } from './bilibili'
import { BaijiahaoAdapter } from './baijiahao'
import { YuqueAdapter } from './yuque'
import { WeixinAdapter } from './weixin'
import { Cto51Adapter } from './cto51'
import { ImoocAdapter } from './imooc'
import { OschinaAdapter } from './oschina'
import { SegmentfaultAdapter } from './segmentfault'
import { CnblogsAdapter } from './cnblogs'
import { ZipDownloadAdapter } from './zip-download'
import { EastmoneyAdapter } from './eastmoney'
import { ToutiaoAdapter } from './toutiao'
import { XiaohongshuAdapter } from './xiaohongshu'
import { NeteaseAdapter, TencentOmAdapter, Kr36Adapter, HuxiuAdapter, JiemianAdapter } from './news-portals'
import { JianshuAdapter, SmzdmAdapter, BaiduZhidaoAdapter } from './content-communities'
import { ShunqiAdapter, BafangAdapter, Huangye88Adapter } from './b2b-directory'
import { IthomeAdapter, InfoqAdapter, KuaidongAdapter } from './submission-draft'

export {
  DoubanAdapter,
  XueqiuAdapter,
  SohuAdapter,
  WoshipmAdapter,
  ZhihuAdapter,
  JuejinAdapter,
  CSDNAdapter,
  WeiboAdapter,
  BilibiliAdapter,
  BaijiahaoAdapter,
  YuqueAdapter,
  WeixinAdapter,
  Cto51Adapter,
  ImoocAdapter,
  OschinaAdapter,
  SegmentfaultAdapter,
  CnblogsAdapter,
  ZipDownloadAdapter,
  EastmoneyAdapter,
  ToutiaoAdapter,
  XiaohongshuAdapter,
  NeteaseAdapter,
  TencentOmAdapter,
  Kr36Adapter,
  HuxiuAdapter,
  JiemianAdapter,
  JianshuAdapter,
  SmzdmAdapter,
  BaiduZhidaoAdapter,
  ShunqiAdapter,
  BafangAdapter,
  Huangye88Adapter,
  IthomeAdapter,
  InfoqAdapter,
  KuaidongAdapter,
}

/** 适配器构造器（无参 new 出 meta 与默认配置） */
export type AdapterConstructor = new () => PlatformAdapter

/**
 * 内置适配器清单
 *
 * 唯一真源：扩展注册、一致性测试、自检面板都从这里取，
 * 避免「加了适配器忘了注册」「测试只覆盖一半平台」这类隐性漏测。
 */
export const BUILT_IN_ADAPTERS: AdapterConstructor[] = [
  ZhihuAdapter,
  JuejinAdapter,
  WeiboAdapter,
  BilibiliAdapter,
  BaijiahaoAdapter,
  CSDNAdapter,
  YuqueAdapter,
  DoubanAdapter,
  SohuAdapter,
  XueqiuAdapter,
  WeixinAdapter,
  WoshipmAdapter,
  Cto51Adapter,
  ImoocAdapter,
  OschinaAdapter,
  SegmentfaultAdapter,
  CnblogsAdapter,
  ZipDownloadAdapter,
  EastmoneyAdapter,
  ToutiaoAdapter,
  XiaohongshuAdapter,
  NeteaseAdapter,
  TencentOmAdapter,
  Kr36Adapter,
  HuxiuAdapter,
  JiemianAdapter,
  JianshuAdapter,
  SmzdmAdapter,
  BaiduZhidaoAdapter,
  ShunqiAdapter,
  BafangAdapter,
  Huangye88Adapter,
  IthomeAdapter,
  InfoqAdapter,
  KuaidongAdapter,
]
