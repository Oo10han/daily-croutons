import { DatabaseSync } from 'node:sqlite'
import { moods, type Diary, type DiaryInput, type Backup, type DiarySummary } from '../shared/types'

export function validateDate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') throw new Error('日期格式无效')
  const parsed = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('日期不存在')
}
export function validateDiary(input: unknown): DiaryInput {
  if (!input || typeof input !== 'object') throw new Error('日记格式无效')
  const d = input as DiaryInput
  validateDate(d.date)
  if (typeof d.title !== 'string' || d.title.length > 120) throw new Error('标题最多 120 字')
  if (typeof d.body !== 'string' || d.body.length > 100000) throw new Error('正文最多 100000 字')
  if (!moods.includes(d.mood)) throw new Error('心情无效')
  return { date: d.date, title: d.title, body: d.body, mood: d.mood }
}
export function parseBackup(input: unknown): Diary[] {
  if (!input || typeof input !== 'object') throw new Error('备份格式无效')
  const b = input as Backup
  if (b.format !== 'little-days' || b.version !== 1 || !Array.isArray(b.diaries) || b.diaries.length > 10000) throw new Error('不支持的备份格式或版本')
  const dates = new Set<string>()
  return b.diaries.map(item => {
    const d = validateDiary(item)
    if (dates.has(d.date)) throw new Error('备份包含重复日期')
    dates.add(d.date)
    if (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('备份时间无效')
    return { ...d, updatedAt: item.updatedAt }
  })
}
export class DiaryStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS diaries (
        date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        mood TEXT NOT NULL, updatedAt TEXT NOT NULL
      ); PRAGMA user_version=1;`)
  }
  get(date: string): Diary | null {
    validateDate(date)
    return this.db.prepare('SELECT * FROM diaries WHERE date=?').get(date) as unknown as Diary ?? null
  }
  list(): DiarySummary[] {
    return this.db.prepare('SELECT date,title,mood FROM diaries ORDER BY date DESC').all() as unknown as DiarySummary[]
  }
  private upsert(d: Diary) {
    this.db.prepare(`INSERT INTO diaries(date,title,body,mood,updatedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET title=excluded.title,body=excluded.body,mood=excluded.mood,updatedAt=excluded.updatedAt`)
      .run(d.date, d.title, d.body, d.mood, d.updatedAt)
  }
  save(input: unknown): Diary {
    const d = { ...validateDiary(input), updatedAt: new Date().toISOString() }
    this.upsert(d)
    return d
  }
  remove(date: string) {
    validateDate(date)
    this.db.prepare('DELETE FROM diaries WHERE date=?').run(date)
  }
  backup(): Backup {
    return { format: 'little-days', version: 1, exportedAt: new Date().toISOString(), diaries: this.db.prepare('SELECT * FROM diaries ORDER BY date').all() as unknown as Diary[] }
  }
  restore(input: unknown): number {
    const entries = parseBackup(input)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const d of entries) this.upsert(d)
      this.db.exec('COMMIT')
      return entries.length
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close() { this.db.close() }
}
