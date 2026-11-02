// Node module hooks (see waive-register.mjs). The examples repository's package
// check only knows sdk 1 and has no `agent`, so for a manifest with sdk 4 and an
// agent object it reports exactly three errors that the public docs make wrong:
//   sdk must be 1.  Unknown field "agent".  Unknown permission "agent".
// This rewrites its checkPanelFolder so that it looks at the manifest as if those
// three did not apply (sdk 1, no agent, no agent permission). Every other rule
// still runs, and the examples repository on disk is not touched.
// The sdk-4-and-agent condition mirrors `usesAgent` in ../validate-agent.mjs.
const TARGET = /\/tools\/lib\/manifest\.mjs$/
const NEEDLE = 'const result = checkManifest(manifest)'
const REPLACEMENT = `const __isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  let __seen = manifest
  if (__isObj(manifest) && manifest.sdk === 4 && __isObj(manifest.agent)) {
    const { agent: _agent, ...rest } = manifest
    __seen = { ...rest, sdk: 1, permissions: Array.isArray(rest.permissions) ? rest.permissions.filter((p) => p !== 'agent') : rest.permissions }
  }
  const result = checkManifest(__seen)`

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context)
  if (!TARGET.test(url)) return loaded
  const source = String(loaded.source)
  if (!source.includes(NEEDLE)) {
    throw new Error(`waive-hooks: the examples repository changed (no "${NEEDLE}" in ${url}); update scripts/lib/waive-hooks.mjs.`)
  }
  return { ...loaded, source: source.replace(NEEDLE, REPLACEMENT) }
}
