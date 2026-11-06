/**
 * 技能模型：把"划词工具栏上有哪些按钮"从代码里搬进配置。
 *
 * 一个技能要么是**内置动作**（copy / speak / search / explain / translate / summarize，
 * 复用现有实现），要么是**自定义提示词**（`{{text}}` / `{{context}}` / `{{lang}}` 变量，
 * 走模型出一段文本，落在回答窗或剪贴板）。
 *
 * 这个文件是唯一权威：主进程用它校验与落盘，伴生进程读同一份 JSON 的投影
 * （`menu` 数组，只含 id / name / icon），不重复实现规则。
 */

/** 技能种类。 */
export type SkillKind = 'builtin' | 'prompt'

/** 内置动作：前三个需要模型，后三个在本机完成。 */
export type BuiltinAction = 'explain' | 'translate' | 'summarize' | 'copy' | 'speak' | 'search'

/** 结果落在哪里。 */
export type SkillOutput = 'panel' | 'clipboard'

/** 一个技能。 */
export interface Skill {
  /** 稳定 id：内置的用 `builtin.*`，自定义的用 `sk_<random>`。 */
  id: string
  /** 浮条上显示的名字（≤ 8 个字符最稳，超出会被截断显示）。 */
  name: string
  /** 图标 id（见 `drawIcon` 支持的集合）。 */
  icon: string
  kind: SkillKind
  /** kind === 'builtin' 时的动作。 */
  action?: BuiltinAction
  /** kind === 'prompt' 时的提示词模板。 */
  prompt?: string
  /** 结果落点（默认 panel）。 */
  output: SkillOutput
  /** 是否启用（关掉的技能不占浮条位）。 */
  enabled: boolean
  /** 内置技能不可删除，只能排序/停用。 */
  deletable: boolean
}

/** 浮条上最多显示几个（含「更多」）。 */
export const MAX_TOP_N = 8
/** 技能总数上限。 */
export const MAX_SKILLS = 24
/** 技能名长度上限。 */
export const MAX_SKILL_NAME = 12
/** 提示词长度上限。 */
export const MAX_SKILL_PROMPT = 8000

/** 可用图标（与 companion/native/ui.mjs 的 drawIcon 对齐）。 */
export const SKILL_ICONS = [
  'search',
  'copy',
  'globe',
  'wand',
  'book',
  'list',
  'sparkle',
  'speak',
  'bolt',
] as const

/** 内置动作 → 默认图标。 */
const BUILTIN_ICON: Record<BuiltinAction, string> = {
  explain: 'book',
  translate: 'globe',
  summarize: 'list',
  copy: 'copy',
  speak: 'speak',
  search: 'search',
}

/**
 * 默认的「AI 搜索」提示词。
 *
 * 伴生进程在点这条技能时会先用必应 RSS 取几段结果，塞进 `{{context}}` 再交给模型；
 * 所以这里要明确告诉模型"下面这些是刚搜到的"，以及搜不到时该怎么退。
 */
export const AI_SEARCH_PROMPT = [
  '你是搜索助手。把用户划中的文字当成一次搜索意图，结合下面的实时搜索结果回答。',
  '',
  '搜索意图：',
  '{{text}}',
  '',
  '刚抓到的网络搜索结果（标题 / 摘要 / 链接，可能不完整）：',
  '{{context}}',
  '',
  '要求：',
  '- 先用 1~2 句话直接回答用户真正想查的东西；有结论就给结论，不要复述问题。',
  '- 再给「要点」3~5 条，每条一行；引用来源时写成 [标题](链接)。',
  '- 如果搜索结果与问题无关或不足，明说「这次搜到的信息不足」，并给 1~3 条更准确的关键词建议。',
  '- 不要编造链接、日期、数字或引文；拿不准就标注「待核实」。',
  '- 用 Markdown 组织回答，简洁，不要客套开场。',
].join('\n')

/** 默认技能：与截图那一页对齐（AI 搜索 / 复制 / 翻译 / 优化提示词 / 解释 / 优化搜索词）。 */
export const DEFAULT_SKILLS: readonly Skill[] = Object.freeze([
  {
    id: 'sk_ai_search',
    name: 'AI 搜索',
    icon: 'search',
    kind: 'prompt',
    output: 'panel',
    enabled: true,
    deletable: true,
    prompt: AI_SEARCH_PROMPT,
  },
  { id: 'builtin.copy', name: '复制', icon: 'copy', kind: 'builtin', action: 'copy', output: 'clipboard', enabled: true, deletable: false },
  { id: 'builtin.translate', name: '翻译', icon: 'globe', kind: 'builtin', action: 'translate', output: 'panel', enabled: true, deletable: false },
  {
    id: 'sk_optimize_prompt',
    name: '优化提示词',
    icon: 'wand',
    kind: 'prompt',
    output: 'panel',
    enabled: true,
    deletable: true,
    prompt: [
      '你是提示词工程师。把选中的文字改写成一个更清晰、更具体、可直接执行的提示词。',
      '',
      '要求：',
      '- 补全隐含的角色、目标、约束与输出格式，但不要改变原意。',
      '- 只输出改写后的提示词本身，不要解释你改了什么。',
      '',
      '原文：',
      '{{text}}',
    ].join('\n'),
  },
  { id: 'builtin.explain', name: '解释', icon: 'book', kind: 'builtin', action: 'explain', output: 'panel', enabled: true, deletable: false },
  {
    id: 'sk_optimize_query',
    name: '优化搜索词',
    icon: 'wand',
    kind: 'prompt',
    output: 'clipboard',
    enabled: true,
    deletable: true,
    prompt: [
      '把选中的文字改写成 1~3 条更适合搜索引擎的查询词。',
      '',
      '要求：',
      '- 去掉口语与冗余修饰，保留专有名词，必要时补上限定词。',
      '- 每行一条，只输出查询词，不要编号、不要解释。',
      '',
      '原文：',
      '{{text}}',
    ].join('\n'),
  },
] satisfies Skill[])

