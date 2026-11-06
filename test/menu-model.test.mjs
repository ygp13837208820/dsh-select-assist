import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BAR,
  LIST,
  estimateTextWidth,
  hitBar,
  hitList,
  layoutBar,
  layoutList,
  moreSegmentWidth,
  placeBar,
  placeList,
  placeListForMore,
  segmentWidth,
  splitSkills,
} from '../companion/menu-model.mjs'

const skill = (id, name, icon = 'sparkle') => ({ id, name, icon })

test('中文比英文宽：全角按一个字宽算', () => {
  assert.ok(estimateTextWidth('翻译') > estimateTextWidth('ab'))
  // 两个全角字 ≈ 2 × 字号（给 GDI+ 字面宽度留 6% 余量，误差不超过 3px）
  assert.ok(Math.abs(estimateTextWidth('翻译') - 26) <= 3, String(estimateTextWidth('翻译')))
})

test('段宽不小于下限，且随文字变长', () => {
  assert.equal(segmentWidth(skill('a', '嗯')), BAR.minSegment)
  assert.ok(segmentWidth(skill('a', '优化提示词')) > BAR.minSegment)
})

test('不超过 topN 时不拆溢出', () => {
  const items = [skill('a', '甲'), skill('b', '乙'), skill('c', '丙')]
  const { bar, overflow } = splitSkills(items, 5)
  assert.equal(bar.length, 3)
  assert.equal(overflow.length, 0)
})

test('超过 topN 时最后一个位置让给「更多」', () => {
  const items = Array.from({ length: 8 }, (_, i) => skill(`s${i}`, `技能${i}`))
  const { bar, overflow } = splitSkills(items, 5)
  assert.equal(bar.length, 4)
  assert.equal(overflow.length, 4)
  assert.deepEqual(overflow.map((s) => s.id), ['s4', 's5', 's6', 's7'])
})

test('宽度不够时继续往溢出里挪，但至少留一个常驻', () => {
  const items = Array.from({ length: 8 }, (_, i) => skill(`s${i}`, '一个很长很长的技能名'))
  const narrow = splitSkills(items, 8, 200)
  assert.equal(narrow.bar.length, 1)
  assert.equal(narrow.overflow.length, 7)
})

test('浮条布局：段从左往右排，「更多」在末尾', () => {
  const { bar, overflow } = splitSkills(
    [skill('a', 'AI 搜索'), skill('b', '复制'), skill('c', '翻译'), skill('d', '优化提示词'), skill('e', '解释'), skill('f', '优化搜索词')],
    5,
  )
  const layout = layoutBar(bar, overflow.length > 0)
  assert.equal(layout.segments.length, 5)
  assert.equal(layout.segments[4].kind, 'more')
  assert.equal(layout.segments[0].x, BAR.padding)
  for (let i = 1; i < layout.segments.length; i += 1) {
    const prev = layout.segments[i - 1]
    assert.equal(layout.segments[i].x, prev.x + prev.width)
  }
  assert.equal(layout.width, layout.segments[3].x + layout.segments[3].width + moreSegmentWidth() + BAR.padding)
  assert.equal(layout.height, BAR.height)
})

test('浮条命中：段内返回下标，段外与上下留白返回 -1', () => {
  const layout = layoutBar([skill('a', '复制'), skill('b', '翻译')], false)
  const first = layout.segments[0]
  assert.equal(hitBar(layout, first.x + 2, BAR.height / 2), 0)
  assert.equal(hitBar(layout, first.x + first.width + 1, BAR.height / 2), 1)
  assert.equal(hitBar(layout, first.x + 2, 1), -1)
  assert.equal(hitBar(layout, layout.width + 10, BAR.height / 2), -1)
})

test('下拉列表布局：竖排、行高一致、宽度夹在区间内', () => {
  const layout = layoutList([skill('a', '优化提示词'), skill('b', '优化搜索词')])
  assert.equal(layout.rows.length, 2)
  assert.equal(layout.rows[0].y, LIST.padding)
  assert.equal(layout.rows[1].y, LIST.padding + LIST.rowHeight)
  assert.equal(layout.height, LIST.padding * 2 + LIST.rowHeight * 2)
  assert.ok(layout.width >= LIST.minWidth && layout.width <= LIST.maxWidth)
})

test('下拉列表命中：行内返回下标', () => {
  const layout = layoutList([skill('a', '甲'), skill('b', '乙')])
  assert.equal(hitList(layout, 10, layout.rows[0].y + 4), 0)
  assert.equal(hitList(layout, 10, layout.rows[1].y + 4), 1)
  assert.equal(hitList(layout, 10, 1), -1)
})

test('浮条放置：锚点右下优先，越界回收到工作区内', () => {
  const work = { left: 0, top: 0, right: 1000, bottom: 800 }
  assert.deepEqual(placeBar(work, 100, 100, 300, 36), { x: 108, y: 108 })
  assert.deepEqual(placeBar(work, 950, 780, 300, 36), { x: 700, y: 764 })
})

test('下拉放置：下方放得下就贴下沿，否则翻到上方', () => {
  const work = { left: 0, top: 0, right: 1000, bottom: 800 }
  const bar = { x: 100, y: 100, width: 300, height: 36 }
  assert.deepEqual(placeList(bar, { width: 180, height: 120 }, work), { x: 100, y: 140 })
  const low = { x: 100, y: 760, width: 300, height: 36 }
  assert.deepEqual(placeList(low, { width: 180, height: 120 }, work), { x: 100, y: 636 })
})

test('「更多」下拉挂在按钮下面，靠右放不下就右对齐', () => {
  const work = { left: 0, top: 0, right: 1000, bottom: 800 }
  const bar = { x: 100, y: 100, width: 430, height: 36 }
  const more = { x: 380, width: 46 }
  // 左侧空间足够：与按钮左对齐
  assert.deepEqual(placeListForMore(bar, more, 1, { width: 180, height: 120 }, work), { x: 480, y: 140 })
  // 按钮贴着右边界：右对齐到按钮右沿（980 - 180 = 800），不越界
  const nearEdge = { x: 700, y: 100, width: 280, height: 36 }
  const placed = placeListForMore(nearEdge, { x: 234, width: 46 }, 1, { width: 180, height: 120 }, work)
  assert.equal(placed.x, 800)
  assert.ok(placed.x + 180 <= work.right)
})
