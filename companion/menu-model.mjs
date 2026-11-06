/**
 * 划词浮条的纯几何模型：把「技能列表」投影成能画、能点的两份布局。
 *
 * 这里刻意不碰任何 Win32 / GDI+：宽度估算、换行、溢出拆分的规则全在这里，
 * 绘制（ui.mjs）与命中（main.mjs）都吃同一份结果，避免"画在一处、点偏一格"。
 *
 * 设计尺寸一律 DIP（=CSS px），绘制时由调用方乘缩放。
 */

/** 浮条常量（DIP）。 */
export const BAR = {
  padding: 4,
  height: 36,
  radius: 10,
  icon: 14,
  gap: 4,
  minSegment: 64,
  /** 图标左右各留的白。 */
  segmentInset: 12,
  /** 「更多」段的固定宽度。 */
  moreWidth: 40,
}

/** 下拉列表常量（DIP）。 */
export const LIST = {
  padding: 6,
  rowHeight: 32,
  minWidth: 168,
  maxWidth: 260,
  icon: 14,
  gap: 8,
  inset: 10,
}

/**
 * 估一段文字在 13px 下的宽度。
 *
 * 不引入字体度量：中/日/韩字符按全角、其余按半角估。误差在一两个像素内，
 * 而每个段都留有 `segmentInset` 的余量，估算偏小也不会把字裁掉。
 * @param {string} text - 段标签。
 * @param {number} [size=13] - 字号（DIP）。
 * @returns {number} 估算宽度（DIP）。
 */
export function estimateTextWidth(text, size = 13) {
  let units = 0
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0) ?? 0
    // 全角：CJK、假名、谚文、全角标点
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    // 全角按 1.06 个字宽估：GDI+ 的中文字面比字号略宽，按 1.0 算会差出一两个像素，
    // 表现为「复制」被截成「复…」（实测 1.25 缩放下会）。
    units += wide ? 1.06 : 0.56
  }
  return units * size
}

/**
 * 一个技能段的宽度（DIP）：图标 + 间距 + 文字 + 左右留白。
 * @param {{name: string}} skill - 技能（只需 name）。
 * @returns {number} 段宽。
 */
export function segmentWidth(skill) {
  const text = estimateTextWidth(skill?.name ?? '')
  // +2 是四舍五入的余量：宁可每段宽两像素，也不要文字被 GDI+ 截成省略号。
  return Math.max(BAR.minSegment, Math.round(BAR.icon + BAR.gap + text + BAR.segmentInset * 2 + 2))
}

/** 「更多」段的宽度：按同样规则算，别用固定 40（中文「更多」两个全角字放不下）。 */
export function moreSegmentWidth() {
  return segmentWidth({ name: '更多' })
}

/**
 * 把技能拆成「浮条上的」与「更多里的」。
 *
 * 浮条最多放 `topN` 个；多出来的（含浮条装不下而回退的）进溢出列表。
 * 如果溢出列表非空，占一个「更多」段——所以实际常驻项是 `topN - 1`。
 *
 * @param {Array<{id: string, name: string, icon?: string}>} skills - 已启用、已排序的技能。
 * @param {number} topN - 浮条上最多显示几个（含「更多」）。
 * @param {number} [maxWidth] - 浮条可用宽度（DIP）；缺省不限制。
 * @returns {{bar: Array<object>, overflow: Array<object>}} 两份列表。
 */
export function splitSkills(skills, topN, maxWidth) {
  const list = Array.isArray(skills) ? skills.filter((skill) => skill !== null && typeof skill === 'object') : []
  const limit = Math.max(1, Math.min(8, Math.round(Number(topN) || 5)))
  const total = list.length
  // 装得下就全放浮条；装不下时最后一个位置让给「更多」（所以常驻只有 limit-1 个）。
  const count = total <= limit ? total : limit - 1
  let bar = list.slice(0, count)
  let overflow = list.slice(bar.length)

  const widthOf = (items) =>
    BAR.padding * 2 + items.reduce((sum, item) => sum + segmentWidth(item), 0) + (items.length < total ? moreSegmentWidth() : 0)

  // 宽度不够就继续往溢出里挪，但至少留一个常驻项（否则浮条会变成一根「更多」）。
  if (typeof maxWidth === 'number' && Number.isFinite(maxWidth) && maxWidth > 0) {
    while (bar.length > 1 && widthOf(bar) > maxWidth) {
      overflow = [bar[bar.length - 1], ...overflow]
      bar = bar.slice(0, -1)
    }
  }
  return { bar, overflow }
}

/**
 * 浮条布局。
 * @param {Array<object>} bar - 常驻技能。
 * @param {boolean} hasOverflow - 是否需要「更多」段。
 * @returns {{width: number, height: number, segments: Array<{kind: string, index: number, id: string, label: string, icon: string, x: number, width: number}>}}
 *   `segments` 里 `kind` 为 `skill` 或 `more`；`index` 是浮条序号（-1 表示「更多」）。
 */
export function layoutBar(bar, hasOverflow) {
  const segments = []
  let x = BAR.padding
  for (let i = 0; i < bar.length; i += 1) {
    const skill = bar[i]
    const width = segmentWidth(skill)
    segments.push({ kind: 'skill', index: i, id: String(skill.id ?? ''), label: String(skill.name ?? ''), icon: String(skill.icon ?? 'sparkle'), x, width })
    x += width
  }
  if (hasOverflow) {
    segments.push({ kind: 'more', index: -1, id: '__more', label: '更多', icon: 'more', x, width: moreSegmentWidth() })
    x += moreSegmentWidth()
  }
  return { width: x + BAR.padding, height: BAR.height, segments }
}

