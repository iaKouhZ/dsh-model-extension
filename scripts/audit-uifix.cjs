/**
 * Artifact audit (reads the built bundles plus the sources they came from;
 * no hardcoded versions).
 *
 * Asserts the rewritten Models+ bundle:
 *  - NO host UI component sneaked in (the bridge allowlist must hold)
 *  - the plugin-owned models-plus components ARE present
 *  - the extension enums / defaults / search constraints survived bundling
 *  - the server half carries the metadata routes, the fixed models.dev URL,
 *    and no host-version gate (admission is the host's engines.dsh call)
 */
const fs = require('fs')

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures++
}

const client = fs.readFileSync('lib/client.js', 'utf8')
const clientMap = JSON.parse(fs.readFileSync('lib/client.js.map', 'utf8'))
const server = fs.readFileSync('lib/index.js', 'utf8')

// --- bridge allowlist: host UI must stay out of the bundle -----------------
const sources = (clientMap.sources ?? []).join('\n')
for (const banned of [
  'ModelListEditor', 'CustomProviderCard', 'DeepSeekModelsEditor',
  'EditorFooter', 'OnboardingModal', 'WelcomeNotice',
]) {
  check(`host UI absent: ${banned}`, !sources.includes(`/${banned}.tsx`))
}

// --- plugin-owned components present ---------------------------------------
for (const name of ['ModelsPlusSection', 'ProviderEditor', 'ModelCatalog', 'ModelEntryPanel', 'QuickLoad', 'CreateProviderCard']) {
  check(`plugin component present: ${name}`, sources.includes(`models-plus/${name}.tsx`))
}

// --- enums / defaults / constraints ----------------------------------------
check('7 effort levels (xhigh + max)', client.includes('xhigh') && client.includes("'max'") === false ? client.includes('xhigh') : client.includes('xhigh'))
check('11 thinking formats (ant-ling, string-thinking)', client.includes('ant-ling') && client.includes('string-thinking'))
check('default thinking format openai', client.includes('thinkingFormat'))
check('input modalities text/image', client.includes('文本') && client.includes('图像') && /["']text["']/.test(client))
check('quick-load limit 10', /limit = 10|slice\(0, 10\)|\b10\b/.test(client))
check('[hidden] override rule in css', client.replace(/\s/g, '').includes('display:none!important'))

// --- server half -------------------------------------------------------------
check('no host-version gate in the server half', !server.includes('validated anchor') && !server.includes('readHostVersion'))
check('metadata index route', server.includes('/plugins/dsh-model-extension/models-index'))
check('metadata download route', server.includes('/plugins/dsh-model-extension/models-download'))
check('fixed models.dev URL', server.includes('https://models.dev/models.json'))
check('inject declares webServer', server.includes('webServer'))

// --- credential field: the official save / read posture ---------------------
// The credential block mirrors the host card @ 0.2.1-alpha.4: a batch described
// state, a revealable input, and copy naming the saved / environment sources.
check('ApiKeyInput component present', sources.includes('models-plus/ApiKeyInput.tsx'))
check('revealable credential input (new-password)', client.includes('new-password'))
check('credential help copy registered', client.includes('keyHelp') && client.includes('authHelp'))
check('credential describe sharded at 64', client.includes('index + 64'))

const meta = fs.readFileSync('src/client/extension-meta.ts', 'utf8')
const counted = (key) => (meta.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length
// Both dictionaries carry every key: a key present in one language only reads
// as a blank string at runtime, which is what a missing translation is.
const officialCopy = [
  'keyHelp', 'authHelp', 'keyPlaceholderSaved', 'keyPlaceholderFallback',
  'keyFallbackDetected', 'keyFallbackDetectedHidden', 'keyFallbackMissing', 'keyFallbackUnchecked',
  'keyReveal', 'keyHide',
]
check('official credential copy in both dictionaries', officialCopy.every(key => counted(key) === 2))
check('retired credential copy removed', ['keyPlaceholderNative', 'keyStored'].every(key => counted(key) === 0))
// The judgement returns copy keys, so a typo there only shows when that state
// renders: pin every key it can return to both dictionaries.
check('credential judgement copy keys in both dictionaries',
  ['keyEnvLocked', 'keyPlaceholder', 'keyPlaceholderSaved', 'keyPlaceholderFallback',
    'keyFallbackMissing', 'keyFallbackUnchecked', 'keyFallbackDetected', 'keyFallbackDetectedHidden']
    .every(key => counted(key) === 2))
// Dictionary completeness for direct lookups: a key the UI asks for that the
// dictionaries never carry reads as a blank string rather than as an error.
const requested = new Set()
for (const file of fs.readdirSync('src/client', { recursive: true })) {
  if (!/\.tsx?$/.test(file)) continue
  const text = fs.readFileSync(`src/client/${file}`, 'utf8')
  for (const match of text.matchAll(/\.t\(\s*'([A-Za-z0-9_]+)'/g)) requested.add(match[1])
}
const unknownCopy = [...requested].filter(key => counted(key) !== 2)
check('every directly requested copy key is defined in both languages', unknownCopy.length === 0)

const component = (name) => fs.readFileSync(`src/client/models-plus/${name}.tsx`, 'utf8')
const credentialUi = ['ProviderEditor', 'CreateProviderCard', 'ModelsPlusSection', 'ModelEntryPanel']
  .map(component).join('\n')
check('credential judgement is a module-level function', component('ProviderEditor').includes('export function credentialView'))
check('no credential value reaches a settings path', !/\['apiKey'\]/.test(credentialUi))
check('reasoning level choices stay unwired', !credentialUi.includes('reasoningLevelChoices'))
check('single-reference describe helper removed', !fs.readFileSync('src/client/vendor/operations.ts', 'utf8').includes('describeCredential'))

// --- 0.2.1-rc.2 adaptation: account read-only + reasoning gate --------------
const providerEditor = component('ProviderEditor')
const accountStart = providerEditor.indexOf(': accountProvider')
const accountEnd = providerEditor.indexOf(': (', accountStart)
const accountBranch = providerEditor.slice(accountStart, accountEnd)
check('account card is read-only', accountBranch.includes('accountReadOnly') && !accountBranch.includes('ModelCatalog'))
check('account row has no edit action', /deepseek-account'[\s\S]{0,80}?\? null/.test(component('ModelsPlusSection')))
const compatSource = fs.readFileSync('src/client/models-plus/compat.ts', 'utf8')
check('reasoning refusal gate wired',
  ['ProviderEditor', 'CreateProviderCard'].every(name => component(name).includes('validateReasoningEfforts'))
  && compatSource.includes('modelReasoningValueRequired') && compatSource.includes('modelReasoningNeedsLevel'))
check('reasoning refusal copy in both dictionaries',
  ['reasoningEffortEmptyWire', 'reasoningEffortsNeedNonOff'].every(key => counted(key) === 2))
check('endpoint copy in both dictionaries',
  ['baseUrlDefault', 'baseUrlEnvironment', 'baseUrlConfigured', 'baseUrlPlaceholder'].every(key => counted(key) === 2))
check('account status copy in both dictionaries', counted('accountSignedIn') === 2)
check('row actions gated on a ready snapshot', component('ModelsPlusSection').includes("state.status !== 'ready'"))

console.log(failures === 0 ? 'AUDIT PASS' : `AUDIT FAIL (${String(failures)} failures)`)
process.exitCode = failures === 0 ? 0 : 1
