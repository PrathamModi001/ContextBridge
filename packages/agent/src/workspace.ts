import fs from 'fs'
import path from 'path'

export function writeToWorkspace(workspace: string, filename: string, content: string): void {
  const resolvedWorkspace = path.resolve(workspace)
  const filePath = path.resolve(resolvedWorkspace, filename)
  const boundary = resolvedWorkspace.endsWith(path.sep) ? resolvedWorkspace : resolvedWorkspace + path.sep
  if (!filePath.startsWith(boundary)) {
    throw new Error(`Path traversal detected: filename escapes workspace boundary`)
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

export function readFromWorkspace(workspace: string, filename: string): string | null {
  const filePath = path.resolve(workspace, filename)
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

export function inferFilename(task: string): string {
  const match = task.match(/\b([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.ts)\b/)
  return match ? path.basename(match[1]) : 'generated.ts'
}
