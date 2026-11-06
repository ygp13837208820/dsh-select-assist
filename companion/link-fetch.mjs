/**
 * 链接抓取：选中一段文本如果**整段就是一个 http(s) 链接**，就把它抓下来当上下文。
 *
 * 为什么要这一步：自定义技能的提示词是直接发给模型的，模型看不到网页内容——
 * 它只能看到 URL 字符串。想让「链接速读」这类技能真的读到正文，必须在本地把页面取回来。
 *
 * 约束（都是刻意的）：
 * - 只接受 http/https，且**拒绝本机/内网地址**（避免用户无意中让外部内容驱动本机服务）；
 * - 超时 8s、正文上限 4000 字符（与宿主侧 MAX_CONTEXT_LENGTH 对齐）、只取 html/text；
 * - 任何失败都安静降级为「没有正文」，由提示词里的「为空就说明读不到」兜底。
 */
import { lookup } from 'node:dns/promises'

/** 链接正文上限：与 src/shared/protocol.ts 的 MAX_CONTEXT_LENGTH 一致，超过会被宿主再截一次。 */
export const LINK_TEXT_LIMIT = 4000
/** 抓取超时（毫秒）。 */
export const LINK_TIMEOUT_MS = 8000
/** 下载上限（字节）：只看正文，不需要整站资源。 */
export const LINK_BYTES_LIMIT = 2 * 1024 * 1024

/**
 * 整段文本是不是一个 http(s) 链接。
 * 前后空白忽略；中间有空格或换行就不算（那是「一段话里包含链接」，不是「选中了链接」）。
 * @param {string} text - 选中的文字。
 * @returns {boolean} 是否是一个独立链接。
 */
export function isHttpUrl(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value === '' || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 拒绝本机、内网、链路本地地址（含 IPv6 回环）。
 * @param {string} hostname - `new URL(...).hostname`。
 * @returns {boolean} true = 不允许抓取。
 */
export function isBlockedHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '' ) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host === '::1' || host === '0.0.0.0') return true
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4 !== null) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
  }
  // IPv6 的私有/链路本地前缀
  if (/^(fc|fd|fe80)/i.test(host)) return true
  return false
}

/**
 * 把 HTML 压成可读正文。
 *
 * 不装解析器：只做「去掉不可见内容 → 块级标签转换行 → 去标签 → 折叠空白」。
 * 对新闻页、文档页、博客足够；对纯 JS 渲染的 SPA 会拿不到正文，这是已知限制。
 * @param {string} html - 原始 HTML。
 * @returns {string} 正文（可能为空串）。
 */
export function htmlToText(html) {
  let text = String(html ?? '')
  text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  text = text.replace(/<(script|style|noscript|template|svg|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
  text = text.replace(/<li\b[^>]*>/gi, '- ')
  text = text.replace(/<[^>]+>/g, ' ')
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .trim()
}

/**
 * 抓一个链接并返回可读正文。
 * @param {string} url - 链接。
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, limit?: number, resolve?: (host: string) => Promise<string> }} [options]
 *   可注入的依赖（测试用）。
 * @returns {Promise<{ ok: boolean, text: string, reason?: string, status?: number }>}
 */
export async function fetchLinkText(url, options = {}) {
  const target = String(url ?? '').trim()
  if (!isHttpUrl(target)) return { ok: false, text: '', reason: 'not-a-url' }
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return { ok: false, text: '', reason: 'not-a-url' }
  }
  if (isBlockedHost(parsed.hostname)) return { ok: false, text: '', reason: 'blocked-host' }

  // DNS 复查：域名解析到内网也拒绝（防 DNS rebinding 的常见形态）。
  const resolve = options.resolve ?? (async (host) => (await lookup(host)).address)
  try {
    const address = await resolve(parsed.hostname)
    if (isBlockedHost(address)) return { ok: false, text: '', reason: 'blocked-host' }
  } catch {
    return { ok: false, text: '', reason: 'dns-failed' }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? LINK_TIMEOUT_MS
  const limit = options.limit ?? LINK_TEXT_LIMIT
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // 有些站点对没有 UA 的请求直接 403。
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-skill-bar/0.11',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    if (!response.ok) return { ok: false, text: '', reason: 'http-' + response.status, status: response.status }
    const type = String(response.headers.get('content-type') ?? '').toLowerCase()
    if (!type.includes('html') && !type.includes('text/plain') && !type.includes('xml')) {
      return { ok: false, text: '', reason: 'unsupported-type' }
    }
    const buffer = await response.arrayBuffer()
    const raw = Buffer.from(buffer.slice(0, LINK_BYTES_LIMIT)).toString('utf8')
    const text = (type.includes('text/plain') ? raw.replace(/\r\n/g, '\n') : htmlToText(raw)).slice(0, limit)
    if (text.trim() === '') return { ok: false, text: '', reason: 'empty' }
    return { ok: true, text, status: response.status }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'network'
    return { ok: false, text: '', reason }
  } finally {
    clearTimeout(timer)
  }
}
