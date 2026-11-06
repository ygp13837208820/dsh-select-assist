/**
 * 预览探针（开发用）：把真实的划词浮条画到原生分层窗口里，抓屏存 BMP。
 *
 * 它不经过 DSH、也不启动伴生进程——只复用 `native/ui.mjs` 的绘制与 `menu-model.mjs`
 * 的布局，用来在装插件之前确认「段宽 / 浮条高度 / 下拉位置」。
 *
 * 用法：
 *   node scripts/preview.mjs <koffiDir> <out.bmp> [bar|list|combo] [skills.json]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { captureScreenRect } from '../companion/native/capture.mjs'
import { createGdi } from '../companion/native/gdi.mjs'
import { createNativeWindow } from '../companion/native/window.mjs'
import { layoutBar, layoutList, placeListForMore, splitSkills } from '../companion/menu-model.mjs'
import { paintMenu } from '../companion/native/ui.mjs'
import { createWin32, monitorScaleForPoint, workAreaForPoint } from '../companion/win32.mjs'

const koffiDir = process.argv[2]
const out = process.argv[3] ?? join(process.cwd(), 'preview.bmp')
const requested = process.argv[4] ?? 'bar'
const mode = requested === 'list' || requested === 'combo' ? requested : 'bar'
const skillsFile = process.argv[5]

const api = createWin32([koffiDir])
if (api === null) {
  console.log('koffi unavailable')
  process.exit(1)
}
const gdi = createGdi(api.koffi)
if (!gdi.startup()) {
  console.log('GdiplusStartup failed')
  process.exit(1)
}

const FALLBACK = [
  { id: 'builtin.search', name: 'AI 搜索', icon: 'search' },
  { id: 'builtin.copy', name: '复制', icon: 'copy' },
  { id: 'builtin.translate', name: '翻译', icon: 'globe' },
  { id: 'sk_a', name: '优化提示词', icon: 'wand' },
  { id: 'builtin.explain', name: '解释', icon: 'book' },
  { id: 'sk_b', name: '优化搜索词', icon: 'wand' },
]
const parsedFile = skillsFile === undefined ? null : JSON.parse(readFileSync(skillsFile, 'utf8'))
const skills = Array.isArray(parsedFile?.skills) ? parsedFile.skills.filter((skill) => skill?.enabled !== false) : FALLBACK
const topN = Number(parsedFile?.topN) > 0 ? Math.min(8, Math.round(Number(parsedFile.topN))) : 5
const split = splitSkills(skills, topN, 900)
const barLayout = layoutBar(split.bar, split.overflow.length > 0)
const listLayout = layoutList(split.overflow)

const anchorX = 300
const anchorY = 240
const scale = monitorScaleForPoint(api, anchorX, anchorY)
const work = workAreaForPoint(api, anchorX, anchorY)

/** 造一块"只会画、不交互"的预览窗口。 */
function makeWindow(layout, modeName, hover) {
  const win = createNativeWindow({
    api,
    gdi,
    title: 'dsh-skill-bar preview ' + modeName,
    initialState: { dark: true, hover, mode: modeName, layout },
    onPaint(painter, w, h, data, windowScale) {
      paintMenu(painter, w, h, data, windowScale)
    },
    onHitTest: () => 'client',
    onHover: () => false,
    onClick: () => false,
  })
  win.create()
  return win
}

const barW = Math.round(barLayout.width * scale)
const barH = Math.round(barLayout.height * scale)
const barX = Math.round(anchorX + 8)
const barY = Math.round(anchorY + 8)
const barRect = { x: barX, y: barY, width: barW, height: barH }

const barWindow = makeWindow(barLayout, 'bar', mode === 'list' ? -1 : 2)
barWindow.show(barX, barY, barW, barH)

const windows = [{ win: barWindow, rect: barRect }]

if (mode === 'list' || mode === 'combo') {
  const listW = Math.round(listLayout.width * scale)
  const listH = Math.round(listLayout.height * scale)
  const more = barLayout.segments.find((segment) => segment.kind === 'more')
  const placed = placeListForMore(barRect, more, scale, { width: listW, height: listH }, work)
  const listWindow = makeWindow(listLayout, 'list', 0)
  listWindow.show(placed.x, placed.y, listW, listH)
  windows.push({ win: listWindow, rect: { x: placed.x, y: placed.y, width: listW, height: listH } })
  console.log('list placed at ' + placed.x + ',' + placed.y + ' (' + listW + 'x' + listH + ')')
}

const left = Math.min(...windows.map((item) => item.rect.x))
const top = Math.min(...windows.map((item) => item.rect.y))
const right = Math.max(...windows.map((item) => item.rect.x + item.rect.width))
const bottom = Math.max(...windows.map((item) => item.rect.y + item.rect.height))
const shotRect = { x: left, y: top, width: right - left, height: bottom - top }

console.log('mode=' + mode + ' scale=' + scale + ' bar=' + barLayout.width + 'x' + barLayout.height + ' capture=' + shotRect.width + 'x' + shotRect.height)
await new Promise((resolve) => setTimeout(resolve, 900))
const shot = captureScreenRect(api, gdi, shotRect.x, shotRect.y, shotRect.width, shotRect.height, out)
console.log('captured ' + JSON.stringify(shot))
for (const item of windows) item.win.destroy()
gdi.shutdown()
process.exit(0)
