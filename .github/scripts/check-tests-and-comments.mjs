#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const baseSha = process.env.BASE_SHA
const headSha = process.env.HEAD_SHA

if (!baseSha || !headSha) {
  console.error('BASE_SHA and HEAD_SHA env vars are required')
  process.exit(1)
}

const WATCHED_GLOBS = [/^backend\/src\/.+\.ts$/]

const TEST_FILE_RE = /\.(test|spec)\.tsx?$/
const COMMENT_LINE_RE = /^(\/\/|\/\*|\*\/|\*(?!\/))/

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function isWatched(file) {
  if (TEST_FILE_RE.test(file)) return false
  if (file.endsWith('.d.ts')) return false
  return WATCHED_GLOBS.some((re) => re.test(file))
}

function candidateTestFiles(file) {
  const dir = path.dirname(file)
  const ext = path.extname(file)
  const base = path.basename(file, ext)
  return [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, '__tests__', `${base}.test${ext}`),
    path.join(dir, '__tests__', `${base}.spec${ext}`),
  ]
}

function fileExistsAtHead(file) {
  try {
    git(['cat-file', '-e', `${headSha}:${file}`])
    return true
  } catch {
    return false
  }
}

function diffTouchesComment(file) {
  const diff = git(['diff', '-U0', baseSha, headSha, '--', file])
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    const content = line.slice(1).trim()
    if (COMMENT_LINE_RE.test(content)) return true
  }
  return false
}

const statusOutput = git(['diff', '--name-status', baseSha, headSha])
const changedFiles = statusOutput
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split('\t')
    return { status: status[0], file: rest[rest.length - 1] }
  })

const changedPaths = new Set(changedFiles.map((f) => f.file))
const failures = []

for (const { status, file } of changedFiles) {
  if (status === 'D') continue
  if (!isWatched(file)) continue

  const hasTest = candidateTestFiles(file).some(
    (t) => fileExistsAtHead(t) || changedPaths.has(t),
  )
  const hasCommentChange = diffTouchesComment(file)

  if (status === 'A') {
    if (!hasTest) {
      failures.push(
        `[new file] ${file}: no associated test file found (expected: ${candidateTestFiles(file)[0]} or equivalent).`,
      )
    }
    if (!hasCommentChange) {
      failures.push(`[new file] ${file}: no comment found in the file.`)
    }
  } else if (status === 'M') {
    if (!hasTest) {
      failures.push(
        `[modified file] ${file}: no associated test file (existing or modified) found.`,
      )
    }
    if (!hasCommentChange) {
      failures.push(
        `[modified file] ${file}: no comment added/modified/removed in the diff.`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error('Tests/comments check failed:\n')
  for (const f of failures) console.error(` - ${f}`)
  console.error(
    '\nEvery source file added or modified under backend/src/ must have an ' +
      'associated test file (*.test.ts / *.spec.ts) and comments explaining ' +
      'the code.',
  )
  process.exit(1)
}

console.log('OK: tests and comments are present for all watched files.')
