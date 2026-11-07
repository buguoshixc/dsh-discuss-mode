// Re-snapshot the `discuss` Agent preset's generated region from the installed DSH.
//
// `presets/discuss.patch.yml` carries a generated region bounded by the two
// marker comments below. It is a snapshot of the shipped `standard` Agent preset
// of `@deepseek-ai/dsh-web-app`, with only the declaration identity rewritten:
// the row id `preset-standard` becomes `preset-discuss`, `config.id: standard`
// becomes `discuss`, `config.order: 1` becomes `5`, and the preset's
// `config.name` / `config.description` lines are kept from the current file
// (they are this bundle's identity, not the shipped preset's). The hand-written
// preamble above the BEGIN marker is never touched.
//
// The shipped preset is read from either install shape:
//
//   npm-installed DSH:  <dsh>/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml
//   desktop app:        dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml
//                       inside the app's app.asar
//
//   node tools/sync-preset.mjs --file <standard.patch.yml>   # rewrite the region
//   node tools/sync-preset.mjs --check --file <...>          # exit 1 on drift
//   node tools/sync-preset.mjs --asar <path-to-app.asar>     # desktop app.asar
//   DSH_PRESET_FILE='<path>' node tools/sync-preset.mjs      # same, env-supplied
//   DSH_APP_ASAR='<path>' node tools/sync-preset.mjs         # same, env-supplied
//
// Exit codes: 0 in sync (or rewritten), 1 drift (--check) or a read/lookup
// failure, 2 usage error. Either source is only read; the only write is
// `presets/discuss.patch.yml` in default mode.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openAsar } from './asar-extract.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')
const presetPath = join(packageDir, 'presets', 'discuss.patch.yml')
const presetLabel = relative(packageDir, presetPath).replaceAll('\\', '/')

/** The marker lines that bound the generated region; SPEC §4a fixes their text. */
const BEGIN_MARKER = '# --- BEGIN GENERATED PRESET (node tools/sync-preset.mjs) ---'
const END_MARKER = '# --- END GENERATED PRESET ---'

/** The shipped standard preset's path inside an npm-installed DSH. */
const SHIPPED_PRESET_TAIL = 'node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'
/** The same path inside the desktop app's `app.asar`. */
const SHIPPED_PRESET = `dsh/${SHIPPED_PRESET_TAIL}`

const USAGE = `usage: node tools/sync-preset.mjs [--check] (--file <standard.patch.yml> | --asar <path-to-app.asar>)

Regenerate the marked generated region of ${presetLabel} from the installed DSH's
shipped standard Agent preset, read either as an ordinary file (npm-installed DSH)
or from the desktop app's app.asar.

  --file <path>  installed standard.patch.yml to read; or set DSH_PRESET_FILE
  --asar <path>  installed app.asar to read; or set DSH_APP_ASAR
  --check        write nothing; exit 1 when the generated region is stale
  -h, --help     show this message`

/** A malformed command line: reported with the usage text, exit 2. */
class UsageError extends Error {}

/** @param {string} source @returns {string} UTF-8 text with no BOM and LF endings. */
function normalize(source) {
  return source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/** @param {string} text @returns {string} a regex source matching `text` literally. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** @param {string[]} argv @returns {{ check: boolean, asar: string, file: string, help: boolean }} */
function parseOptions(argv) {
  const options = {
    check: false,
    asar: process.env.DSH_APP_ASAR ?? '',
    file: process.env.DSH_PRESET_FILE ?? '',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      options.check = true
    } else if (argument === '--asar') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError('--asar needs a path')
      options.asar = value
      index += 1
    } else if (argument === '--file') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError('--file needs a path')
      options.file = value
      index += 1
    } else if (argument.startsWith('--file=')) {
      const value = argument.slice('--file='.length)
      if (value === '') throw new UsageError('--file needs a path')
      options.file = value
    } else if (argument.startsWith('--asar=')) {
      const value = argument.slice('--asar='.length)
      if (value === '') throw new UsageError('--asar needs a path')
      options.asar = value
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw new UsageError(`unknown argument: ${argument}`)
    }
  }
  return options
}

/**
 * Validate one shipped standard preset and normalize its final newline.
 * @param {string} text - raw file or archive content.
 * @param {string} sourcePath - where it was read from, for failure messages.
 * @returns {string} LF-normalized text with exactly one trailing newline.
 */
