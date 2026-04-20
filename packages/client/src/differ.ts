import { Entity, EntityDiff } from './types'

export function diffEntities(prev: Entity[], next: Entity[]): EntityDiff[] {
  const prevMap = new Map(prev.map((e) => [e.name, e]))
  const diffs: EntityDiff[] = []

  for (const entity of next) {
    const existing = prevMap.get(entity.name)

    if (!existing) {
      diffs.push({
        name: entity.name,
        kind: entity.kind,
        oldSig: null,
        newSig: entity.signature,
        body: entity.body,
        file: entity.file,
        line: entity.line,
      })
      continue
    }

    if (existing.signature !== entity.signature) {
      diffs.push({
        name: entity.name,
        kind: entity.kind,
        oldSig: existing.signature,
        newSig: entity.signature,
        body: entity.body,
        file: entity.file,
        line: entity.line,
      })
    }
  }

  return diffs
}
