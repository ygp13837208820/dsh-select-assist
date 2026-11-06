/**
 * 设置层：默认值、规整、以及「落盘 JSON 长什么样」。
 *
 * 主进程写的是 `normalizeSettings` 的结果，伴生进程读的是同一份文件；
 * 所以这里断言的形状就是两边的事实契约。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { DEFAULT_SETTINGS, normalizeSettings } = await import('../src/shared/protocol.ts')

test('默认设置带 6 个技能、topN=5、工具栏开启', () => {
  assert.equal(DEFAULT_SETTINGS.toolbarEnabled, true)
  assert.equal(DEFAULT_SETTINGS.topN, 5)
  assert.equal(DEFAULT_SETTINGS.skills.length, 6)
  assert.deepEqual(
    DEFAULT_SETTINGS.skills.map((skill) => skill.name),
    ['AI 搜索', '复制', '翻译', '优化提示词', '解释', '优化搜索词'],
  )
})

test('空对象规整出完整默认值（老版本设置文件升级路径）', () => {
  const settings = normalizeSettings({})
  assert.equal(settings.toolbarEnabled, true)
  assert.equal(settings.topN, 5)
  assert.equal(settings.skills.length, 6)
})

test('topN 夹在 1..8，非法值回落默认', () => {
  assert.equal(normalizeSettings({ topN: 0 }).topN, 1)
  assert.equal(normalizeSettings({ topN: 99 }).topN, 8)
  assert.equal(normalizeSettings({ topN: 'x' }).topN, 5)
  assert.equal(normalizeSettings({ topN: 3 }).topN, 3)
})

test('toolbarEnabled 只有显式 false 才关', () => {
  assert.equal(normalizeSettings({ toolbarEnabled: false }).toolbarEnabled, false)
  assert.equal(normalizeSettings({ toolbarEnabled: 0 }).toolbarEnabled, true)
  assert.equal(normalizeSettings({ toolbarEnabled: 'false' }).toolbarEnabled, true)
})

test('浮条停留时长：默认 10s，夹在 2..60s', () => {
  assert.equal(normalizeSettings({}).menuTimeoutMs, 10000)
  assert.equal(normalizeSettings({ menuTimeoutMs: 1500 }).menuTimeoutMs, 2000)
  assert.equal(normalizeSettings({ menuTimeoutMs: 999999 }).menuTimeoutMs, 60000)
  assert.equal(normalizeSettings({ menuTimeoutMs: 'x' }).menuTimeoutMs, 10000)
  assert.equal(normalizeSettings({ menuTimeoutMs: 20000 }).menuTimeoutMs, 20000)
})

test('搜索地址：默认秘塔，非法模板退回默认', () => {
  assert.equal(normalizeSettings({}).searchUrl, 'https://metaso.cn/?q=%s')
  assert.equal(normalizeSettings({ searchUrl: 'https://www.bing.com/search?q=%s' }).searchUrl, 'https://www.bing.com/search?q=%s')
  assert.equal(normalizeSettings({ searchUrl: 'https://metaso.cn/' }).searchUrl, 'https://metaso.cn/?q=%s')
  assert.equal(normalizeSettings({ searchUrl: 'javascript:x%s' }).searchUrl, 'https://metaso.cn/?q=%s')
})

test('打开方式：只有显式 ego 才用 ego，路径会 trim', () => {
  assert.equal(normalizeSettings({}).searchOpen, 'system')
  assert.equal(normalizeSettings({ searchOpen: 'ego' }).searchOpen, 'ego')
  assert.equal(normalizeSettings({ searchOpen: 'chrome' }).searchOpen, 'system')
  assert.equal(normalizeSettings({ egoPath: '  D:\\x\\ego.exe  ' }).egoPath, 'D:\\x\\ego.exe')
  assert.equal(normalizeSettings({ egoPath: 42 }).egoPath, '')
})

test('技能数组被规整后可直接落盘并被伴生进程读回', () => {
  const settings = normalizeSettings({
    topN: 4,
    skills: [
      { id: 'sk_x', name: '改写', kind: 'prompt', prompt: '改写：{{text}}', icon: 'wand', output: 'clipboard' },
      { id: 'builtin.copy', name: '复制', kind: 'builtin', action: 'copy' },
    ],
  })
  const json = JSON.parse(JSON.stringify(settings))
  assert.equal(json.topN, 4)
  assert.equal(json.skills[0].id, 'sk_x')
  assert.equal(json.skills[0].output, 'clipboard')
  assert.equal(json.skills[0].deletable, true)
  // 内置骨架会被补回来
  assert.ok(json.skills.some((skill) => skill.id === 'builtin.explain'))
  assert.equal(json.skills.find((skill) => skill.id === 'builtin.copy').deletable, false)
})
