import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarCells, dateKey } from '../src/renderer/src/utils/calendar'

test('日历按周一排列六周，闰日和相邻月份标记一致', () => {
  const cells = calendarCells(new Date(2024, 1, 1))
  assert.equal(cells.length, 42)
  assert.equal(cells[0].key, '2024-01-29')
  assert.equal(cells[41].key, '2024-03-10')
  assert.equal(cells.filter(cell => !cell.outside).length, 29)
  assert.deepEqual(cells.find(cell => cell.key === '2024-02-29'), { key: '2024-02-29', day: 29, outside: false })
  assert.equal(new Set(cells.map(cell => cell.key)).size, 42)
})

test('周日开头的月份仍从前一个周一开始，跨年日期保留', () => {
  const cells = calendarCells(new Date(2023, 0, 1))
  assert.deepEqual(cells[0], { key: '2022-12-26', day: 26, outside: true })
  assert.deepEqual(cells[6], { key: '2023-01-01', day: 1, outside: false })
  assert.equal(cells.filter(cell => !cell.outside).length, 31)
})

test('本地午夜和深夜均使用当天的日期键', () => {
  assert.equal(dateKey(new Date(2026, 8, 29, 0, 1)), '2026-09-29')
  assert.equal(dateKey(new Date(2026, 8, 29, 23, 59)), '2026-09-29')
})
