#!/usr/bin/env node
// Checks the `agent` rules of the Deska docs on a panel.json, because the
// examples repository's validator does not know them yet:
// https://deska.dev/docs/panel-manifest and https://deska.dev/docs/panel-actions
//
//   npm run validate:agent [-- package folder or panel.json]
//
// `npm run validate:deska` runs the same checks through `checkAgent`.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DOCS = 'https://deska.dev/docs/panel-actions'

const NAME = /^[a-z][a-z0-9_]{0,39}$/
const PROPERTY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const ENUM_VALUE = /^[A-Za-z0-9 ._-]{1,64}$/
// Zero-width and bidi characters, plus line breaks.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/
const LINE_BREAK = /[\r\n\u2028\u2029\u0085]/
const MAX_DEPTH = 4
const FORBIDDEN_PERMISSIONS = ['account', 'open-url']
const FORBIDDEN_FIELDS = ['network', 'embeds', 'signedInEmbeds']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

function checkDescription(text, where, max, errors, allowBreaks = false) {
  if (typeof text !== 'string' || text.length < 1 || text.length > max) errors.push(`${where}: description must be 1 to ${max} characters.`)
  else if (INVISIBLE.test(text) || (!allowBreaks && LINE_BREAK.test(text))) errors.push(`${where}: description has a line break or an invisible character.`)
}

/** Checks one schema node against the subset. `kind` is the side it sits on, for `format`. */
function checkSchema(node, where, depth, side, errors) {
  if (!isObject(node)) return errors.push(`${where}: schema must be an object.`)
  if (depth > MAX_DEPTH) return errors.push(`${where}: deeper than ${MAX_DEPTH} levels.`)
  const allowed = {
    object: ['type', 'properties', 'required', 'additionalProperties', 'description'],
    string: ['type', 'maxLength', 'enum', 'format', 'description'],
    number: ['type', 'minimum', 'maximum', 'description'],
    integer: ['type', 'minimum', 'maximum', 'description'],
    boolean: ['type', 'description'],
    array: ['type', 'items', 'maxItems', 'description'],
  }
  const type = node.type
  if (typeof type !== 'string' || !(type in allowed)) return errors.push(`${where}: type ${JSON.stringify(type)} is outside the subset.`)
  for (const key of Object.keys(node)) {
    if (!allowed[type].includes(key)) errors.push(`${where}: keyword "${key}" is outside the subset.`)
  }
  if ('description' in node) checkDescription(node.description, where, 200, errors)

  if (type === 'object') {
    const props = node.properties ?? {}
    if (!isObject(props)) errors.push(`${where}.properties: must be an object.`)
    else {
      const names = Object.keys(props)
      if (names.length > 32) errors.push(`${where}.properties: more than 32.`)
      for (const name of names) {
        if (!PROPERTY.test(name)) errors.push(`${where}.properties: "${name}" is not a valid property name.`)
        checkSchema(props[name], `${where}.${name}`, depth + 1, side, errors)
      }
      if ('required' in node) {
        if (!Array.isArray(node.required) || node.required.some((n) => !names.includes(n))) errors.push(`${where}.required: must list names from properties.`)
      }
    }
    if ('additionalProperties' in node && node.additionalProperties !== false) errors.push(`${where}.additionalProperties: omit it or use false.`)
  } else if (type === 'string') {
    if (!isInt(node.maxLength, 1, 4000)) errors.push(`${where}: string needs maxLength from 1 to 4000.`)
    if ('enum' in node) {
      const list = node.enum
      if (!Array.isArray(list) || list.length < 1 || list.length > 50 || new Set(list).size !== list.length) errors.push(`${where}.enum: 1 to 50 distinct values.`)
      else for (const v of list) {
        if (typeof v !== 'string' || !ENUM_VALUE.test(v)) errors.push(`${where}.enum: "${v}" must be 1 to 64 characters from A-Z a-z 0-9 space . _ -.`)
        else if (isInt(node.maxLength, 1, 4000) && v.length > node.maxLength) errors.push(`${where}.enum: "${v}" is longer than maxLength.`)
      }
    }
    if ('format' in node) {
      const want = side === 'input' ? 'deska-image' : 'deska-file'
      if (node.format !== want) errors.push(`${where}.format: only "${want}" is allowed on ${side}.`)
      if ('enum' in node) errors.push(`${where}: format and enum cannot be combined.`)
    }
  } else if (type === 'number' || type === 'integer') {
    for (const key of ['minimum', 'maximum']) {
      if (key in node && typeof node[key] !== 'number') errors.push(`${where}.${key}: must be a number.`)
    }
  } else if (type === 'array') {
    if (!isInt(node.maxItems, 1, 100)) errors.push(`${where}: array needs maxItems from 1 to 100.`)
    if (!('items' in node)) errors.push(`${where}: array needs items.`)
    else checkSchema(node.items, `${where}[]`, depth + 1, side, errors)
  }
}

