declare module 'expo-sqlite' {
  export interface SQLiteDatabase {
    execAsync(source: string): Promise<void>
    getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>
    getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>
    runAsync(source: string, ...params: unknown[]): Promise<unknown>
    withExclusiveTransactionAsync(task: (transaction: SQLiteDatabase) => Promise<void>): Promise<void>
  }

  export function openDatabaseAsync(databaseName: string): Promise<SQLiteDatabase>
}