/** 兜底技能：`DEFAULT_SKILLS` 为空或索引不到时用它，避免出现 `undefined` 技能。 */
export const FALLBACK_SKILL: Skill = {
  id: 'builtin.explain',
  name: '解释',
  icon: 'book',
  kind: 'builtin',
  action: 'explain',
  output: 'panel',
  enabled: true,
  deletable: false,
}

/** 取值域内的字符串。 */
function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').slice(0, limit) : ''
}

/** 把任意输入规整成合法技能列表（缺项补默认，非法项丢弃）。 */
export function normalizeSkills(input: unknown): Skill[] {
  if (!Array.isArray(input)) return DEFAULT_SKILLS.map((skill) => ({ ...skill }))
  const seen = new Set<string>()
  const items: Skill[] = []
  for (const raw of input.slice(0, MAX_SKILLS)) {
    if (raw === null || typeof raw !== 'object') continue
    const value = raw as Partial<Record<keyof Skill, unknown>>
    const id = text(value.id, 64).trim()
    const name = text(value.name, MAX_SKILL_NAME).trim()
    if (id === '' || name === '' || seen.has(id)) continue
    seen.add(id)
    const kind: SkillKind = value.kind === 'builtin' ? 'builtin' : 'prompt'
    const action = kind === 'builtin' ? normalizeAction(value.action) : undefined
    if (kind === 'builtin' && action === undefined) continue
    const prompt = kind === 'prompt' ? text(value.prompt, MAX_SKILL_PROMPT).trim() : ''
    if (kind === 'prompt' && prompt === '') continue
    const icon = (SKILL_ICONS as readonly string[]).includes(String(value.icon)) ? String(value.icon) : kind === 'builtin' ? BUILTIN_ICON[action as BuiltinAction] : 'sparkle'
    items.push({
      id,
      name,
      icon,
      kind,
      ...(action === undefined ? {} : { action }),
      ...(prompt === '' ? {} : { prompt }),
      output: value.output === 'clipboard' ? 'clipboard' : 'panel',
      enabled: value.enabled !== false,
      // `deletable` 是派生值而不是用户输入：内置技能永远不可删，自定义技能永远可删。
      deletable: !id.startsWith('builtin.'),
    })
  }
  // 内置技能是浮条的骨架：配置里被删光了也要补回来，否则用户会失去"解释/翻译"。
  for (const fallback of DEFAULT_SKILLS) {
    if (!fallback.id.startsWith('builtin.') || seen.has(fallback.id)) continue
    items.push({ ...fallback })
  }
  return items
}

/** 内置动作的合法性检查。 */
function normalizeAction(value: unknown): BuiltinAction | undefined {
  const allowed: BuiltinAction[] = ['explain', 'translate', 'summarize', 'copy', 'speak', 'search']
  return allowed.includes(value as BuiltinAction) ? (value as BuiltinAction) : undefined
}

/**
 * 浮条投影：按配置顺序取前 `topN` 个启用项，`hasOverflow` 表示还有没显示的。
 * @param skills - 已规整的技能列表。
 * @param topN - 浮条最多显示几个（含「更多」）。
 * @returns 投影结果。
 */
export function menuProjection(skills: readonly Skill[], topN: number): { items: Skill[]; overflow: number } {
  const enabled = skills.filter((skill) => skill.enabled)
  const limit = Math.max(1, Math.min(MAX_TOP_N, Math.round(Number.isFinite(topN) ? topN : 5)))
  if (enabled.length <= limit) return { items: enabled, overflow: 0 }
  return { items: enabled.slice(0, limit - 1), overflow: enabled.length - (limit - 1) }
}

/** 模板变量。 */
export interface PromptVars {
  text: string
  context?: string
  lang?: string
  app?: string
}

/**
 * 渲染技能提示词：替换 `{{text}}` / `{{context}}` / `{{lang}}` / `{{app}}`。
 *
 * 模板里没有 `{{text}}` 时，自动在末尾补一段"选中的文本"，避免用户漏写变量后模型收到空请求。
 * @param template - 模板。
 * @param vars - 变量。
 * @returns 渲染后的提示词。
 */
export function renderPrompt(template: string, vars: PromptVars): string {
  const body = String(template ?? '')
  const context = typeof vars.context === 'string' ? vars.context.trim() : ''
  const hasText = /\{\{\s*text\s*\}\}/.test(body)
  const filled = body
    .replace(/\{\{\s*text\s*\}\}/g, vars.text)
    .replace(/\{\{\s*context\s*\}\}/g, context)
    .replace(/\{\{\s*lang\s*\}\}/g, vars.lang ?? '')
    .replace(/\{\{\s*app\s*\}\}/g, vars.app ?? '')
    .replace(/\{\{\s*[a-z_]+\s*\}\}/g, '')
  if (hasText) return filled.trim()
  return [filled.trim(), '', '选中的文本：', '```', vars.text, '```'].join('\n')
}

/** 找一个技能（内置动作也按 id 找）。 */
export function findSkill(skills: readonly Skill[], id: string): Skill | undefined {
  return skills.find((skill) => skill.id === id)
}

/** 技能 → 浮条/列表需要的最小投影（伴生进程只读这些字段）。 */
export interface SkillBrief {
  id: string
  name: string
  icon: string
  kind: SkillKind
  output: SkillOutput
}

/** 把一个技能压成伴生进程需要的形状。 */
export function toBrief(skill: Skill): SkillBrief {
  return { id: skill.id, name: skill.name, icon: skill.icon, kind: skill.kind, output: skill.output }
}
