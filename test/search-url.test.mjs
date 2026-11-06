import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSearchUrl, DEFAULT_SEARCH_URL, normalizeSearchUrl } from '../companion/search-url.mjs'

test('默认是秘塔', () => {
  assert.equal(DEFAULT_SEARCH_URL, 'https://metaso.cn/?q=%s')
  assert.equal(normalizeSearchUrl(undefined), DEFAULT_SEARCH_URL)
  assert.equal(normalizeSearchUrl(''), DEFAULT_SEARCH_URL)
})

test('合法模板原样保留（允许别家搜索引擎）', () => {
  assert.equal(normalizeSearchUrl('https://www.bing.com/search?q=%s'), 'https://www.bing.com/search?q=%s')
  assert.equal(normalizeSearchUrl('https://www.google.com/search?q=%s&hl=zh-CN'), 'https://www.google.com/search?q=%s&hl=zh-CN')
  assert.equal(normalizeSearchUrl('https://kagi.com/search?q=%s'), 'https://kagi.com/search?q=%s')
})

test('缺 %s 或不是 http(s) 一律退回默认', () => {
  assert.equal(normalizeSearchUrl('https://metaso.cn/'), DEFAULT_SEARCH_URL)
  assert.equal(normalizeSearchUrl('file:///C:/x?q=%s'), DEFAULT_SEARCH_URL)
  assert.equal(normalizeSearchUrl('javascript:alert(1)//%s'), DEFAULT_SEARCH_URL)
  assert.equal(normalizeSearchUrl('metaso.cn/?q=%s'), DEFAULT_SEARCH_URL)
})

test('查询词会被 URL 编码，中文与空格都安全', () => {
  assert.equal(buildSearchUrl(DEFAULT_SEARCH_URL, '你好 世界'), 'https://metaso.cn/?q=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C')
  assert.equal(buildSearchUrl(DEFAULT_SEARCH_URL, 'a&b=c'), 'https://metaso.cn/?q=a%26b%3Dc')
})

test('查询词折叠空白并截断到 200 字', () => {
  const url = buildSearchUrl(DEFAULT_SEARCH_URL, '  a   b\n c  ')
  assert.match(url, /q=a%20b%20c$/)
  const long = buildSearchUrl(DEFAULT_SEARCH_URL, 'x'.repeat(500))
  assert.equal(decodeURIComponent(long.split('q=')[1]).length, 200)
})

test('只替换第一个 %s，第二个原样保留', () => {
  const url = buildSearchUrl('https://example.com/s?q=%s&ref=%s', 'hi')
  assert.equal(url, 'https://example.com/s?q=hi&ref=%s')
})
