import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SKILLS,
  MAX_SKILLS,
  menuProjection,
  normalizeSkills,
  renderPrompt,
} from '../src/shared/skills.ts'

test('默认技能与截图一致：5 个常驻 + 1 个进下拉', () => {
  const skills = normalizeSkills(undefined)
  assert.equal(skills.length, 6)
  assert.deepEqual(
    skills.map((skill) => skill.name),
    ['AI 搜索', '复制', '翻译', '优化提示词', '解释', '优化搜索词'],
  )
  const { items, overflow } = menuProjection(skills, 5)
  assert.equal(items.length, 4)
  assert.equal(overflow, 2)
})

test('topN 为 5 时前 4 个常驻，其余进「更多」', () => {
  const skills = normalizeSkills(DEFAULT_SKILLS)
  const { items, overflow } = menuProjection(skills, 5)
  assert.deepEqual(items.map((s) => s.id), ['sk_ai_search', 'builtin.copy', 'builtin.translate', 'sk_optimize_prompt'])
  assert.equal(overflow, 2)
})

test('技能装得下时不出现「更多」', () => {
  const skills = normalizeSkills(DEFAULT_SKILLS.slice(0, 3))
  // 内置技能会被补回，但这里只放三个内置，正好 3 个
  const { items, overflow } = menuProjection(skills, 5)
  assert.equal(overflow, 0)
  assert.equal(items.length, skills.filter((s) => s.enabled).length)
})

test('停用的技能不占位', () => {
  const skills = normalizeSkills([{ ...DEFAULT_SKILLS[0] }, { ...DEFAULT_SKILLS[1], enabled: false }, { ...DEFAULT_SKILLS[2] }])
  const { items } = menuProjection(skills, 5)
  assert.ok(!items.some((s) => s.id === 'builtin.copy'))
})

test('normalize 丢弃非法项、保留顺序、限制数量', () => {
  const input = [
    { id: 'a', name: '甲', kind: 'prompt', prompt: 'hi {{text}}' },
    { id: 'a', name: '重复', kind: 'prompt', prompt: 'x' },
    { id: '', name: '空 id', kind: 'prompt', prompt: 'x' },
    { id: 'b', name: '', kind: 'prompt', prompt: 'x' },
    { id: 'c', name: '无提示词', kind: 'prompt' },
    { id: 'd', name: '非法内置', kind: 'builtin', action: 'nope' },
    { id: 'e', name: '内置', kind: 'builtin', action: 'copy' },
    'not-an-object',
  ]
  const skills = normalizeSkills(input)
  const ids = skills.map((s) => s.id)
  assert.equal(ids.filter((id) => id === 'a').length, 1)
  assert.ok(!ids.includes('b'))
  assert.ok(!ids.includes('c'))
  assert.ok(!ids.includes('d'))
  assert.ok(ids.includes('e'))
  // 内置骨架总会被补回
  for (const builtin of DEFAULT_SKILLS.filter((s) => s.id.startsWith('builtin.'))) {
    assert.ok(ids.includes(builtin.id), `missing ${builtin.id}`)
  }
  assert.ok(skills.length <= MAX_SKILLS)
})

test('内置技能不可删除，自定义技能可删除', () => {
  const skills = normalizeSkills([
    { id: 'builtin.copy', name: '复制', kind: 'builtin', action: 'copy', deletable: true },
    { id: 'sk_x', name: '我的', kind: 'prompt', prompt: 'x {{text}}', deletable: false },
  ])
  assert.equal(skills.find((s) => s.id === 'builtin.copy').deletable, false)
  assert.equal(skills.find((s) => s.id === 'sk_x').deletable, true)
})

test('图标不在白名单时回落到默认', () => {
  const skills = normalizeSkills([{ id: 'sk_x', name: '我的', kind: 'prompt', prompt: 'x', icon: 'evil()' }])
  assert.ok(['wand', 'book', 'sparkle', 'search', 'copy', 'globe', 'list', 'speak', 'bolt'].includes(skills.find((s) => s.id === 'sk_x').icon))
})

test('renderPrompt 替换变量并裁掉未知变量', () => {
  const out = renderPrompt('解释 {{text}}\n上文：{{context}}\n语言：{{lang}}\n未知：{{nope}}', {
    text: 'hello',
    context: 'ctx',
    lang: 'zh',
  })
  assert.match(out, /解释 hello/)
  assert.match(out, /上文：ctx/)
  assert.match(out, /语言：zh/)
  assert.doesNotMatch(out, /\{\{/)
})

test('模板缺少 {{text}} 时自动补一段原文', () => {
  const out = renderPrompt('把下面的内容改写成标题。', { text: '原文内容' })
  assert.match(out, /把下面的内容改写成标题。/)
  assert.match(out, /原文内容/)
  assert.match(out, /选中的文本/)
})

test('prompt 长度与名称长度都会被截断', () => {
  const longName = '一'.repeat(40)
  const longPrompt = 'x'.repeat(20000)
  const skills = normalizeSkills([{ id: 'sk_long', name: longName, kind: 'prompt', prompt: longPrompt }])
  const skill = skills.find((s) => s.id === 'sk_long')
  assert.equal(skill.name.length, 12)
  assert.equal(skill.prompt.length, 8000)
})
