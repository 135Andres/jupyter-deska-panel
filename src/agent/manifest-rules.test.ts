import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { checkAgent as check, usesAgent } from '../../scripts/validate-agent.mjs'

type Json = Record<string, unknown>
const real = JSON.parse(readFileSync('panel/panel.json', 'utf8')) as Json

const read = { name: 'list_things', description: 'Lists things.', kind: 'read', input: { type: 'object' }, output: { type: 'object', properties: { n: { type: 'integer' } } } }
const write = { name: 'do_thing', description: 'Does a thing.', kind: 'write', input: { type: 'object' } }
const make = (over: Json = {}): Json => ({
  schema: 1, id: 'x', sdk: 4, permissions: ['agent'], network: [],
  agent: { actions: [read, write] }, ...over,
})
const withAction = (action: Json, schemaSide?: 'input' | 'output'): Json => {
  const merged = schemaSide ? { ...read, [schemaSide]: action } : { ...read, ...action }
  return make({ agent: { actions: [merged] } })
}
// As JSON, so a key set to undefined is absent, like in a real panel.json.
const checkAgent = (m: unknown) => check(JSON.parse(JSON.stringify(m)))
const errorsOf = (m: Json) => checkAgent(m).join('\n')

describe('good manifests', () => {
  test('the real panel.json follows the rules', () => expect(checkAgent(real)).toEqual([]))
  test('a minimal one does', () => expect(checkAgent(make())).toEqual([]))
  test('a manifest without agent is not checked', () => {
    expect(checkAgent({ sdk: 1, permissions: [] })).toEqual([])
    expect(usesAgent({ sdk: 1, permissions: [] })).toBe(false)
    expect(usesAgent(make())).toBe(true)
  })
  test('storage-style permissions stay allowed', () => {
    expect(checkAgent(make({ permissions: ['agent', 'notify', 'clipboard-write'] }))).toEqual([])
  })
})

describe('permission and object', () => {
  test('permission without object', () => expect(errorsOf(make({ agent: undefined }))).toContain('needs an agent object'))
  test('object without permission', () => expect(errorsOf(make({ permissions: [] }))).toContain('needs the "agent" permission'))
  test('sdk must be 4', () => expect(errorsOf(make({ sdk: 1 }))).toContain('"sdk": 4'))
  test('0 and 17 actions', () => {
    expect(errorsOf(make({ agent: { actions: [] } }))).toContain('1 to 16')
    const many = Array.from({ length: 17 }, (_, i) => ({ ...write, name: `a${i}` }))
    expect(errorsOf(make({ agent: { actions: many } }))).toContain('1 to 16')
    expect(checkAgent(make({ agent: { actions: many.slice(0, 16) } }))).toEqual([])
  })
  test('other keys in agent', () => expect(errorsOf(make({ agent: { actions: [write], extra: 1 } }))).toContain('unknown key "extra"'))
})

describe('action fields', () => {
  test.each(['Scroll', '1abc', 'a-b', '', 'a'.repeat(41)])('bad name %j', (name) => {
    expect(errorsOf(withAction({ name }))).toContain('name must match')
  })
  test('longest name is fine', () => expect(checkAgent(withAction({ name: 'a'.repeat(40) }))).toEqual([]))
  test('duplicate name', () => expect(errorsOf(make({ agent: { actions: [write, write] } }))).toContain('duplicate'))
  test('description length', () => {
    expect(errorsOf(withAction({ description: '' }))).toContain('1 to 300')
    expect(errorsOf(withAction({ description: 'x'.repeat(301) }))).toContain('1 to 300')
    expect(checkAgent(withAction({ description: 'x'.repeat(300) }))).toEqual([])
  })
  test('description line breaks and invisible characters', () => {
    expect(errorsOf(withAction({ description: 'two\nlines' }))).toContain('line break')
    expect(errorsOf(withAction({ description: `a${String.fromCharCode(0x200b)}b` }))).toContain('invisible')
    expect(errorsOf(withAction({ description: `a${String.fromCharCode(0x202e)}b` }))).toContain('invisible')
  })
  test('kind', () => expect(errorsOf(withAction({ kind: 'delete' }))).toContain('kind must be'))
  test('output: required on read, forbidden on write', () => {
    expect(errorsOf(make({ agent: { actions: [{ ...read, output: undefined }] } }))).toContain('read action needs output')
    const noOutput: Json = { ...read }
    delete noOutput['output']
    expect(errorsOf(make({ agent: { actions: [noOutput] } }))).toContain('read action needs output')
    expect(errorsOf(make({ agent: { actions: [{ ...write, output: { type: 'object' } }] } }))).toContain('write action must not have output')
  })
  test('input is required', () => {
    const noInput: Json = { ...write }
    delete noInput['input']
    expect(errorsOf(make({ agent: { actions: [noInput] } }))).toContain('input is required')
  })
})

