export const moods = ['', '开心', '平静', '疲惫', '低落', '充实'] as const
export type Mood = typeof moods[number]
// 持久化日期使用真实的 YYYY-MM-DD；日记和体重都以日期作为唯一键。
export interface Diary { date: string; title: string; body: string; mood: Mood; updatedAt: string }
export type DiaryInput = Omit<Diary, 'updatedAt'>
export interface DiarySummary { date: string; title: string; mood: Mood }
export type TransactionType = 'expense' | 'income'
// 金额使用整数分；新建时省略 id，由主进程分配，编辑时必须传入已存在的 id。
export interface TransactionInput { date: string; type: TransactionType; amountCents: number; category: string; note: string; id?: string }
export interface Transaction extends Omit<TransactionInput, 'id'> { id: string; createdAt: string; updatedAt: string }
export const mealSlots = ['早餐', '午餐', '晚餐', '加餐'] as const
export type MealSlot = typeof mealSlots[number]
export interface MealInput { id?: string; date: string; slot: MealSlot; food: string; note: string }
export interface Meal extends Omit<MealInput, 'id'> { id: string; createdAt: string; updatedAt: string }
// 体重保存整数克，精度为 10 克（0.01 kg）；同一天再次保存会覆盖该日记录。
export interface WeightInput { date: string; grams: number; note: string }
export interface Weight extends WeightInput { updatedAt: string }
export interface HealthMonth { meals: Meal[]; weights: Weight[] }
export interface RestoreResult { diaries: number; transactions: number; meals: number; weights: number }
export interface Backup { format: 'little-days'; version: 3; exportedAt: string; diaries: Diary[]; transactions: Transaction[]; meals: Meal[]; weights: Weight[] }
// renderer 的唯一持久化入口。类型用于开发期约束，主进程仍须校验所有外部输入。
export interface JournalAPI {
  get(date: string): Promise<Diary | null>
  list(): Promise<DiarySummary[]>
  save(input: DiaryInput): Promise<Diary>
  remove(date: string): Promise<void>
  exportBackup(): Promise<boolean>
  /** 用户取消返回 null；成功返回本次合并的记录数，而非数据库总量。 */
  importBackup(): Promise<RestoreResult | null>
  transactions: {
    list(month: string): Promise<Transaction[]>
    save(input: TransactionInput): Promise<Transaction>
    remove(id: string): Promise<void>
    confirmDiscard(): Promise<boolean>
  }
  health: {
    list(month: string): Promise<HealthMonth>
    saveMeal(input: MealInput): Promise<Meal>
    removeMeal(id: string): Promise<void>
    saveWeight(input: WeightInput): Promise<Weight>
    removeWeight(date: string): Promise<void>
    confirmDiscard(): Promise<boolean>
  }
  /** 注册关闭前保存回调，返回解除订阅函数。 */
  onCloseRequest(callback: () => void): () => void
  /** 仅在保存与表单确认成功后调用，否则窗口应继续保持打开。 */
  closeReady(): void
}
