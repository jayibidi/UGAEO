import { describe, expect, it } from 'vitest'
import { buildCookieQuery } from '../src/runtime/cookie-query'

describe('buildCookieQuery', () => {
  it('传 origin 时按 url 查询（能拿到父域 Cookie）', () => {
    expect(buildCookieQuery('https://mp.toutiao.com')).toEqual({
      url: 'https://mp.toutiao.com/',
    })
  })

  it('带路径的 URL 归一为 origin', () => {
    expect(buildCookieQuery('https://mp.toutiao.com/profile_v4/graphic/publish')).toEqual({
      url: 'https://mp.toutiao.com/',
    })
  })

  it('传域名时按 domain 查询，去掉前导点', () => {
    expect(buildCookieQuery('.yuque.com')).toEqual({ domain: 'yuque.com' })
    expect(buildCookieQuery('yuque.com')).toEqual({ domain: 'yuque.com' })
  })

  it('带 name 时一并带上', () => {
    expect(buildCookieQuery('yuque.com', 'yuque_ctoken')).toEqual({
      domain: 'yuque.com',
      name: 'yuque_ctoken',
    })
  })

  it('域名里的脏字符被清理', () => {
    expect(buildCookieQuery('.bilibili.com/')).toEqual({ domain: 'bilibili.com' })
  })

  it('空字符串不崩', () => {
    expect(buildCookieQuery('')).toEqual({ domain: '' })
  })
})
