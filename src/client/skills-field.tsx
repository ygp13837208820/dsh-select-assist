/**
 * 设置页里的「技能管理」：浮条上放哪些按钮、顺序、以及自定义技能的新增/编辑/删除。
 *
 * 交互对齐豆包那页设置：
 * - 顶部开关「当选中文本时显示工具栏」；
 * - 说明「前 N 个技能显示在工具栏上，其余收进下拉」；
 * - 卡片列表可拖拽排序，自定义技能右侧有删除；
 * - 「添加技能」= 名称 + 图标 + 提示词 + 结果落点。
 *
 * 所有改动都走上层传下来的 `update`（本地立即生效 + 防抖落盘），组件自己不碰网络。
 */
import { createElement, useCallback, useState, type ReactNode } from 'react'

import { MAX_TOP_N, SKILL_ICONS, type Skill } from '../shared/skills'
import type { SelectionToolsSettings } from '../shared/protocol'
import { ToolIcon } from './icons'

/** 组件文案（跟随界面语言）。 */
const TEXT = {
  zh: {
    title: '技能管理',
    hint: '前 {n} 个技能将显示在工具栏上，其他的将隐藏在下拉菜单中',
    showBar: '当选中文本时显示工具栏',
    add: '添加技能',
    edit: '编辑',
    remove: '删除',
    name: '名称',
    icon: '图标',
    prompt: '提示词',
    promptHint: '可用变量：{{text}} 选中的文字、{{context}} 上文、{{lang}} 界面语言',
    output: '结果落点',
    outputPanel: '回答窗口',
    outputClipboard: '剪贴板',
    save: '保存',
    cancel: '取消',
    enabled: '启用',
    builtinNote: '内置技能不可删除',
    topN: '常驻数量',
    timeout: '停留时长',
    timeoutHint: '鼠标停在浮条上不计时；移开后重新从头计时。',
    searchUrl: '搜索地址',
    searchUrlHint: '「AI 搜索」打开的地址，%s 会被替换成选中的文字。默认秘塔：https://metaso.cn/?q=%s',
    searchOpen: '打开方式',
    searchOpenSystem: '系统默认浏览器',
    searchOpenEgo: 'ego lite',
    egoPathPlaceholder: 'ego.exe 路径（留空自动检测）',
    egoPathHint: '留空会自动找 Program Files\\Citro Labs\\ego lite\\Application\\ego.exe；找不到时退回系统默认浏览器。',
    unnamed: '未命名技能',
  },
  en: {
    title: 'Skills',
    hint: 'The first {n} skills appear on the toolbar; the rest go into the dropdown',
    showBar: 'Show the toolbar when text is selected',
    add: 'Add skill',
    edit: 'Edit',
    remove: 'Delete',
    name: 'Name',
    icon: 'Icon',
    prompt: 'Prompt',
    promptHint: 'Variables: {{text}} selection, {{context}} paragraph, {{lang}} UI language',
    output: 'Result goes to',
    outputPanel: 'Answer panel',
    outputClipboard: 'Clipboard',
    save: 'Save',
    cancel: 'Cancel',
    enabled: 'Enabled',
    builtinNote: 'Built-in skills cannot be deleted',
    topN: 'On the bar',
    timeout: 'Stays for',
    timeoutHint: 'Hovering pauses the countdown; leaving restarts it.',
    searchUrl: 'Search URL',
    searchUrlHint: 'Opened by “AI search”; %s is replaced by the selection. Default: https://metaso.cn/?q=%s',
    searchOpen: 'Open with',
    searchOpenSystem: 'System default browser',
    searchOpenEgo: 'ego lite',
    egoPathPlaceholder: 'Path to ego.exe (blank = auto-detect)',
    egoPathHint: 'Blank auto-detects Program Files\\Citro Labs\\ego lite\\Application\\ego.exe; falls back to the system browser.',
    unnamed: 'Untitled skill',
  },
} as const

/** 新建技能时的空白草稿。 */
function blankSkill(): Skill {
  return {
    id: 'sk_' + Math.random().toString(36).slice(2, 10),
    name: '',
    icon: 'wand',
    kind: 'prompt',
    prompt: '',
    output: 'panel',
    enabled: true,
    deletable: true,
  }
}

const CARD: Record<string, string | number> = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 12,
  background: 'var(--dsh-color-bg-elevated, #ffffff)',
  border: '1px solid var(--dsh-color-border-subtle, rgba(0,0,0,0.06))',
}

const MUTED: Record<string, string | number> = { fontSize: 12, opacity: 0.6 }

