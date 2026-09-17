import type { JobLogEntry } from '@shared/types'

export class JobLogger {
  private entries: JobLogEntry[] = []

  info(message: string, itemName?: string): void {
    this.push('info', message, itemName)
  }

  warn(message: string, itemName?: string): void {
    this.push('warn', message, itemName)
  }

  error(message: string, itemName?: string): void {
    this.push('error', message, itemName)
  }

  private push(level: JobLogEntry['level'], message: string, itemName?: string): void {
    this.entries.push({ level, message, itemName, timestamp: new Date().toISOString() })
  }

  getEntries(): JobLogEntry[] {
    return this.entries.slice()
  }

  toText(): string {
    return this.entries
      .map((e) => `[${e.timestamp}] ${e.level.toUpperCase()}${e.itemName ? ` (${e.itemName})` : ''}: ${e.message}`)
      .join('\n')
  }
}
