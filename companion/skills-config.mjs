/**
 * 伴生进程侧的技能配置：只读主进程落盘的那份 JSON。
 *
 * 为什么不在伴生进程里重实现一遍校验：技能的顺序、启用状态、图标白名单只有一个权威
 * （`src/shared/skills.ts`，主进程保存时已经规整过）。伴生进程只取它需要的四个字段，
 * 读不到文件（首次启动、被删掉）就用内置的六个默认技能——浮条永远不至于空着。
 *
 * 缓存按 mtime 失效：设置页保存后下一次划词就生效，不用重启伴生进程。
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_SEARCH_URL, normalizeSearchUrl } from './search-url.mjs'

/** 内置兜底技能（与 src/shared/skills.ts 的 DEFAULT_SKILLS 对齐）。 */
const FALLBACK_SKILLS = [
  { id: 'sk_ai_search', name: 'AI 搜索', icon: 'search', kind: 'prompt', output: 'panel' },
  { id: 'builtin.copy', name: '复制', icon: 'copy', kind: 'builtin', action: 'copy', output: 'clipboard' },
  { id: 'builtin.translate', name: '翻译', icon: 'globe', kind: 'builtin', action: 'translate', output: 'panel' },
  { id: 'sk_optimize_prompt', name: '优化提示词', icon: 'wand', kind: 'prompt', output: 'panel' },
  { id: 'builtin.explain', name: '解释', icon: 'book', kind: 'builtin', action: 'explain', output: 'panel' },
  { id: 'sk_optimize_query', name: '优化搜索词', icon: 'wand', kind: 'prompt', output: 'clipboard' },
]

const FALLBACK_TOP_N = 5
/** 浮条停留时长兜底（毫秒）：与 src/shared/protocol.ts 的 DEFAULT_MENU_TIMEOUT_MS 一致。 */
const FALLBACK_TIMEOUT_MS = 10000
const TIMEOUT_MIN = 2000
const TIMEOUT_MAX = 60000

/** 配置缓存：`{ mtimeMs, value }`。 */
let cache = {
  mtimeMs: -1,
  value: { skills: FALLBACK_SKILLS, topN: FALLBACK_TOP_N, menuTimeoutMs: FALLBACK_TIMEOUT_MS, searchUrl: DEFAULT_SEARCH_URL, searchOpen: 'system', egoPath: '', enabled: true },
}

/** 设置文件路径（`DSH_HOME` 优先，否则 `~/.dsh`；与 src/settings.ts 一致）。 */
function settingsPath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'dsh-select-assist.json')
}

/** 把 JSON 里的一条技能压成浮条需要的形状；字段不全就丢弃。 */
function brief(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (id === '' || name === '') return null
  return {
    id,
    name,
    icon: typeof raw.icon === 'string' && raw.icon !== '' ? raw.icon : 'sparkle',
    kind: raw.kind === 'builtin' ? 'builtin' : 'prompt',
    ...(typeof raw.action === 'string' ? { action: raw.action } : {}),
    output: raw.output === 'clipboard' ? 'clipboard' : 'panel',
  }
}

/**
 * 读当前生效的技能与浮条容量。
 * @returns {{skills: Array<object>, topN: number}} 已启用、已排序的技能。
 */
export function loadMenuSkills() {
  let mtimeMs = -1
  let raw = ''
  try {
    const file = settingsPath()
    mtimeMs = statSync(file).mtimeMs
    if (mtimeMs === cache.mtimeMs) return cache.value
    raw = readFileSync(file, 'utf8')
  } catch {
    // 没有设置文件：用内置兜底（第一次启动就是这条路）。
    cache = { mtimeMs: -1, value: { skills: FALLBACK_SKILLS, topN: FALLBACK_TOP_N, menuTimeoutMs: FALLBACK_TIMEOUT_MS, enabled: true } }
    return cache.value
  }
  try {
    // 去掉 BOM：用 PowerShell / 记事本另存过的 JSON 常带 U+FEFF，JSON.parse 会直接抛。
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
    const enabled = parsed?.toolbarEnabled !== false
    const list = Array.isArray(parsed?.skills) ? parsed.skills.filter((skill) => skill?.enabled !== false).map(brief).filter(Boolean) : []
    const topN = Number(parsed?.topN)
    const timeout = Number(parsed?.menuTimeoutMs)
    const skills = list.length > 0 ? list : FALLBACK_SKILLS
    cache = {
      mtimeMs,
      value: {
        skills,
        topN: Number.isFinite(topN) ? Math.max(1, Math.min(8, Math.round(topN))) : FALLBACK_TOP_N,
        menuTimeoutMs: resolveTimeout(timeout),
        searchUrl: normalizeSearchUrl(parsed?.searchUrl),
        searchOpen: parsed?.searchOpen === 'ego' ? 'ego' : 'system',
        egoPath: typeof parsed?.egoPath === 'string' ? parsed.egoPath.trim() : '',
        enabled,
      },
    }
    return cache.value
  } catch {
    cache = { mtimeMs, value: { skills: FALLBACK_SKILLS, topN: FALLBACK_TOP_N, menuTimeoutMs: resolveTimeout(Number.NaN), searchUrl: normalizeSearchUrl(undefined), searchOpen: 'system', egoPath: '', enabled: true } }
    return cache.value
  }
}

/**
 * 决定这次用多长的停留时间：环境变量（排障/临时覆盖）> 设置文件 > 默认。
 * @param {number} fromFile - 设置文件里的毫秒数（可能非法）。
 * @returns {number} 夹在 2s..60s 的毫秒数。
 */
function resolveTimeout(fromFile) {
  const env = Number(process.env.DSH_SELECTION_MENU_TIMEOUT_MS)
  const chosen = Number.isFinite(env) && env > 0 ? env : fromFile
  if (!Number.isFinite(chosen)) return FALLBACK_TIMEOUT_MS
  return Math.max(TIMEOUT_MIN, Math.min(TIMEOUT_MAX, Math.round(chosen)))
}
