/**
 * 用一个具体浏览器打开 URL。
 *
 * 默认交给系统（`rundll32 url.dll,FileProtocolHandler`，走用户的默认浏览器）。
 * 也可以指定 ego lite：它虽然注册成了 Windows 浏览器候选，但「设为默认」只能由用户在
 * 默认应用里手动点（Windows 的 UserChoice 有哈希保护，程序改不了），
 * 所以这里给一个**只影响本插件**的开关，比改系统默认更克制。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ego lite 可能的安装位置（按优先级）。
 * @param {Record<string, string | undefined>} [env] - 环境变量（测试可注入）。
 * @returns {string[]} 候选路径。
 */
export function egoCandidates(env = process.env) {
  const list = []
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  list.push(join(programFiles, 'Citro Labs', 'ego lite', 'Application', 'ego.exe'))
  const programFilesX86 = env['ProgramFiles(x86)']
  if (typeof programFilesX86 === 'string' && programFilesX86 !== '') {
    list.push(join(programFilesX86, 'Citro Labs', 'ego lite', 'Application', 'ego.exe'))
  }
  if (typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA !== '') {
    list.push(join(env.LOCALAPPDATA, 'Programs', 'ego lite', 'Application', 'ego.exe'))
  }
  return list
}

/**
 * 找出可用的 ego 可执行文件。
 * @param {{egoPath?: string, exists?: (path: string) => boolean, env?: Record<string, string | undefined>}} [options]
 * @returns {string|null} 可执行文件路径；找不到返回 null。
 */
export function resolveEgoExe(options = {}) {
  const exists = options.exists ?? existsSync
  const custom = typeof options.egoPath === 'string' ? options.egoPath.trim() : ''
  if (custom !== '' && exists(custom)) return custom
  for (const candidate of egoCandidates(options.env ?? process.env)) {
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * 打开一个 URL。
 * @param {string} url - 要打开的地址。
 * @param {{mode?: 'system'|'ego', egoPath?: string, exists?: (p: string) => boolean, env?: Record<string, string | undefined>, spawnFn?: typeof spawn, spawnSyncFn?: typeof spawnSync}} [options]
 * @returns {{ok: boolean, via: 'system'|'ego', exe?: string, reason?: string}}
 */
export function openUrl(url, options = {}) {
  const target = String(url ?? '')
  if (target === '') return { ok: false, via: 'system', reason: 'empty-url' }

  if (options.mode === 'ego') {
    const exe = resolveEgoExe(options)
    if (exe !== null) {
      try {
        const spawnFn = options.spawnFn ?? spawn
        const child = spawnFn(exe, [target], { detached: true, stdio: 'ignore' })
        child.unref?.()
        return { ok: true, via: 'ego', exe }
      } catch {
        return { ok: false, via: 'ego', exe, reason: 'spawn-failed' }
      }
    }
    // 没装/找不到 ego：安静退回系统默认浏览器，别让「AI 搜索」整个失效。
  }

  try {
    const spawnSyncFn = options.spawnSyncFn ?? spawnSync
    const result = spawnSyncFn('rundll32.exe', ['url.dll,FileProtocolHandler', target], { windowsHide: true, stdio: 'ignore' })
    if (result?.error) return { ok: false, via: 'system', reason: 'spawn-failed' }
    return { ok: true, via: 'system' }
  } catch {
    return { ok: false, via: 'system', reason: 'spawn-failed' }
  }
}
