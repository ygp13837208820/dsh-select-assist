import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeEntities, formatSearchContext, parseBingRss, relevantTo, searchWeb, stripTags } from '../companion/search-web.mjs'

/**
 * 这几条钉住「AI 搜索」的取数边界：
 * - RSS 解析要能处理实体、CDATA 与 HTML 片段；
 * - 必应偶尔返回空 channel，必须重试到有结果为止；
 * - 取不到结果时也要给模型一段明确的"没搜到"，而不是一段空白。
 */

const RSS = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel>
<title>必应：测试</title>
<item><title>量子纠缠 &amp; 贝尔不等式</title><link>https://example.com/a</link>
<description>&lt;p&gt;用&lt;b&gt;通俗&lt;/b&gt;的方式解释量子纠缠。&lt;/p&gt;</description></item>
<item><title><![CDATA[第二篇 <文章>]]></title><link>https://example.com/b</link><description>摘要二</description></item>
</channel></rss>`

test('解析 RSS：标题/链接/摘要，实体与标签都处理干净', () => {
  const items = parseBingRss(RSS)
  assert.equal(items.length, 2)
  assert.equal(items[0].title, '量子纠缠 & 贝尔不等式')
  assert.equal(items[0].url, 'https://example.com/a')
  assert.equal(items[0].snippet, '用 通俗 的方式解释量子纠缠。')
  assert.equal(items[1].title, '第二篇 <文章>')
})

test('实体与标签的小工具', () => {
  assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x4e2d;'), "a & b 'c' 中")
  assert.equal(stripTags('<p>你好<strong>世界</strong></p>'), '你好 世界')
})

test('空结果也给模型一段明确说明', () => {
  const text = formatSearchContext({ ok: false, items: [] })
  assert.match(text, /没有取到网络搜索结果/)
  const ok = formatSearchContext({ ok: true, items: [{ title: 'T', url: 'https://e.com', snippet: 'S' }] })
  assert.match(ok, /\[1\] T/)
  assert.match(ok, /https:\/\/e\.com/)
})

test('必应返回空 channel 时会重试，成功即返回', async () => {
  let calls = 0
  const fetchFn = async () => {
    calls += 1
    return {
      ok: true,
      text: async () => (calls === 1 ? '<rss><channel></channel></rss>' : RSS),
    }
  }
  const result = await searchWeb('量子纠缠', { fetchFn })
  assert.equal(result.ok, true)
  assert.equal(result.items.length, 2)
  assert.equal(calls, 2, '第一次空结果应当继续试下一个地址')
})

test('全部失败时安静返回原因（不抛）', async () => {
  const result = await searchWeb('量子纠缠', {
    fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.items.length, 0)
  assert.match(result.reason, /http-503/)
})

test('空查询不联网', async () => {
  let called = false
  const result = await searchWeb('   ', { fetchFn: async () => { called = true } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'empty-query')
  assert.equal(called, false)
})

const JUNK = `<rss><channel><item><title>豆包电脑版怎么设置快捷键</title><link>https://example.com/x</link><description>百度经验</description></item></channel></rss>`

test('返回一整页无关内容时判成没搜到（不拿它去喂模型）', async () => {
  const result = await searchWeb('量子纠缠', { fetchFn: async () => ({ ok: true, text: async () => JUNK }) })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'irrelevant')
})

test('第一次无关、第二次有关时继续重试', async () => {
  let calls = 0
  const result = await searchWeb('量子纠缠', {
    fetchFn: async () => {
      calls += 1
      return { ok: true, text: async () => (calls === 1 ? JUNK : RSS) }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
  assert.equal(relevantTo('量子纠缠', result.items), true)
})
