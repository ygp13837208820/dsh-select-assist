/**
 * 「AI 搜索」的地址拼装。
 *
 * 模板里的 `%s` 会被替换成 URL 编码后的查询词；只替换**第一个** `%s`
 * （少数站点在 path 与 query 各放一个，第二个原样留着不会造成伤害）。
 */

/** 默认搜索地址：秘塔。 */
export const DEFAULT_SEARCH_URL = 'https://metaso.cn/?q=%s'

/**
 * 校验并规整一个搜索地址模板。
 * @param {unknown} value - 用户填的模板。
 * @returns {string} 合法模板，否则默认值。
 */
export function normalizeSearchUrl(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '' || !/^https?:\/\//i.test(text) || !text.includes('%s')) return DEFAULT_SEARCH_URL
  return text.length > 2048 ? text.slice(0, 2048) : text
}

/**
 * 把查询词填进模板。
 * @param {string} template - 含 `%s` 的地址模板。
 * @param {string} query - 查询词（可含空格/中文）。
 * @returns {string} 可直接打开的 URL。
 */
export function buildSearchUrl(template, query) {
  const safeTemplate = normalizeSearchUrl(template)
  const text = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return safeTemplate.replace('%s', encodeURIComponent(text))
}