describe('what an agent package cannot reach', () => {
  test.each([
    ['network host', { network: ['api.example.com'] }, '"network"'],
    ['embeds', { embeds: ['https://example.com'] }, '"embeds"'],
    ['signedInEmbeds', { signedInEmbeds: ['https://example.com'] }, '"signedInEmbeds"'],
    ['account', { permissions: ['agent', 'account'] }, '"account" permission'],
    ['open-url', { permissions: ['agent', 'open-url'] }, '"open-url" permission'],
  ])('%s', (_name, over, message) => expect(errorsOf(make(over))).toContain(message))
  test('an empty network list is fine', () => expect(checkAgent(make({ network: [] }))).toEqual([]))
})

describe('schema subset', () => {
  const bad = (schema: Json, side: 'input' | 'output' = 'input') => errorsOf(withAction({ type: 'object', ...schema }, side))
  test.each([
    ['$ref', { properties: { a: { $ref: '#/x' } } }],
    ['oneOf', { properties: { a: { oneOf: [] } } }],
    ['pattern', { properties: { a: { type: 'string', maxLength: 5, pattern: 'x' } } }],
    ['minLength', { properties: { a: { type: 'string', maxLength: 5, minLength: 1 } } }],
    ['title', { title: 'x' }],
  ])('refuses %s', (_name, schema) => expect(bad(schema)).toContain('outside the subset'))
  test('a list of types', () => expect(bad({ properties: { a: { type: ['string', 'null'], maxLength: 5 } } })).toContain('outside the subset'))
  test('string needs maxLength 1 to 4000', () => {
    expect(bad({ properties: { a: { type: 'string' } } })).toContain('maxLength')
    expect(bad({ properties: { a: { type: 'string', maxLength: 4001 } } })).toContain('maxLength')
  })
  test('array needs maxItems 1 to 100 and items', () => {
    expect(bad({ properties: { a: { type: 'array', items: { type: 'boolean' } } } })).toContain('maxItems')
    expect(bad({ properties: { a: { type: 'array', maxItems: 101, items: { type: 'boolean' } } } })).toContain('maxItems')
    expect(bad({ properties: { a: { type: 'array', maxItems: 5 } } })).toContain('needs items')
  })
  test('enum values', () => {
    expect(bad({ properties: { a: { type: 'string', maxLength: 5, enum: ['a', 'a'] } } })).toContain('distinct')
    expect(bad({ properties: { a: { type: 'string', maxLength: 5, enum: ['a/b'] } } })).toContain('characters from')
    expect(bad({ properties: { a: { type: 'string', maxLength: 2, enum: ['abc'] } } })).toContain('longer than maxLength')
  })
  test('property names, required and additionalProperties', () => {
    expect(bad({ properties: { '1a': { type: 'boolean' } } })).toContain('valid property name')
    expect(bad({ properties: { a: { type: 'boolean' } }, required: ['b'] })).toContain('required')
    expect(bad({ additionalProperties: true })).toContain('additionalProperties')
    expect(checkAgent(withAction({ type: 'object', additionalProperties: false }, 'input'))).toEqual([])
  })
  test('more than 32 properties', () => {
    const properties = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, { type: 'boolean' }]))
    expect(bad({ properties })).toContain('more than 32')
  })
  test('depth of 4 is fine, 5 is not', () => {
    const level = (n: number): Json => (n === 0 ? { type: 'boolean' } : { type: 'object', properties: { a: level(n - 1) } })
    expect(checkAgent(withAction(level(3), 'input'))).toEqual([])
    expect(errorsOf(withAction(level(4), 'input'))).toContain('deeper than 4')
  })
  test('the root must be an object', () => expect(errorsOf(withAction({ type: 'string', maxLength: 5 }, 'input'))).toContain('root must be an object'))
  test('node description length', () => {
    expect(bad({ properties: { a: { type: 'boolean', description: 'x'.repeat(201) } } })).toContain('1 to 200')
  })
  test('format: deska-image on input, deska-file on output', () => {
    expect(checkAgent(withAction({ type: 'object', properties: { a: { type: 'string', maxLength: 5, format: 'deska-image' } } }, 'input'))).toEqual([])
    expect(bad({ properties: { a: { type: 'string', maxLength: 5, format: 'deska-file' } } })).toContain('deska-image')
    expect(bad({ properties: { a: { type: 'string', maxLength: 5, format: 'deska-image' } } }, 'output')).toContain('deska-file')
  })
})
