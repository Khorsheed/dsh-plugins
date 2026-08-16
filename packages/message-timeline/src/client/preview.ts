/**
 * Pure text extraction for the timeline panel rows: user message content is a
 * block list (text, image, …); the preview concatenates the text blocks so
 * long messages ellipsize through CSS instead of dropping their first lines.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * Join the text blocks of one message into a single preview string.
 * @param content - the message's content block list.
 * @returns the concatenated text, or null when the message carries none.
 */
export function previewText(content: readonly ContentBlock[]): string | null {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text !== '') parts.push(block.text)
  }
  return parts.length === 0 ? null : parts.join('\n')
}
