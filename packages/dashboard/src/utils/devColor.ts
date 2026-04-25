const PALETTE = [
  '#f5a623', // amber
  '#21d4fd', // cyan
  '#b77bf3', // violet
  '#39d98a', // mint
  '#fd7e81', // salmon
  '#7eb9f8', // sky
  '#fca05e', // peach
  '#6ee7d8', // teal
]

export function devColor(devId: string): string {
  let h = 5381
  for (let i = 0; i < devId.length; i++) {
    h = (((h << 5) + h) ^ devId.charCodeAt(i)) >>> 0
  }
  return PALETTE[h % PALETTE.length]
}

export function devInitials(devId: string): string {
  const parts = devId.trim().split(/[-_\s.]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (devId.length >= 2) return devId.slice(0, 2).toUpperCase()
  return devId.toUpperCase()
}
