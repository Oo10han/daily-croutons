export const moods = ['', '开心', '平静', '疲惫', '低落', '充实'] as const
export type Mood = typeof moods[number]
export interface Diary { date: string; title: string; body: string; mood: Mood; updatedAt: string }
export type DiaryInput = Omit<Diary, 'updatedAt'>
export interface DiarySummary { date: string; title: string; mood: Mood }
export type TransactionType = 'expense' | 'income'
export interface TransactionInput { date: string; type: TransactionType; amountCents: number; category: string; note: string; id?: string }
export interface Transaction extends Omit<TransactionInput, 'id'> { id: string; createdAt: string; updatedAt: string }
export interface RestoreResult { diaries: number; transactions: number }
export interface Backup { format: 'little-days'; version: 2; exportedAt: string; diaries: Diary[]; transactions: Transaction[] }
export interface JournalAPI {
  get(date: string): Promise<Diary | null>
  list(): Promise<DiarySummary[]>
  save(input: DiaryInput): Promise<Diary>
  remove(date: string): Promise<void>
  exportBackup(): Promise<boolean>
  importBackup(): Promise<RestoreResult | null>
  transactions: {
    list(month: string): Promise<Transaction[]>
    save(input: TransactionInput): Promise<Transaction>
    remove(id: string): Promise<void>
    confirmDiscard(): Promise<boolean>
  }
  onCloseRequest(callback: () => void): () => void
  closeReady(): void
}
