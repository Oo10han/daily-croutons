import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiaryStore, validateDate } from '../src/main/database'

test('拆分后的校验与备份解析保留四模块合并和旧版兼容规则', () => {
  const source = new DiaryStore(':memory:'), target = new DiaryStore(':memory:')
  try {
    const date = '2024-02-29'
    source.save({ date, title: '备份日记', body: '', mood: '' })
    source.saveTransaction({ date, type: 'expense', amountCents: 1234, category: '餐饮', note: '' })
    source.saveMeal({ date, slot: '早餐', food: '面包', note: '' })
    source.saveWeight({ date, grams: 60120, note: '' })
    const backup = source.backup()
    const expected = { diaries: 1, transactions: 1, meals: 1, weights: 1 }
    assert.deepEqual(target.restore(backup), expected)
    assert.deepEqual(target.restore(backup), expected)
    assert.equal(target.listTransactions('2024-02').length, 1)
    assert.deepEqual(target.listHealth('2024-02'), source.listHealth('2024-02'))

    // 最后一个模块无效时，前面已经通过校验的日记也不能写入。
    const invalid = structuredClone(backup)
    invalid.diaries[0].title = '不得部分恢复'
    invalid.weights[0].grams = 60121
    assert.throws(() => target.restore(invalid), /体重/)
    assert.equal(target.get(date)?.title, '备份日记')
    assert.throws(() => target.saveTransaction({ ...backup.transactions[0], amountCents: 1.5 }), /整数分/)

    const { meals, weights, transactions, ...diaryBackup } = backup
    assert.deepEqual(target.restore({ ...diaryBackup, version: 1 }), { diaries: 1, transactions: 0, meals: 0, weights: 0 })
    assert.deepEqual(target.restore({ ...diaryBackup, transactions, version: 2 }), { diaries: 1, transactions: 1, meals: 0, weights: 0 })
    assert.equal(target.listTransactions('2024-02').length, 1)
    assert.deepEqual(target.listHealth('2024-02'), { meals, weights })
  } finally { source.close(); target.close() }
})

test('日记在数据库关闭重开后保留；同日更新不产生重复记录', () => {
  const dir = mkdtempSync(join(tmpdir(), 'little-days-db-'))
  let store = new DiaryStore(join(dir, 'test.sqlite'))
  try {
    const input = { date: '2026-09-17', title: '今天', body: "中文与 emoji 🌿\n' DROP TABLE diaries; --", mood: '平静' }
    store.save(input); store.save({ ...input, title: '修改后的标题' }); store.close()
    store = new DiaryStore(join(dir, 'test.sqlite'))
    assert.equal(store.list().length, 1)
    assert.equal(store.get(input.date)?.body, input.body)
    assert.equal(store.get(input.date)?.title, '修改后的标题')
    assert.equal(store.get('2026-09-18'), null)
  } finally { store.close(); rmSync(dir, { recursive: true }) }
})
test('备份合并覆盖同日，保留其他日期；无效备份不能部分写入', () => {
  const source = new DiaryStore(':memory:'), target = new DiaryStore(':memory:')
  try {
    source.save({ date: '2024-02-29', title: '备份', body: '内容', mood: '' })
    target.save({ date: '2024-02-29', title: '旧内容', body: '', mood: '' })
    target.save({ date: '2024-03-01', title: '保留', body: '', mood: '' })
    assert.deepEqual(target.restore(JSON.parse(JSON.stringify(source.backup()))), { diaries: 1, transactions: 0, meals: 0, weights: 0 })
    assert.equal(target.get('2024-02-29')?.title, '备份')
    assert.equal(target.get('2024-03-01')?.title, '保留')
    const bad = source.backup()
    bad.diaries[0].title = '不得写入'
    bad.diaries.push({ ...bad.diaries[0], date: '2025-02-29' })
    assert.throws(() => target.restore(bad))
    assert.equal(target.get('2024-02-29')?.title, '备份')
    target.remove('2024-02-29')
    assert.equal(target.get('2024-02-29'), null)
  } finally { source.close(); target.close() }
})
test('拒绝无效日期、过长正文、错误心情及重复日期备份', () => {
  for (const date of ['2025-02-29','2026-04-31','../test','0099-01-01']) assert.throws(() => validateDate(date))
  const store = new DiaryStore(':memory:')
  try {
    assert.throws(() => store.save({ date: '2026-09-17', title: '', body: 'x'.repeat(100001), mood: '' }))
    assert.throws(() => store.save({ date: '2026-09-17', title: '', body: '', mood: 'bad' }))
    store.save({ date: '2026-09-17', title: '', body: '', mood: '' })
    const backup = store.backup(); backup.diaries.push(backup.diaries[0])
    assert.throws(() => store.restore(backup))
  } finally { store.close() }
})
