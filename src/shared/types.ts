export const moods = ['', '开心', '平静', '疲惫', '低落', '充实'] as const
export type Mood = typeof moods[number]
export interface Diary { date: string; title: string; body: string; mood: Mood; updatedAt: string }
export type DiaryInput = Omit<Diary, 'updatedAt'>
export interface DiarySummary { date: string; title: string; mood: Mood }
export interface Backup { format: 'little-days'; version: 1; exportedAt: string; diaries: Diary[] }
export interface JournalAPI {
  get(date: string): Promise<Diary | null>
  list(): Promise<DiarySummary[]>
  save(input: DiaryInput): Promise<Diary>
  remove(date: string): Promise<void>
  exportBackup(): Promise<boolean>
  importBackup(): Promise<number | null>
  onCloseRequest(callback: () => void): () => void
  closeReady(): void
}
