import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchLinkText, htmlToText, isBlockedHost, isHttpUrl, LINK_TEXT_LIMIT } from '../companion/link-fetch.mjs'

const publicResolve = async () => '93.184.216.34'

/** 造一个最小的 Response 替身。 */
function fakeResponse(body, { status = 200, type = 'text/html; charset=utf-8' } = {}) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
    arrayBuffer: async () => bytes.buffer,
  }
}

test('只有「整段就是一个 http(s) 链接」才算链接', () => {
  assert.equal(isHttpUrl('https://example.com/a?b=1'), true)
  assert.equal(isHttpUrl('  http://example.com  '), true)
  assert.equal(isHttpUrl('看这个 https://example.com'), false)
  assert.equal(isHttpUrl('https://example.com 和 https://b.com'), false)
  assert.equal(isHttpUrl('www.example.com'), false)
  assert.equal(isHttpUrl('ftp://example.com'), false)
  assert.equal(isHttpUrl(''), false)
})

test('本机与内网地址不抓', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.2', '172.20.0.1', '169.254.1.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', 'printer.local']) {
    assert.equal(isBlockedHost(host), true, host)
  }
  for (const host of ['example.com', '93.184.216.34', '8.8.8.8']) {
    assert.equal(isBlockedHost(host), false, host)
  }
})

test('HTML 压成正文：去脚本样式、保留列表与段落、解码实体', () => {
  const html = `
    <html><head><style>.a{color:red}</style><script>var x = 1 < 2</script></head>
    <body>
      <h1>标题 &amp; 副标题</h1>
      <p>第一段&nbsp;文字。</p>
      <ul><li>条目一</li><li>条目二</li></ul>
      <div>结尾 &lt;b&gt;</div>
    </body></html>`
  const text = htmlToText(html)
  assert.match(text, /标题 & 副标题/)
  assert.match(text, /第一段 文字。/)
  assert.match(text, /- 条目一/)
  assert.match(text, /- 条目二/)
  assert.match(text, /结尾 <b>/)
  assert.doesNotMatch(text, /color:red|var x/)
})

test('抓取成功：返回正文并保留换行', async () => {
  const result = await fetchLinkText('https://example.com/post', {
    resolve: publicResolve,
    fetchImpl: async () => fakeResponse('<h2>要点</h2><p>正文一。</p><p>正文二。</p>'),
  })
  assert.equal(result.ok, true)
  assert.match(result.text, /要点/)
  assert.match(result.text, /正文一。/)
  assert.match(result.text, /正文二。/)
})

test('正文超长会被截断到上限', async () => {
  const long = '<p>' + '字'.repeat(LINK_TEXT_LIMIT * 2) + '</p>'
  const result = await fetchLinkText('https://example.com/long', {
    resolve: publicResolve,
    fetchImpl: async () => fakeResponse(long),
  })
  assert.equal(result.ok, true)
  assert.equal(result.text.length, LINK_TEXT_LIMIT)
})

test('非 2xx / 非文本 / 空正文 都安静降级', async () => {
  const notFound = await fetchLinkText('https://example.com/404', {
    resolve: publicResolve,
    fetchImpl: async () => fakeResponse('nope', { status: 404 }),
  })
  assert.equal(notFound.ok, false)
  assert.equal(notFound.reason, 'http-404')

  const pdf = await fetchLinkText('https://example.com/a.pdf', {
    resolve: publicResolve,
    fetchImpl: async () => fakeResponse('%PDF', { type: 'application/pdf' }),
  })
  assert.equal(pdf.ok, false)
  assert.equal(pdf.reason, 'unsupported-type')

  const empty = await fetchLinkText('https://example.com/blank', {
    resolve: publicResolve,
    fetchImpl: async () => fakeResponse('<script>only()</script>'),
  })
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'empty')
})

test('内网链接在发起请求之前就被拒绝', async () => {
  let called = false
  const result = await fetchLinkText('http://127.0.0.1:8080/admin', {
    fetchImpl: async () => {
      called = true
      return fakeResponse('secret')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'blocked-host')
  assert.equal(called, false)
})

test('域名解析到内网也拒绝（防 rebinding）', async () => {
  const result = await fetchLinkText('https://evil.example.com', {
    resolve: async () => '192.168.0.10',
    fetchImpl: async () => fakeResponse('secret'),
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'blocked-host')
})

test('网络异常与超时都映射成可读原因', async () => {
  const network = await fetchLinkText('https://example.com', {
    resolve: publicResolve,
    fetchImpl: async () => {
      throw new Error('boom')
    },
  })
  assert.equal(network.ok, false)
  assert.equal(network.reason, 'network')

  const timeout = await fetchLinkText('https://example.com', {
    resolve: publicResolve,
    timeoutMs: 30,
    fetchImpl: async (_url, options) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500)
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
      return fakeResponse('late')
    },
  })
  assert.equal(timeout.ok, false)
  assert.equal(timeout.reason, 'timeout')
})
