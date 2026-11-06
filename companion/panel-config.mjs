/**
 * 回答窗口（面板）的行为配置。
 *
 * 为什么单独一个文件：宿主半边的 `normalizeSettings` 只认它认识的字段，设置页保存时
 * 会把不认识的键丢掉；而浮窗的自动关闭是**伴生进程自己的行为**，跟着宿主设置走会被
 * 设置页"顺手"改回默认。放在独立文件里两边互不影响：
 *
 *   %DSH_HOME%/dsh-select-assist.panel.json
 *   { "autoClose": true, "timeoutMs": 15000, "closeOnOutsideClick": true }
 *
 * 读不到文件就用默认值（默认就是开着的），所以不建这个文件也能用。
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 自动关闭的默认时长（毫秒）。 */
export const DEFAULT_PANEL_TIMEOUT_MS = 15000
/** 合法区间（毫秒）：太短读不完，太长等于没有。 */
export const PANEL_TIMEOUT_RANGE = { min: 3000, max: 60000 }

/** 默认值。 */
const DEFAULTS = {
  autoClose: true,
  timeoutMs: DEFAULT_PANEL_TIMEOUT_MS,
  closeOnOutsideClick: true,
}

/** 缓存：按 mtime 失效。 */
let cache = { mtimeMs: -1, value: DEFAULTS }

/** 配置文件路径（`DSH_HOME` 优先，否则 `~/.dsh`）。 */
function configPath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'dsh-select-assist.panel.json')
}

/** 环境变量 > 文件 > 默认。 */
function resolveBoolean(value, fallback, envName) {
  const env = process.env[envName]
  if (env === '0') return false
  if (env === '1') return true
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 读当前生效的面板配置。
 * @returns {{autoClose: boolean, timeoutMs: number, closeOnOutsideClick: boolean}}
 */
export function loadPanelConfig() {
  let mtimeMs = -1
  let raw = ''
  try {
    const file = configPath()
    mtimeMs = statSync(file).mtimeMs
    if (mtimeMs === cache.mtimeMs) return cache.value
    raw = readFileSync(file, 'utf8')
  } catch {
    cache = { mtimeMs: -1, value: resolveFrom({}) }
    return cache.value
  }
  let parsed = {}
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    parsed = {}
  }
  cache = { mtimeMs, value: resolveFrom(parsed ?? {}) }
  return cache.value
}

/** 把文件内容规整成配置（非法值退回默认）。 */
function resolveFrom(parsed) {
  const rawTimeout = Number(parsed?.timeoutMs)
  const envTimeout = Number(process.env.DSH_SELECTION_PANEL_TIMEOUT_MS)
  const chosen = Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout
    : Number.isFinite(rawTimeout) && rawTimeout > 0
      ? rawTimeout
      : DEFAULT_PANEL_TIMEOUT_MS
  return {
    autoClose: resolveBoolean(parsed?.autoClose, DEFAULTS.autoClose, 'DSH_SELECTION_PANEL_AUTOCLOSE'),
    timeoutMs: Math.max(PANEL_TIMEOUT_RANGE.min, Math.min(PANEL_TIMEOUT_RANGE.max, Math.round(chosen))),
    closeOnOutsideClick: resolveBoolean(parsed?.closeOnOutsideClick, DEFAULTS.closeOnOutsideClick, 'DSH_SELECTION_PANEL_OUTSIDE'),
  }
}

/**
 * 这一轮的实际停留时长：基础值 + 按回答长度放宽，让长回答不至于读到一半被收走。
 * @param {number} baseMs - 配置里的基础时长。
 * @param {number} answerLength - 回答字符数。
 * @returns {number} 夹在区间内的毫秒数。
 */
export function panelTimeoutFor(baseMs, answerLength) {
  const base = Number.isFinite(baseMs) ? baseMs : DEFAULT_PANEL_TIMEOUT_MS
  const extra = Math.min(15000, Math.max(0, Number(answerLength) || 0) * 15)
  return Math.max(PANEL_TIMEOUT_RANGE.min, Math.min(PANEL_TIMEOUT_RANGE.max, Math.round(base + extra)))
}
