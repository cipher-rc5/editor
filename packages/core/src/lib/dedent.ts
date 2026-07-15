/**
 * Local replacement for the `dedent` npm package.
 *
 * Usable as a tagged template — `dedent\`...\`` — or with a plain string —
 * `dedent(str)`. It interleaves any interpolated values, strips the common
 * leading indentation shared by all non-empty lines, and trims surrounding
 * blank lines, matching the behaviour the `dedent` package provided.
 */
export default function dedent(input: TemplateStringsArray | string, ...values: unknown[]): string {
  const raw = typeof input === 'string' ? [input] : Array.from(input.raw ?? input)

  let result = ''
  for (let i = 0; i < raw.length; i++) {
    result += raw[i]
    if (i < values.length) {
      result += String(values[i])
    }
  }

  const lines = result.split('\n')

  let minIndent = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const match = /^[ \t]*/.exec(line)?.[0].length ?? 0
    if (match < line.length) {
      minIndent = Math.min(minIndent, match)
    }
  }

  if (Number.isFinite(minIndent) && minIndent > 0) {
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i]?.slice(minIndent) ?? ''
    }
  }

  return lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}
