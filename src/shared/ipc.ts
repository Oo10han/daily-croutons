import type { JournalAPI } from './types'

// 通道映射引用业务 API 签名，使 main 与 preload 的参数和返回值一起接受类型检查。
// 新增接口时同步维护 types.ts、此映射、preload 的业务方法和 main 的处理器。
export interface InvokeApi {
  'diary:get': JournalAPI['get']
  'diary:list': JournalAPI['list']
  'diary:save': JournalAPI['save']
  'diary:remove': JournalAPI['remove']
  'backup:export': JournalAPI['exportBackup']
  'backup:import': JournalAPI['importBackup']
  'transactions:list': JournalAPI['transactions']['list']
  'transactions:save': JournalAPI['transactions']['save']
  'transactions:remove': JournalAPI['transactions']['remove']
  'transactions:confirm-discard': JournalAPI['transactions']['confirmDiscard']
  'health:list': JournalAPI['health']['list']
  'health:save-meal': JournalAPI['health']['saveMeal']
  'health:remove-meal': JournalAPI['health']['removeMeal']
  'health:save-weight': JournalAPI['health']['saveWeight']
  'health:remove-weight': JournalAPI['health']['removeWeight']
  'health:confirm-discard': JournalAPI['health']['confirmDiscard']
}

export type InvokeChannel = keyof InvokeApi
export type InvokeArgs<C extends InvokeChannel> = Parameters<InvokeApi[C]>
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<InvokeApi[C]>>

// 关闭使用单向事件握手，其余业务调用均使用 invoke/handle。
export const appEvents = {
  closeRequest: 'app:close-request',
  closeReady: 'app:close-ready'
} as const
