/**
 * 校验示例技能包：能通过 normalizeSkills、能渲染出提示词。
 * 用法：node --experimental-strip-types scripts/check-samples.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'docs', 'custom-skills.samples.json')
const raw = JSON.parse(readFileSync(file, 'utf8'))

const { normalizeSkills, renderPrompt } = await import('../src/shared/skills.ts')

const skills = normalizeSkills(raw.skills)
console.log('input', raw.skills.length, 'normalized', skills.length)
let bad = 0
for (const skill of raw.skills) {
  const hit = skills.find((item) => item.id === skill.id)
  if (hit === undefined) {
    console.log('DROPPED', skill.id)
    bad += 1
    continue
  }
  const prompt = renderPrompt(hit.prompt ?? '', {
    text: '这一段是被选中的示例文本。',
    context: '这是它所在的段落，只作语境。',
    lang: 'zh',
  })
  const leaks = prompt.match(/\{\{[a-z_]+\}\}/g)
  if (leaks !== null) {
    console.log('LEAK', skill.id, leaks)
    bad += 1
  }
  console.log(String(hit.name).padEnd(6), '|', hit.icon.padEnd(8), '|', hit.output.padEnd(9), '| prompt', prompt.length, 'chars')
}
if (bad > 0) {
  console.log('FAILED', bad)
  process.exit(1)
}
console.log('OK')
