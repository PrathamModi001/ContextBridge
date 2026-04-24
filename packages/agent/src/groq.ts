import Groq from 'groq-sdk'

const SMART_MODEL = process.env.DEFAULT_LLM ?? 'llama-3.1-70b-versatile'
const DUMB_MODEL  = process.env.COST_SAVING_LLM ?? 'llama-3.1-8b-instant'

export async function generateCode(
  systemPrompt: string,
  userTask: string,
  mode: 'smart' | 'dumb' = 'smart',
): Promise<string> {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const model = mode === 'smart' ? SMART_MODEL : DUMB_MODEL
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userTask },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  })
  return completion.choices[0]?.message?.content ?? ''
}

export function extractCodeBlock(response: string): string {
  const match = response.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/)
  return match ? match[1].trim() : response.trim()
}