function validateShippedPreset(text, sourcePath) {
  const normalized = normalize(text)
  if (!normalized.includes("name: '@deepseek-ai/dsh-agent-preset'")) {
    throw new Error(`${sourcePath} does not look like an Agent preset declaration`)
  }
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

/**
 * Read the shipped standard preset out of the installed archive.
 * @param {string} archivePath - path to the desktop app's `app.asar`.
 * @returns {string} its text, normalized to LF with a single trailing newline.
 */
function readShippedPresetFromArchive(archivePath) {
  let archive
  try {
    archive = openAsar(archivePath)
  } catch (error) {
    throw new Error(`cannot open app.asar at ${archivePath} (${String(error?.code ?? error?.message ?? error)})`)
  }
  const matches = archive.files.filter(
    ([path]) => path === SHIPPED_PRESET || path.endsWith(`/${SHIPPED_PRESET_TAIL}`),
  )
  if (matches.length === 0) {
    throw new Error(`no ${SHIPPED_PRESET_TAIL} in ${archivePath} (is this the desktop app.asar?)`)
  }
  if (matches.length > 1) {
    throw new Error(
      `several shipped standard presets in ${archivePath}: ${matches.map(([path]) => path).join(', ')}`,
    )
  }
  const [path, node] = matches[0]
  return validateShippedPreset(archive.bytesOf(node).toString('utf8'), path)
}

/**
 * Read the shipped standard preset from an npm-installed DSH's plain file.
 * @param {string} filePath - path to `presets/standard.patch.yml`.
 * @returns {string} its text, normalized to LF with a single trailing newline.
 */
function readShippedPresetFromFile(filePath) {
  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(
      `cannot read shipped standard preset at ${filePath} (${String(error?.code ?? error?.message ?? error)})`,
    )
  }
  return validateShippedPreset(text, filePath)
}

/**
 * Read the shipped preset from the install shape the caller selected.
 * @param {{ asar: string, file: string }} options
 * @returns {{ text: string, source: string }} its text and the resolved source path.
 */
function readShippedPreset(options) {
  if (options.asar !== '') {
    const archivePath = resolve(options.asar)
    return { text: readShippedPresetFromArchive(archivePath), source: archivePath }
  }
  const filePath = resolve(options.file)
  return { text: readShippedPresetFromFile(filePath), source: filePath }
}

/**
 * Split the patch file at the marker lines.
 * @param {string} source - normalized patch text.
 * @returns {{ preamble: string, region: string }} everything above the BEGIN
 *   marker (including its final newline), and the text between the markers.
 */
function locateMarkers(source) {
  const lines = source.split('\n')
  const begin = lines.indexOf(BEGIN_MARKER)
  const end = lines.indexOf(END_MARKER)
  if (begin === -1) throw new Error(`${presetLabel}: missing marker '${BEGIN_MARKER}'`)
  if (end === -1) throw new Error(`${presetLabel}: missing marker '${END_MARKER}'`)
  if (end <= begin) throw new Error(`${presetLabel}: the END marker precedes the BEGIN marker`)
  const trailing = lines.slice(end + 1)
  if (trailing.length > 1 || (trailing.length === 1 && trailing[0] !== '')) {
    throw new Error(`${presetLabel}: unexpected content after '${END_MARKER}'`)
  }
  const preamble = begin === 0 ? '' : `${lines.slice(0, begin).join('\n')}\n`
  return { preamble, region: lines.slice(begin + 1, end).join('\n') }
}

/**
 * The preset identity lines (`config.name` / `config.description`) are ours, not
 * the shipped preset's: keep the current file's text as SPEC §4a requires.
 * @param {string} region - text between the markers.
 * @returns {{ name: string, description: string }}
 */
function extractIdentity(region) {
  const idLine = /^([ \t]*)id: discuss$/m.exec(region)
  if (idLine === null) {
    throw new Error(`${presetLabel}: the generated region has no 'config.id: discuss' line`)
  }
  const indent = escapeRegExp(idLine[1])
  const field = (key) => {
    const match = new RegExp(`^${indent}${key}: (.+)$`, 'm').exec(region)
    return match === null ? null : match[1].trimEnd()
  }
  const name = field('name')
  const description = field('description')
  if (name === null || description === null) {
    throw new Error(
      `${presetLabel}: the generated region is missing the preset's config.name/config.description`,
    )
  }
  return { name, description }
}

