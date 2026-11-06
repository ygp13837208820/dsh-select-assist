import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_PANEL_TIMEOUT_MS,
  PANEL_TIMEOUT_RANGE,
  loadPanelConfig,
  panelTimeoutFor,
} from '../companion/panel-config.mjs'

/** 造一个临时 DSH_HOME，写一份面板配置。 */
function withHome(contents) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-panel-'))
  if (contents !== undefined) writeFileSync(join(home, 'dsh-select-assist.panel.json'), contents, 'utf8')
  process.env.DSH_HOME = home
  delete process.env.DSH_SELECTION_PANEL_TIMEOUT_MS
  delete process.env.DSH_SELECTION_PANEL_AUTOCLOSE
  delete process.env.DSH_SELECTION_PANEL_OUTSIDE
  return home
}

test('没有配置文件时默认开启自动关闭（15 秒）', () => {
  withHome(undefined)
  const config = loadPanelConfig()
  assert.equal(config.autoClose, true)
  assert.equal(config.timeoutMs, DEFAULT_PANEL_TIMEOUT_MS)
  assert.equal(config.closeOnOutsideClick, true)
})

test('配置文件能关掉自动关闭，并夹取超时区间', () => {
  withHome(JSON.stringify({ autoClose: false, timeoutMs: 999999, closeOnOutsideClick: false }))
  const config = loadPanelConfig()
  assert.equal(config.autoClose, false)
  assert.equal(config.timeoutMs, PANEL_TIMEOUT_RANGE.max)
  assert.equal(config.closeOnOutsideClick, false)

  withHome(JSON.stringify({ timeoutMs: 10 }))
  assert.equal(loadPanelConfig().timeoutMs, PANEL_TIMEOUT_RANGE.min)
})

test('坏 JSON / BOM 不会让配置整份失效', () => {
  withHome('\uFEFF' + JSON.stringify({ autoClose: false, timeoutMs: 20000 }))
  assert.equal(loadPanelConfig().autoClose, false)
  assert.equal(loadPanelConfig().timeoutMs, 20000)

  withHome('{ not json')
  assert.equal(loadPanelConfig().autoClose, true)
})

test('环境变量优先于文件（排障用）', () => {
  withHome(JSON.stringify({ autoClose: true, timeoutMs: 20000 }))
  process.env.DSH_SELECTION_PANEL_TIMEOUT_MS = '8000'
  process.env.DSH_SELECTION_PANEL_AUTOCLOSE = '0'
  const config = loadPanelConfig()
  assert.equal(config.timeoutMs, 8000)
  assert.equal(config.autoClose, false)
})

test('长回答按字数放宽停留时长，且不超过上限', () => {
  const base = 15000
  assert.equal(panelTimeoutFor(base, 0), base)
  assert.equal(panelTimeoutFor(base, 100), base + 1500)
  assert.equal(panelTimeoutFor(base, 100000), base + 15000, '放宽最多加 15 秒')
  assert.ok(panelTimeoutFor(base, 100000) <= PANEL_TIMEOUT_RANGE.max)
  assert.equal(panelTimeoutFor(base, 10), base + 150)
})
