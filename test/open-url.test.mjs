import assert from 'node:assert/strict'
import test from 'node:test'

import { egoCandidates, openUrl, resolveEgoExe } from '../companion/open-url.mjs'

const ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }
const EGO = 'C:\\Program Files\\Citro Labs\\ego lite\\Application\\ego.exe'

test('候选路径按 Program Files → x86 → LocalAppData 排列', () => {
  const list = egoCandidates({ ...ENV, 'ProgramFiles(x86)': 'C:\\Program Files (x86)' })
  assert.equal(list[0], EGO)
  assert.equal(list[1], 'C:\\Program Files (x86)\\Citro Labs\\ego lite\\Application\\ego.exe')
  assert.equal(list[2], 'C:\\Users\\x\\AppData\\Local\\Programs\\ego lite\\Application\\ego.exe')
})

test('自定义路径优先，且必须真实存在', () => {
  const exists = (p) => p === 'D:\\tools\\ego.exe'
  assert.equal(resolveEgoExe({ egoPath: 'D:\\tools\\ego.exe', exists, env: ENV }), 'D:\\tools\\ego.exe')
  assert.equal(resolveEgoExe({ egoPath: 'D:\\nope.exe', exists, env: ENV }), null)
})

test('没装 ego 时返回 null', () => {
  assert.equal(resolveEgoExe({ exists: () => false, env: ENV }), null)
})

test('ego 模式：找到就用它打开，参数是 URL，且不阻塞', () => {
  const calls = []
  const spawnFn = (exe, args, options) => {
    calls.push({ exe, args, options })
    return { unref() {} }
  }
  const result = openUrl('https://metaso.cn/?q=hi', {
    mode: 'ego',
    exists: () => true,
    env: ENV,
    spawnFn,
    spawnSyncFn: () => {
      throw new Error('不该走系统默认')
    },
  })
  assert.deepEqual(result, { ok: true, via: 'ego', exe: EGO })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].exe, EGO)
  assert.deepEqual(calls[0].args, ['https://metaso.cn/?q=hi'])
  assert.equal(calls[0].options.detached, true)
})

test('ego 模式但找不到可执行文件：退回系统默认', () => {
  let spawned = null
  const result = openUrl('https://a.b', {
    mode: 'ego',
    exists: () => false,
    env: ENV,
    spawnFn: () => {
      throw new Error('不该调用')
    },
    spawnSyncFn: (exe, args) => {
      spawned = { exe, args }
      return { status: 0 }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.via, 'system')
  assert.equal(spawned.exe, 'rundll32.exe')
  assert.deepEqual(spawned.args, ['url.dll,FileProtocolHandler', 'https://a.b'])
})

test('系统模式直接走 rundll32', () => {
  let spawned = null
  const result = openUrl('https://a.b', {
    mode: 'system',
    spawnSyncFn: (exe, args) => {
      spawned = { exe, args }
      return { status: 0 }
    },
  })
  assert.equal(result.via, 'system')
  assert.equal(result.ok, true)
  assert.equal(spawned.exe, 'rundll32.exe')
})

test('空 URL 不打开任何东西', () => {
  const result = openUrl('', { spawnSyncFn: () => ({ status: 0 }) })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'empty-url')
})