/** True when the manifest asks for the agent feature the examples repository does not know: sdk 4 and an agent object. */
export const usesAgent = (manifest) => isObject(manifest) && manifest.sdk === 4 && isObject(manifest.agent)

/** Every agent rule that fails on `manifest`, as readable lines. Empty when it has no agent or all is well. */
export function checkAgent(manifest) {
  const errors = []
  if (!isObject(manifest)) return ['panel.json: must be an object.']
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
  const hasPermission = permissions.includes('agent')
  const hasObject = 'agent' in manifest
  if (!hasPermission && !hasObject) return errors
  if (hasPermission && !hasObject) errors.push('permission "agent" needs an agent object.')
  if (hasObject && !hasPermission) errors.push('the agent object needs the "agent" permission.')
  if (manifest.sdk !== 4) errors.push('agent needs "sdk": 4.')

  for (const key of FORBIDDEN_FIELDS) {
    const value = manifest[key]
    if (key in manifest && !(Array.isArray(value) && value.length === 0)) errors.push(`agent forbids "${key}"; this ID must not declare it.`)
  }
  for (const p of FORBIDDEN_PERMISSIONS) if (permissions.includes(p)) errors.push(`agent forbids the "${p}" permission.`)

  if (!hasObject) return errors
  const agent = manifest.agent
  if (!isObject(agent)) return [...errors, 'agent must be an object.']
  for (const key of Object.keys(agent)) if (key !== 'actions') errors.push(`agent: unknown key "${key}".`)
  const actions = agent.actions
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 16) return [...errors, 'agent.actions: 1 to 16 actions.']

  const seen = new Set()
  actions.forEach((action, i) => {
    const where = `agent.actions[${i}]${isObject(action) && typeof action.name === 'string' ? ` (${action.name})` : ''}`
    if (!isObject(action)) return errors.push(`${where}: must be an object.`)
    for (const key of Object.keys(action)) {
      if (!['name', 'description', 'kind', 'input', 'output'].includes(key)) errors.push(`${where}: unknown key "${key}".`)
    }
    if (typeof action.name !== 'string' || !NAME.test(action.name)) errors.push(`${where}: name must match [a-z][a-z0-9_]{0,39}.`)
    else if (seen.has(action.name)) errors.push(`${where}: duplicate name.`)
    else seen.add(action.name)
    checkDescription(action.description, where, 300, errors)
    if (action.kind !== 'read' && action.kind !== 'write') errors.push(`${where}: kind must be "read" or "write".`)
    if (!('input' in action)) errors.push(`${where}: input is required.`)
    else {
      if (isObject(action.input) && action.input.type !== 'object') errors.push(`${where}.input: the root must be an object.`)
      checkSchema(action.input, `${where}.input`, 1, 'input', errors)
    }
    if (action.kind === 'read' && !('output' in action)) errors.push(`${where}: a read action needs output.`)
    if (action.kind === 'write' && 'output' in action) errors.push(`${where}: a write action must not have output.`)
    if ('output' in action) {
      if (isObject(action.output) && action.output.type !== 'object') errors.push(`${where}.output: the root must be an object.`)
      checkSchema(action.output, `${where}.output`, 1, 'output', errors)
    }
  })
  return errors
}

// Run directly: check a package folder or a panel.json.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { packageDir } = await import('./lib/dist.mjs')
  const target = resolve(process.argv[2] ?? packageDir)
  const file = statSync(target, { throwIfNoEntry: false })?.isDirectory() ? resolve(target, 'panel.json') : target
  let manifest
  try { manifest = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    console.error(`validate:agent: cannot read ${file}: ${error.message}`)
    process.exit(1)
  }
  const errors = checkAgent(manifest)
  if (errors.length) {
    console.error(`validate:agent: ${file} breaks the agent rules (${DOCS}).`)
    for (const e of errors) console.error(`  ✗ ${e}`)
    process.exit(1)
  }
  console.log(`validate:agent: ${manifest.id} follows the agent rules.`)
}