/**
 * 浮条命中：DIP 坐标 → 段下标。
 * @param {{segments: Array<object>}} layout - `layoutBar` 的结果。
 * @param {number} x - 相对窗口的 X（DIP）。
 * @param {number} y - 相对窗口的 Y（DIP）。
 * @returns {number} 段下标；不在任何段上返回 -1。
 */
export function hitBar(layout, x, y) {
  if (y < BAR.padding || y > BAR.height - BAR.padding) return -1
  const segments = layout?.segments ?? []
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (x >= segment.x && x < segment.x + segment.width) return i
  }
  return -1
}

/**
 * 下拉列表布局：竖排，宽度按最长标签算。
 * @param {Array<object>} items - 溢出技能。
 * @returns {{width: number, height: number, rows: Array<{index: number, id: string, label: string, icon: string, y: number, height: number}>}}
 */
export function layoutList(items) {
  const list = Array.isArray(items) ? items : []
  const widest = list.reduce((max, item) => Math.max(max, estimateTextWidth(item?.name ?? '')), 0)
  const width = Math.max(LIST.minWidth, Math.min(LIST.maxWidth, Math.round(widest + LIST.icon + LIST.gap + LIST.inset * 2)))
  const rows = list.map((item, index) => ({
    index,
    id: String(item.id ?? ''),
    label: String(item.name ?? ''),
    icon: String(item.icon ?? 'sparkle'),
    y: LIST.padding + index * LIST.rowHeight,
    height: LIST.rowHeight,
  }))
  return { width, height: LIST.padding * 2 + rows.length * LIST.rowHeight, rows }
}

/**
 * 下拉列表命中。
 * @param {{rows: Array<object>}} layout - `layoutList` 的结果。
 * @param {number} x - 相对窗口的 X（DIP）。
 * @param {number} y - 相对窗口的 Y（DIP）。
 * @returns {number} 行下标；不在任何行上返回 -1。
 */
export function hitList(layout, x, y) {
  const rows = layout?.rows ?? []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (x >= 0 && x <= layout.width && y >= row.y && y < row.y + row.height) return i
  }
  return -1
}

/**
 * 浮条在锚点附近的放置：优先右下，越界就往回收，保证整条落在工作区内。
 * @param {{x: number, y: number, width: number, height: number}} work - 工作区（物理像素）。
 * @param {number} anchorX - 锚点 X（物理像素）。
 * @param {number} anchorY - 锚点 Y（物理像素）。
 * @param {number} width - 浮条宽（物理像素）。
 * @param {number} height - 浮条高（物理像素）。
 * @param {number} [gap=8] - 与锚点的间距（物理像素）。
 * @returns {{x: number, y: number}} 左上角（物理像素）。
 */
export function placeBar(work, anchorX, anchorY, width, height, gap = 8) {
  const x = Math.min(Math.max(anchorX + gap, work.left), Math.max(work.left, work.right - width))
  const y = Math.min(Math.max(anchorY + gap, work.top), Math.max(work.top, work.bottom - height))
  return { x: Math.round(x), y: Math.round(y) }
}

/**
 * 下拉列表相对浮条的放置：贴在浮条下沿、与「更多」段左对齐；下方放不下就翻到上方。
 * @param {{x: number, y: number, width: number, height: number}} barRect - 浮条矩形（物理像素）。
 * @param {{width: number, height: number}} listSize - 列表尺寸（物理像素）。
 * @param {{x: number, y: number, width: number, height: number}} work - 工作区（物理像素）。
 * @returns {{x: number, y: number}} 左上角（物理像素）。
 */
export function placeList(barRect, listSize, work) {
  const below = barRect.y + barRect.height + 4
  const above = barRect.y - listSize.height - 4
  const y = below + listSize.height <= work.bottom ? below : Math.max(work.top, above)
  const x = Math.min(Math.max(barRect.x, work.left), Math.max(work.left, work.right - listSize.width))
  return { x: Math.round(x), y: Math.round(y) }
}

/**
 * 「更多」下拉的放置：默认与「更多」段左对齐；右边放不下就右对齐到该段，再放不下才贴屏幕边。
 *
 * 为什么不从浮条最左边展开：浮条可能有 400+ DIP 宽，下拉挂在最左边会离按钮一屏远，
 * 看起来像另一个控件（实测预览里就是这样）。
 *
 * @param {{x: number, y: number, width: number, height: number}} barRect - 浮条矩形（物理像素）。
 * @param {{x: number, width: number}} moreSegment - 「更多」段（DIP，相对浮条）。
 * @param {number} scale - 显示器缩放。
 * @param {{width: number, height: number}} listSize - 列表尺寸（物理像素）。
 * @param {{x: number, y: number, width: number, height: number}} work - 工作区（物理像素）。
 * @returns {{x: number, y: number}} 左上角（物理像素）。
 */
export function placeListForMore(barRect, moreSegment, scale, listSize, work) {
  const moreLeft = barRect.x + Math.round((moreSegment?.x ?? 0) * scale)
  const moreRight = moreLeft + Math.round((moreSegment?.width ?? 0) * scale)
  let x = moreLeft
  if (x + listSize.width > work.right - 4) x = moreRight - listSize.width
  x = Math.min(Math.max(x, work.left + 4), Math.max(work.left, work.right - listSize.width - 4))
  const below = barRect.y + barRect.height + 4
  const above = barRect.y - listSize.height - 4
  const y = below + listSize.height <= work.bottom ? below : Math.max(work.top, above)
  return { x: Math.round(x), y: Math.round(y) }
}
