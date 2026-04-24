import type { ValidationResult } from './types'

export async function fetchContext(serverUrl: string): Promise<string> {
  const res = await fetch(`${serverUrl}/v1/context/snapshot?format=markdown`)
  if (!res.ok) throw new Error(`fetchContext failed: ${res.status} ${res.statusText}`)
  return res.text()
}

export async function validateUsage(serverUrl: string, code: string): Promise<ValidationResult> {
  const res = await fetch(`${serverUrl}/v1/context/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(`validateUsage failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<ValidationResult>
}