/**
 * Transform the shipped standard preset into the generated region.
 * @param {string} shipped - normalized text of `standard.patch.yml`.
 * @param {{ name: string, description: string }} identity - the discuss identity.
 * @returns {string} the region text, ending with one newline.
 */
function buildGeneratedRegion(shipped, identity) {
  const substitutions = [
    [/^([ \t]*)- id: preset-standard$/m, (_, indent) => `${indent}- id: preset-discuss`],
    [
      /^([ \t]*)id: standard$/m,
      (_, indent) =>
        `${indent}id: discuss\n${indent}name: ${identity.name}\n${indent}description: ${identity.description}`,
    ],
    [/^([ \t]*)order: \d+$/m, (_, indent) => `${indent}order: 5`],
  ]
  let text = shipped
  for (const [pattern, replace] of substitutions) {
    let replaced = 0
    text = text.replace(pattern, (...args) => {
      replaced += 1
      return replace(...args)
    })
    if (replaced !== 1) {
      throw new Error(
        `the shipped standard preset no longer has exactly one ${String(pattern)} match; ` +
          'update tools/sync-preset.mjs for the new preset shape',
      )
    }
  }
  if (/^[ \t]*- id: preset-standard$/m.test(text) || /^[ \t]*id: standard$/m.test(text)) {
    throw new Error('the shipped standard preset still carries the standard identity after rewriting')
  }
  return text
}

/** @param {string} current @param {string} expected @returns {null | { line: number, got: string, want: string }} */
function firstDifference(current, expected) {
  const got = current.split('\n')
  const want = expected.split('\n')
  for (let index = 0; index < Math.max(got.length, want.length); index += 1) {
    if (got[index] !== want[index]) {
      return { line: index + 1, got: got[index] ?? '<end of file>', want: want[index] ?? '<end of file>' }
    }
  }
  return null
}

/** @param {{ check: boolean, asar: string, file: string }} options */
function run(options) {
  const current = normalize(readFileSync(presetPath, 'utf8'))
  const { preamble, region } = locateMarkers(current)
  const identity = extractIdentity(region)
  const source = readShippedPreset(options)
  const generated = buildGeneratedRegion(source.text, identity)
  const expected = `${preamble}${BEGIN_MARKER}\n${generated}${END_MARKER}\n`

  if (current === expected) {
    console.log(`sync-preset: ${presetLabel} already matches ${source.source}`)
    return
  }
  if (options.check) {
    const difference = firstDifference(current, expected)
    const detail =
      difference === null
        ? ''
        : `\n  first difference at line ${String(difference.line)}:` +
          `\n    got:  ${JSON.stringify(difference.got)}` +
          `\n    want: ${JSON.stringify(difference.want)}`
    const flag = options.asar !== '' ? '--asar' : '--file'
    throw new Error(
      `${presetLabel} is out of sync with ${source.source}${detail}\n` +
        `  run: node tools/sync-preset.mjs ${flag} ${source.source} to rewrite the generated region`,
    )
  }
  writeFileSync(presetPath, expected)
  console.log(
    `sync-preset: rewrote the generated region of ${presetLabel} (${String(Buffer.byteLength(expected))} bytes) from ${source.source}`,
  )
}

function main(argv) {
  let options
  try {
    options = parseOptions(argv)
  } catch (error) {
    console.error(`sync-preset: ${error.message}\n\n${USAGE}`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(USAGE)
    return
  }
  if (options.asar !== '' && options.file !== '') {
    console.error(`sync-preset: pass either --file (npm install) or --asar (desktop app), not both\n\n${USAGE}`)
    process.exitCode = 2
    return
  }
  if (options.asar === '' && options.file === '') {
    console.error(
      `sync-preset: no shipped preset given; pass --file <standard.patch.yml> (npm install) ` +
        `or --asar <app.asar> (desktop app), or set DSH_PRESET_FILE / DSH_APP_ASAR\n\n${USAGE}`,
    )
    process.exitCode = 2
    return
  }
  try {
    run(options)
  } catch (error) {
    console.error(`sync-preset: ${error.message}`)
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