/** 技能管理面板。 */
export function SkillManager(props: {
  settings: SelectionToolsSettings
  update: (patch: Partial<SelectionToolsSettings>) => void
  locale: 'zh' | 'en'
}): ReactNode {
  const { settings, update, locale } = props
  const t = TEXT[locale]
  const [editing, setEditing] = useState<Skill | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  /** 搜索地址是自由文本：本地存草稿，失焦/回车才提交，避免每敲一个字符就被规整回默认值。 */
  const [searchDraft, setSearchDraft] = useState(settings.searchUrl)

  const skills = settings.skills

  /** 移动一个技能到新位置（拖拽与上下箭头共用）。 */
  const move = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= skills.length || to >= skills.length) return
      const next = skills.slice()
      const [item] = next.splice(from, 1)
      if (item === undefined) return
      next.splice(to, 0, item)
      update({ skills: next })
    },
    [skills, update],
  )

  /** 保存编辑器里的技能（新增或替换）。 */
  const commit = useCallback(() => {
    if (editing === null) return
    const clean: Skill = {
      ...editing,
      name: editing.name.trim().slice(0, 12),
      prompt: typeof editing.prompt === 'string' ? editing.prompt : '',
    }
    if (clean.name === '') return
    if (clean.kind === 'prompt' && (clean.prompt ?? '').trim() === '') return
    const exists = skills.some((skill) => skill.id === clean.id)
    update({ skills: exists ? skills.map((skill) => (skill.id === clean.id ? clean : skill)) : [...skills, clean] })
    setEditing(null)
  }, [editing, skills, update])

  const iconButton = (icon: string, selected: boolean): ReactNode =>
    createElement(
      'button',
      {
        key: icon,
        type: 'button',
        title: icon,
        onClick: () => setEditing((current) => (current === null ? current : { ...current, icon })),
        style: {
          width: 32,
          height: 32,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 8,
          cursor: 'pointer',
          color: 'inherit',
          border: selected ? '1px solid var(--dsh-color-accent, #2f63e0)' : '1px solid var(--dsh-color-border-subtle, rgba(0,0,0,0.08))',
          background: selected ? 'var(--dsh-color-accent-soft, rgba(47,99,224,0.1))' : 'transparent',
        },
      },
      createElement(ToolIcon, { name: icon as never, size: 16 }),
    )

  const row = (skill: Skill, index: number): ReactNode =>
    createElement(
      'div',
      {
        key: skill.id,
        draggable: true,
        onDragStart: () => setDragFrom(index),
        onDragOver: (event: any) => event.preventDefault(),
        onDrop: (event: any) => {
          event.preventDefault()
          if (dragFrom !== null) move(dragFrom, index)
          setDragFrom(null)
        },
        onDragEnd: () => setDragFrom(null),
        'data-skill': skill.id,
        style: { ...CARD, opacity: dragFrom === index ? 0.5 : 1, cursor: 'grab', userSelect: 'none' },
      },
      createElement('span', { 'aria-hidden': true, style: { ...MUTED, letterSpacing: -2 } }, '⠿'),
      createElement('span', { style: { display: 'grid', placeItems: 'center', width: 24, height: 24, opacity: skill.enabled ? 1 : 0.4 } }, createElement(ToolIcon, { name: skill.icon as never, size: 16 })),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => setEditing({ ...skill }),
          style: { flex: 1, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontSize: 14, opacity: skill.enabled ? 1 : 0.45 },
        },
        skill.name || t.unnamed,
      ),
      createElement(
        'button',
        {
          type: 'button',
          title: t.enabled,
          onClick: () => update({ skills: skills.map((item) => (item.id === skill.id ? { ...item, enabled: !item.enabled } : item)) }),
          style: { width: 34, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative', background: skill.enabled ? 'var(--dsh-color-accent, #2f63e0)' : 'var(--dsh-color-border, #c8cfda)' },
          'aria-pressed': skill.enabled,
        },
        createElement('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: skill.enabled ? 16 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 120ms ease',
          },
        }),
      ),
      skill.deletable
        ? createElement(
            'button',
            {
              type: 'button',
              title: t.remove,
              onClick: () => update({ skills: skills.filter((item) => item.id !== skill.id) }),
              style: { background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.55, padding: 4 },
            },
            createElement(ToolIcon, { name: 'trash', size: 16 }),
          )
        : createElement('span', { title: t.builtinNote, style: { ...MUTED, padding: '0 6px' } }, '•'),
    )

  const editor = editing === null
    ? null
    : createElement(
        'div',
        { style: { ...CARD, flexDirection: 'column', alignItems: 'stretch', gap: 12, background: 'var(--dsh-color-bg-sunken, #f7f8fa)' } },
        createElement('input', {
          value: editing.name,
          maxLength: 12,
          placeholder: t.name,
          onChange: (event: any) => setEditing({ ...editing, name: String(event.target.value) }),
          style: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsh-color-border-subtle, rgba(0,0,0,0.12))', fontSize: 14 },
        }),
        createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, SKILL_ICONS.map((icon) => iconButton(icon, editing.icon === icon))),
        createElement('textarea', {
          value: editing.prompt ?? '',
          rows: 6,
          placeholder: t.promptHint,
          onChange: (event: any) => setEditing({ ...editing, prompt: String(event.target.value) }),
          style: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsh-color-border-subtle, rgba(0,0,0,0.12))', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' },
        }),
        createElement('span', { style: MUTED }, t.promptHint),
        createElement(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
          t.output,
          createElement(
            'select',
            {
              value: editing.output,
              onChange: (event: any) => setEditing({ ...editing, output: event.target.value === 'clipboard' ? 'clipboard' : 'panel' }),
              style: { padding: '4px 8px', borderRadius: 6 },
            },
            createElement('option', { value: 'panel' }, t.outputPanel),
            createElement('option', { value: 'clipboard' }, t.outputClipboard),
          ),
        ),
        createElement(
          'div',
          { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
          createElement('button', { type: 'button', onClick: () => setEditing(null), style: { padding: '6px 14px', borderRadius: 8, cursor: 'pointer' } }, t.cancel),
          createElement(
            'button',
            {
              type: 'button',
              onClick: commit,
              disabled: editing.name.trim() === '' || (editing.kind === 'prompt' && (editing.prompt ?? '').trim() === ''),
              style: { padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'var(--dsh-color-accent, #2f63e0)', color: '#fff' },
            },
            t.save,
          ),
        ),
      )

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    createElement(
      'label',
      { style: { ...CARD, cursor: 'pointer' } },
      createElement('span', { style: { flex: 1, fontSize: 14 } }, t.showBar),
      createElement('input', {
        type: 'checkbox',
        checked: settings.toolbarEnabled,
        onChange: (event: any) => update({ toolbarEnabled: Boolean(event.target.checked) }),
        style: { width: 18, height: 18, cursor: 'pointer' },
      }),
    ),
    createElement('p', { style: { ...MUTED, margin: '2px 0 0' } }, t.hint.replace('{n}', String(settings.topN))),
    createElement(
      'label',
      { style: { display: 'flex', alignItems: 'center', gap: 8, ...MUTED } },
      t.topN,
      createElement(
        'select',
        {
          value: settings.topN,
          onChange: (event: any) => update({ topN: Number(event.target.value) }),
          style: { padding: '2px 6px', borderRadius: 6 },
        },
        Array.from({ length: MAX_TOP_N }, (_, index) => index + 1).map((value) => createElement('option', { key: value, value }, String(value))),
      ),
    ),
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 10, ...MUTED } },
      createElement('span', { style: { minWidth: '6em' } }, t.timeout),
      createElement('input', {
        type: 'range',
        min: 2,
        max: 30,
        step: 1,
        value: Math.round(settings.menuTimeoutMs / 1000),
        onChange: (event: any) => update({ menuTimeoutMs: Math.max(2, Number(event.target.value)) * 1000 }),
        style: { flex: 1, maxWidth: 220 },
      }),
      createElement('span', { style: { minWidth: '3.5em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, Math.round(settings.menuTimeoutMs / 1000) + ' s'),
    ),
    createElement('p', { style: { ...MUTED, margin: 0 } }, t.timeoutHint),
    createElement(
      'label',
      { style: { display: 'flex', alignItems: 'center', gap: 10, ...MUTED, flexWrap: 'wrap' } },
      createElement('span', { style: { minWidth: '6em' } }, t.searchUrl),
      createElement('input', {
        type: 'url',
        value: searchDraft,
        spellCheck: false,
        placeholder: 'https://metaso.cn/?q=%s',
        onChange: (event: any) => setSearchDraft(String(event.target.value)),
        onBlur: () => update({ searchUrl: searchDraft }),
        onKeyDown: (event: any) => {
          if (event.key === 'Enter') update({ searchUrl: searchDraft })
        },
        style: {
          flex: 1,
          minWidth: 260,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid var(--dsh-color-border-subtle, rgba(0,0,0,0.12))',
          fontSize: 13,
        },
      }),
    ),
    createElement('p', { style: { ...MUTED, margin: 0 } }, t.searchUrlHint),
    createElement(
      'label',
      { style: { display: 'flex', alignItems: 'center', gap: 10, ...MUTED } },
      createElement('span', { style: { minWidth: '6em' } }, t.searchOpen),
      createElement(
        'select',
        {
          value: settings.searchOpen,
          onChange: (event: any) => update({ searchOpen: event.target.value === 'ego' ? 'ego' : 'system' }),
          style: { padding: '4px 8px', borderRadius: 6 },
        },
        createElement('option', { value: 'system' }, t.searchOpenSystem),
        createElement('option', { value: 'ego' }, t.searchOpenEgo),
      ),
      settings.searchOpen === 'ego'
        ? createElement('input', {
            type: 'text',
            value: settings.egoPath,
            spellCheck: false,
            placeholder: t.egoPathPlaceholder,
            onChange: (event: any) => update({ egoPath: String(event.target.value) }),
            style: {
              flex: 1,
              minWidth: 240,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--dsh-color-border-subtle, rgba(0,0,0,0.12))',
              fontSize: 13,
            },
          })
        : null,
    ),
    settings.searchOpen === 'ego' ? createElement('p', { style: { ...MUTED, margin: 0 } }, t.egoPathHint) : null,
    skills.map(row),
    editor,
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => setEditing(blankSkill()),
        style: { ...CARD, justifyContent: 'center', cursor: 'pointer', color: 'var(--dsh-color-accent, #2f63e0)', background: 'transparent', borderStyle: 'dashed' },
      },
      '+ ' + t.add,
    ),
  )
}
