/**
 * 「AI 搜索」的取数：把划中的文字当查询词，去必应 RSS 拿前几条结果。
 *
 * 为什么用必应的 RSS 而不是打开浏览器：
 * - 伴生进程运行在宿主沙箱里，`spawn` 任何 Chromium 系浏览器都会被拦（实测 ego lite
 *   直接以 crashpad `OpenProcess: 拒绝访问` 自杀，Edge 也一样），所以"点搜索 → 打开浏览器"
 *   这条路在本机是**走不通**的，用户看到的就是"点了没反应"；
 * - 浏览器还要求用户切窗口，而划词的要义是"不离开当前上下文"。
 *
 * RSS 是纯文本、结构稳定（`<item>` 里 `title` / `link` / `description`），不需要解析
 * 搜索结果页的 DOM，也不会因为页面改版而失效。必应对同一查询会间歇性返回空列表
 * （实测 4 次里 2 次 0 条），所以这里做**多次重试**，并且在主站/中国站之间轮换。
 */

/** 单次请求的超时（毫秒）。 */
const ATTEMPT_TIMEOUT_MS = 6000
/** 最多取几条结果。 */
const MAX_ITEMS = 6
/** 摘要截断长度（字符）。 */
const MAX_SNIPPET = 280
/** 拼给模型的上下文总长上限（字符）。 */
const MAX_CONTEXT = 2600

/**
 * 候选地址：必应主站与中国站各试一次，再回主站补一次（RSS 偶尔返回空 channel）。
 * @param {string} query - 已编码的查询词。
 * @returns {string[]} 依次尝试的 URL。
 */
function candidateUrls(query) {
  const q = encodeURIComponent(query)
  return [
    `https://www.bing.com/search?q=${q}&format=rss&count=${MAX_ITEMS}`,
    `https://cn.bing.com/search?q=${q}&format=rss&count=${MAX_ITEMS}`,
    `https://www.bing.com/search?q=${q}&format=rss&count=${MAX_ITEMS}&setlang=zh-CN`,
  ]
}

/** 解码 XML/HTML 实体（RSS 里的标题与摘要都带实体）。 */
export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gi, '&')
}

/** 去掉 HTML 标签与多余空白。 */
export function stripTags(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 清洗一个 RSS 字段。
 *
 * 顺序有讲究：CDATA 里的字面尖括号先"寄存"起来，再解码实体让 `&lt;p&gt;` 现出原形，
 * 然后才剥标签，最后把 CDATA 的内容放回去——反过来做会把 CDATA 里的 `<文章>` 当成标签剥掉。
 * @param {string} value - 原始字段。
 * @returns {string} 纯文本。
 */
function cleanText(value) {
  const cdata = []
  const guarded = String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => {
    cdata.push(String(body))
    return '\u0000' + (cdata.length - 1) + '\u0000'
  })
  const stripped = stripTags(decodeEntities(guarded))
  return stripped.replace(/\u0000(\d+)\u0000/g, (_, index) => cdata[Number(index)] ?? '')
}

/** 取一个 `<name>…</name>` 字段（RSS 是扁平结构，够用）；返回**未解码**的原文。 */
function field(block, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return match === null ? '' : match[1]
}

/**
 * 解析必应 RSS。
 * @param {string} xml - RSS 原文。
 * @returns {{title: string, url: string, snippet: string}[]} 结果（顺序即排序）。
 */
export function parseBingRss(xml) {
  const items = []
  const blocks = String(xml ?? '').match(/<item>[\s\S]*?<\/item>/gi) ?? []
  for (const block of blocks) {
    const title = cleanText(field(block, 'title'))
    const url = cleanText(field(block, 'link'))
    const snippet = cleanText(field(block, 'description')).slice(0, MAX_SNIPPET)
    if (title === '' && url === '') continue
    items.push({ title, url, snippet })
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

/**
 * 结果和查询词对得上吗？
 *
 * 必应偶尔会回一整页与查询**毫无关系**的内容（实测连查几次"量子纠缠"之后，返回的
 * 全是豆包/微信的推广页）。这种结果交给模型比"没搜到"更糟：模型会硬着头皮总结一堆
 * 无关文字。所以宁可判成空，让提示词里的"信息不足"分支接住。
 *
 * 中文按二字片段比（「量子纠缠」→ 量子/子纠/纠缠…），英文按 ≥3 字符的单词比。
 * @param {string} query - 查询词。
 * @param {Array<{title: string, snippet: string}>} items - 结果。
 * @returns {boolean} 至少一个片段在标题或摘要里出现。
 */
export function relevantTo(query, items) {
  const text = String(query ?? '').replace(/\s+/g, '')
  if (text === '' || items.length === 0) return false
  const tokens = []
  if (/[\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) {
    for (let i = 0; i + 2 <= text.length && tokens.length < 12; i += 2) tokens.push(text.slice(i, i + 2))
    if (tokens.length === 0) tokens.push(text)
  } else {
    for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length >= 3) tokens.push(word)
    }
  }
  if (tokens.length === 0) return true
  const haystack = items.map((item) => String(item.title ?? '') + ' ' + String(item.snippet ?? '')).join(' ').toLowerCase()
  return tokens.some((token) => haystack.includes(token.toLowerCase()))
}

/**
 * 用必应 RSS 搜一次。
 * @param {string} query - 查询词（划中的文字）。
 * @param {{fetchFn?: typeof fetch, timeoutMs?: number}} [options] - 测试可注入。
 * @returns {Promise<{ok: boolean, items: Array<{title: string, url: string, snippet: string}>, reason?: string}>}
 */
export async function searchWeb(query, options = {}) {
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : ATTEMPT_TIMEOUT_MS
  const text = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (text === '') return { ok: false, items: [], reason: 'empty-query' }
  let lastReason = 'no-result'
  for (const url of candidateUrls(text)) {
    try {
      const response = await fetchFn(url, {
        headers: {
          // 不带 UA 的话必应有时直接回一个空 channel。
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        lastReason = 'http-' + response.status
        continue
      }
      const xml = await response.text()
      const items = parseBingRss(xml)
      if (items.length > 0) {
        if (relevantTo(text, items)) return { ok: true, items }
        // 拿到的是一整页无关内容（见 relevantTo）：换下一个地址再试。
        lastReason = 'irrelevant'
        continue
      }
      lastReason = 'empty'
    } catch (error) {
      lastReason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
    }
  }
  return { ok: false, items: [], reason: lastReason }
}

/**
 * 把结果拼成交给模型的上下文（`{{context}}`）。
 *
 * 搜索为空时也给一段说明：提示词里"下面是搜索结果"那一句才不会让模型以为有结果。
 * @param {{ok: boolean, items: Array<{title: string, url: string, snippet: string}>, reason?: string}} result
 * @returns {string} 上下文文本。
 */
export function formatSearchContext(result) {
  if (result === null || result === undefined || !Array.isArray(result.items) || result.items.length === 0) {
    return '（这次没有取到网络搜索结果，请基于你已有的知识回答，并说明信息可能不是最新的。）'
  }
  const parts = []
  let used = 0
  for (let index = 0; index < result.items.length; index += 1) {
    const item = result.items[index]
    const block = [`[${index + 1}] ${item.title}`, item.url, item.snippet].filter((line) => line !== '').join('\n')
    if (used + block.length > MAX_CONTEXT) break
    parts.push(block)
    used += block.length + 2
  }
  return parts.join('\n\n')
}
