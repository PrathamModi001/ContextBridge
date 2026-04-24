import { generateCode, extractCodeBlock } from './groq'
import { fetchContext, validateUsage } from './context'
import { writeToWorkspace, inferFilename } from './workspace'
import type { AgentConfig } from './types'

const SMART_SYSTEM = (context: string) => `You are a TypeScript developer working on a shared codebase.

Here is the current live state of all entities across all developers:

${context}

CRITICAL RULES:
- Use the exact function signatures shown above — never call functions with wrong argument counts or types.
- Generate ONLY valid TypeScript code.
- Wrap your output in a single \`\`\`typescript code block.`

const DUMB_SYSTEM = `You are a TypeScript developer.
Generate clean, valid TypeScript code.
Wrap your output in a single \`\`\`typescript code block.`

export async function runAgent(config: AgentConfig): Promise<{ filename: string; code: string }> {
  const { dev, task, mode, serverUrl, workspace } = config
  console.log(`[${dev}] mode=${mode.toUpperCase()} task="${task}"`)

  let code: string

  if (mode === 'smart') {
    console.log(`[${dev}] Fetching live context...`)
    const context = await fetchContext(serverUrl)
    const systemPrompt = SMART_SYSTEM(context)

    console.log(`[${dev}] Generating with context (${process.env.DEFAULT_LLM ?? 'llama-3.1-70b-versatile'})...`)
    const raw = await generateCode(systemPrompt, task, 'smart')
    code = extractCodeBlock(raw)

    console.log(`[${dev}] Validating against live signatures...`)
    const { conflicts } = await validateUsage(serverUrl, code)

    if (conflicts.length > 0) {
      console.log(`[${dev}] ${conflicts.length} conflict(s) found — re-generating with corrections`)
      const corrections = conflicts.map(c =>
        `• ${c.entity}: you wrote \`${c.yourSignature}\` but live signature is \`${c.liveSignature}\`\n  Corrected: \`${c.correctedCall}\``
      ).join('\n')

      const correctedTask = `${task}

FIX THESE SIGNATURE MISMATCHES before writing code:
${corrections}

Use the corrected signatures above. Wrap output in a single \`\`\`typescript block.`

      const reRaw = await generateCode(systemPrompt, correctedTask, 'smart')
      code = extractCodeBlock(reRaw)

      const reValidation = await validateUsage(serverUrl, code)
      const remaining = reValidation?.conflicts ?? []
      if (remaining.length > 0) {
        console.warn(`[${dev}] ${remaining.length} conflict(s) remain after re-generation — proceeding with best effort`)
      } else {
        console.log(`[${dev}] Re-generation clean — no remaining conflicts`)
      }
    } else {
      console.log(`[${dev}] No conflicts — code is compatible with live state`)
    }
  } else {
    console.log(`[${dev}] Generating without context (${process.env.COST_SAVING_LLM ?? 'llama-3.1-8b-instant'})...`)
    const raw = await generateCode(DUMB_SYSTEM, task, 'dumb')
    code = extractCodeBlock(raw)
  }

  const filename = inferFilename(task)
  try {
    writeToWorkspace(workspace, filename, code)
    console.log(`[${dev}] Written → ${workspace}/${filename}`)
  } catch (err) {
    console.error(`[${dev}] Failed to write to workspace ${workspace}/${filename}:`, err)
    throw err
  }

  return { filename, code }
}
