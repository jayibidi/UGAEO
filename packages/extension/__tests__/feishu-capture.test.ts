import { describe, expect, it } from 'vitest'
import {
  FEISHU_CAPTURE_TTL,
  FEISHU_HOME_FALLBACK,
  describeCaptureResult,
  feishuOriginOf,
  isCaptureActive,
  isFeishuDocUrl,
  isFeishuHost,
  pickFeishuHomeUrl,
} from '../src/lib/feishu-capture'

describe('飞书域名识别', () => {
  it('认企业租户域、公共站与 Lark', () => {
    expect(isFeishuHost('acme.feishu.cn')).toBe(true)
    expect(isFeishuHost('feishu.cn')).toBe(true)
    expect(isFeishuHost('www.feishu.cn')).toBe(true)
    expect(isFeishuHost('acme.larksuite.com')).toBe(true)
  })

  it('不把别的域名误判成飞书', () => {
    expect(isFeishuHost('notfeishu.cn')).toBe(false)
    expect(isFeishuHost('feishu.cn.evil.com')).toBe(false)
    expect(isFeishuHost('yuque.com')).toBe(false)
    expect(isFeishuHost('')).toBe(false)
  })
})

describe('飞书文档地址判定', () => {
  it('认文档 / 知识库 / 思维笔记', () => {
    expect(isFeishuDocUrl('https://acme.feishu.cn/docx/AbCdEf123')).toBe(true)
    expect(isFeishuDocUrl('https://acme.feishu.cn/docs/AbCdEf123')).toBe(true)
    expect(isFeishuDocUrl('https://acme.feishu.cn/wiki/Wk123456')).toBe(true)
    expect(isFeishuDocUrl('https://acme.feishu.cn/mindnotes/Mn123')).toBe(true)
  })

  it('云文档首页 / 搜索页 / 登录页不算文档', () => {
    expect(isFeishuDocUrl('https://acme.feishu.cn/drive/home/')).toBe(false)
    expect(isFeishuDocUrl('https://acme.feishu.cn/search?q=x')).toBe(false)
    expect(isFeishuDocUrl('https://acme.feishu.cn/accounts/page/login')).toBe(false)
    expect(isFeishuDocUrl('https://acme.feishu.cn/docx')).toBe(false)
  })

  it('表格类不做转换（结构对不上图文）', () => {
    expect(isFeishuDocUrl('https://acme.feishu.cn/sheets/Sht123')).toBe(false)
    expect(isFeishuDocUrl('https://acme.feishu.cn/base/Basc123')).toBe(false)
  })

  it('非飞书地址一律拒绝', () => {
    expect(isFeishuDocUrl('https://example.com/docx/abc')).toBe(false)
    expect(isFeishuDocUrl('')).toBe(false)
    expect(isFeishuDocUrl('不是网址')).toBe(false)
  })
})

describe('打开哪个云文档主页', () => {
  it('优先复用用户已登录的租户域', () => {
    const url = pickFeishuHomeUrl(['https://acme.feishu.cn/docx/abc', 'https://example.com'])
    expect(url).toBe('https://acme.feishu.cn/drive/home/')
  })

  it('只有公共站时退回公共入口（公共站不带登录态）', () => {
    expect(pickFeishuHomeUrl(['https://www.feishu.cn/'])).toBe(FEISHU_HOME_FALLBACK)
  })

  it('没有任何飞书标签页时用公共入口', () => {
    expect(pickFeishuHomeUrl([])).toBe(FEISHU_HOME_FALLBACK)
    expect(pickFeishuHomeUrl([undefined, 'https://github.com'])).toBe(FEISHU_HOME_FALLBACK)
  })

  it('feishuOriginOf 只对租户域返回 origin', () => {
    expect(feishuOriginOf('https://acme.feishu.cn/docx/abc?from=x')).toBe('https://acme.feishu.cn')
    expect(feishuOriginOf('https://www.feishu.cn/docx/abc')).toBeNull()
    expect(feishuOriginOf('https://example.com')).toBeNull()
  })
})

describe('捕获窗口', () => {
  const now = 1_000_000

  it('等待中且未过期才算有效', () => {
    expect(isCaptureActive({ status: 'waiting', until: now + 1000, homeUrl: 'x' }, now)).toBe(true)
    expect(isCaptureActive({ status: 'waiting', until: now - 1, homeUrl: 'x' }, now)).toBe(false)
  })

  it('完成 / 失败 / 空闲都不再触发提取', () => {
    expect(isCaptureActive({ status: 'done', until: now + 9999, title: 't', images: 1 }, now)).toBe(false)
    expect(isCaptureActive({ status: 'failed', until: now + 9999, error: 'e' }, now)).toBe(false)
    expect(isCaptureActive({ status: 'idle' }, now)).toBe(false)
    expect(isCaptureActive(undefined, now)).toBe(false)
  })

  it('有效期覆盖用户在飞书里找文档的时间', () => {
    expect(FEISHU_CAPTURE_TTL).toBeGreaterThanOrEqual(10 * 60 * 1000)
  })
})

describe('结果文案', () => {
  it('有图时说明图片数量，没图时如实说没有', () => {
    expect(describeCaptureResult('测试稿', 3)).toContain('3 张图片')
    expect(describeCaptureResult('测试稿', 0)).toContain('没有图片')
  })

  it('长标题截断', () => {
    const long = '一'.repeat(60)
    const text = describeCaptureResult(long, 1)
    expect(text.length).toBeLessThan(60)
    expect(text).toContain('…')
  })
})
