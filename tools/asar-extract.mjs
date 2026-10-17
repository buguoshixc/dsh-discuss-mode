// Read the *installed* DSH build out of its `app.asar`.
//
// Why this exists: a checkout kept beside this repo lags the installed version,
// and the two facts this bundle has to be written against — the shipped Agent
// preset declarations (`@deepseek-ai/dsh-web-app/presets/*.patch.yml`, which
// `presets/discuss.patch.yml` snapshots) and the `dsh-agent-preset-registry`
// implementation that defines what a preset declaration may contain — live
// inside the installed archive, not in any checkout. Read-only: nothing here
// writes to the archive.
//
//   node tools/asar-extract.mjs <archive> list <substring>
//   node tools/asar-extract.mjs <archive> read <path>            # to stdout
//   node tools/asar-extract.mjs <archive> dump <path> <file>     # raw bytes out
//   node tools/asar-extract.mjs <archive> grep <regex> [prefix]
//
// Header layout: an 8-byte pickle holding the header pickle's size, then that
// pickle — a 4-byte JSON length followed by the JSON describing a
// `{ files: { name: { offset, size, files, link } } }` tree. File offsets are
// relative to the content section that starts right after the header.
//
// The header parser is also exported as `openAsar(archive)` for sibling tools
// (e.g. `sync-preset.mjs`), which then share this one decoding of the format;
// the CLI below runs only when this file is executed directly.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Open an `app.asar` archive and index its header tree.
 * @param {string} archive - path to the archive.
 * @returns {{
 *   files: Array<[string, { offset: number, size: number }]>,
 *   bytesOf: (node: { offset: number, size: number }) => Buffer,
 * }} every file entry as `[path, node]`, plus the archive bytes of one entry.
 */
export function openAsar(archive) {
  const buffer = readFileSync(archive)
  const bodyOffset = 8 + buffer.readUInt32LE(4)
  const jsonStart = buffer.subarray(8, 64).indexOf(0x7b) + 8
  const jsonLength = buffer.readUInt32LE(jsonStart - 4)
  const header = JSON.parse(buffer.subarray(jsonStart, jsonStart + jsonLength).toString('utf8'))

  /** Walk the header tree, yielding `[path, node]` for every file entry. */
  function* walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if (child.files === undefined) yield [path, child]
      else yield* walk(child, path)
    }
  }

  return {
    files: [...walk(header, '')],
    bytesOf: (node) =>
      buffer.subarray(bodyOffset + Number(node.offset), bodyOffset + Number(node.offset) + node.size),
  }
}

/** The command line front end; called only when this file is executed directly. */
function main(argv) {
  const [archive, mode, target = '', destination] = argv
  const { files, bytesOf } = openAsar(archive)

  if (mode === 'list') {
    for (const [path] of files) if (path.includes(target)) console.log(path)
  } else if (mode === 'read') {
    for (const [path, node] of files.filter(([path]) => path === target)) {
      console.log(`===== ${path} (${String(node.size)} bytes) =====`)
      console.log(bytesOf(node).toString('utf8'))
    }
  } else if (mode === 'dump') {
    const found = files.find(([path]) => path === target)
    if (found === undefined) throw new Error(`not found: ${target}`)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytesOf(found[1]))
    console.log(`${destination} <- ${found[0]} (${String(found[1].size)} bytes)`)
  } else if (mode === 'grep') {
    const pattern = new RegExp(target)
    const scope = destination ?? ''
    for (const [path, node] of files) {
      if (!path.startsWith(scope) || !/\.(js|mjs|cjs|ts|json|ya?ml|md)$/.test(path)) continue
      for (const [index, line] of bytesOf(node).toString('utf8').split('\n').entries()) {
        if (pattern.test(line)) console.log(`${path}:${String(index + 1)}: ${line.trim().slice(0, 200)}`)
      }
    }
  } else {
    throw new Error('usage: asar-extract.mjs <archive> <list|read|dump|grep> <target> [destinationOrPrefix]')
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
