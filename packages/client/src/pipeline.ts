import fs from 'fs'
import { diffEntities } from './differ'
import { Entity, EntityDiff } from './types'
import { createLogger } from './logger'

const log = createLogger('pipeline')

export type DiffCallback = (filePath: string, diffs: EntityDiff[]) => void

export interface ParserLike {
  parse(filePath: string, source: string): Entity[]
  clearCache(filePath: string): void
}

export interface Pipeline {
  processFile(filePath: string): void
  clearFile(filePath: string): void
}

export function createPipeline(parser: ParserLike, onDiff: DiffCallback): Pipeline {
  const prevEntities = new Map<string, Entity[]>()

  return {
    processFile(filePath: string): void {
      let source: string
      try {
        source = fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        log.error({ err, filePath }, 'failed to read file')
        return
      }

      const next = parser.parse(filePath, source)
      const prev = prevEntities.get(filePath) ?? []
      const diffs = diffEntities(prev, next)
      prevEntities.set(filePath, next)

      if (diffs.length > 0) {
        log.info({ filePath, count: diffs.length }, 'entity diffs found')
        onDiff(filePath, diffs)
      }
    },

    clearFile(filePath: string): void {
      prevEntities.delete(filePath)
      parser.clearCache(filePath)
    },
  }
}
