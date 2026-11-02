/** Test helper: the schema subset Deska accepts (panel-actions docs), enough to check inputs and answers. */
export type Schema = {
  type: string
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  maxItems?: number
  maxLength?: number
  enum?: string[]
  minimum?: number
  maximum?: number
}

export function violations(schema: Schema, value: unknown, path = '$'): string[] {
  const bad = (why: string) => [`${path}: ${why}`]
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('not an object')
      const object = value as Record<string, unknown>
      const out: string[] = []
      for (const key of schema.required ?? []) if (!(key in object)) out.push(`${path}.${key}: missing`)
      for (const [key, child] of Object.entries(object)) {
        const sub = schema.properties?.[key]
        out.push(...(sub ? violations(sub, child, `${path}.${key}`) : [`${path}.${key}: not allowed`]))
      }
      return out
    }
    case 'string':
      if (typeof value !== 'string') return bad('not a string')
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return bad('too long')
      return schema.enum && !schema.enum.includes(value) ? bad('not in enum') : []
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || (schema.type === 'integer' && !Number.isInteger(value))) return bad('not a number')
      return (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)
        ? bad('out of range') : []
    case 'boolean':
      return typeof value === 'boolean' ? [] : bad('not a boolean')
    case 'array':
      if (!Array.isArray(value)) return bad('not an array')
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return bad('too many items')
      return value.flatMap((item, i) => violations(schema.items!, item, `${path}[${i}]`))
    default:
      return bad(`type ${schema.type} is outside the subset`)
  }
}
