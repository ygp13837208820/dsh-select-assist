/**
 * 端到端（无原生窗口）：宿主落盘的设置 JSON → 伴生进程的菜单投影。
 *
 * 这条链路是这次改造最容易断的地方：主进程写 `skills` / `topN` / `toolbarEnabled`，
 * 伴生进程按自己的规则读。这里用一个临时 DSH_HOME 把两边接起来验一遍。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const home = mkdtempSync(join(tmpdir(), 'dsh-skill-bar-'))
process.env.DSH_HOME = home
const settingsFile = join(home, 'dsh-select-assist.json')

/**
 * 写设置文件，并把 mtime 往后推 `tick` 毫秒。
 *
 * 伴生进程按 mtime 缓存；测试里连续写同一个文件常常落在同一毫秒，缓存会拒绝刷新
 * （这不是 bug，是省 IO 的代价）。测试里显式制造不同的 mtime。
 */
let tick = 0
function writeSettings(value) {
  writeFileSync(settingsFile, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
  tick += 1
  const stamp = new Date(Date.now() + tick * 1000)
  utimesSync(settingsFile, stamp, stamp)
}

writeSettings({
  toolbarEnabled: true,
  topN: 5,
  skills: [
    { id: 'builtin.search', name: 'AI 搜索', icon: 'search', kind: 'builtin', action: 'search', enabled: true },
    { id: 'builtin.copy', name: '复制', icon: 'copy', kind: 'builtin', action: 'copy', enabled: true },
    { id: 'builtin.translate', name: '翻译', icon: 'globe', kind: 'builtin', action: 'translate', enabled: true },
    { id: 'sk_a', name: '优化提示词', icon: 'wand', kind: 'prompt', enabled: true },
    // 停用的技能不该占位
    { id: 'sk_off', name: '停用的', icon: 'wand', kind: 'prompt', enabled: false },
    { id: 'builtin.explain', name: '解释', icon: 'book', kind: 'builtin', action: 'explain', enabled: true },
    { id: 'sk_b', name: '优化搜索词', icon: 'wand', kind: 'prompt', enabled: true },
  ],
})

const { loadMenuSkills } = await import('../companion/skills-config.mjs')
const { splitSkills, layoutBar, layoutList } = await import('../companion/menu-model.mjs')

test('伴生进程读到的技能：跳过停用项、保持顺序', () => {
  const config = loadMenuSkills()
  assert.equal(config.enabled, true)
  assert.equal(config.topN, 5)
  assert.equal(config.menuTimeoutMs, 10000)
  assert.equal(config.searchUrl, 'https://metaso.cn/?q=%s')
  assert.equal(config.searchOpen, 'system')
  assert.equal(config.egoPath, '')
  assert.deepEqual(
    config.skills.map((skill) => skill.id),
    ['builtin.search', 'builtin.copy', 'builtin.translate', 'sk_a', 'builtin.explain', 'sk_b'],
  )
})

test('topN=5：浮条 4 个 + 「更多」2 个', () => {
  const config = loadMenuSkills()
  const split = splitSkills(config.skills, config.topN, 900)
  assert.deepEqual(split.bar.map((skill) => skill.name), ['AI 搜索', '复制', '翻译', '优化提示词'])
  assert.deepEqual(split.overflow.map((skill) => skill.name), ['解释', '优化搜索词'])
  const layout = layoutBar(split.bar, split.overflow.length > 0)
  assert.equal(layout.segments.length, 5)
  assert.equal(layout.segments.at(-1).kind, 'more')
})

test('「更多」展开后是那两项，按行序取回', () => {
  const config = loadMenuSkills()
  const split = splitSkills(config.skills, config.topN, 900)
  const list = layoutList(split.overflow)
  assert.deepEqual(list.rows.map((row) => row.label), ['解释', '优化搜索词'])
})

test('toolbarEnabled=false 时伴生进程直接不弹', () => {
  writeSettings({ toolbarEnabled: false, topN: 5, skills: [] })
  const config = loadMenuSkills()
  assert.equal(config.enabled, false)
})

test('停留时长跟着设置走，越界被夹住', () => {
  writeSettings({ menuTimeoutMs: 30000 })
  assert.equal(loadMenuSkills().menuTimeoutMs, 30000)
  writeSettings({ menuTimeoutMs: 999 })
  assert.equal(loadMenuSkills().menuTimeoutMs, 2000)
})

test('设置文件损坏时退回内置六个技能', () => {
  writeSettings('{ not json')
  const config = loadMenuSkills()
  assert.equal(config.skills.length, 6)
  assert.equal(config.skills[0].id, 'sk_ai_search')
})

test('带 BOM 的 JSON 也能读（PowerShell/记事本另存过的文件）', () => {
  writeSettings('\uFEFF' + JSON.stringify({ menuTimeoutMs: 15000, topN: 4 }))
  const config = loadMenuSkills()
  assert.equal(config.menuTimeoutMs, 15000)
  assert.equal(config.topN, 4)
})
