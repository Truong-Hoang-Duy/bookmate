import { describe, expect, it } from 'vitest'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { executeDocumentTool } from '../../src/lib/agent/documentToolDispatch'
import { applyExternalInsert, createTestSession, readDocText } from './testUtils'

function run(runtime: DocumentToolRuntime, name: string, input: unknown) {
  return executeDocumentTool(runtime, name, input).result
}

function searchOne(runtime: DocumentToolRuntime, query: string, maxResults: number = 1) {
  const result = run(runtime, 'search_text', { query, maxResults }) as {
    ok: true
    matches: Array<{ matchId: string }>
  }
  return result.matches[0]!
}

describe('natural prompt scenario unit tests', () => {
  it('write me a short story writes prose into the document', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'start_streaming_edit', { mode: 'continue' })
    await runtime.pushStreamingText('Once upon a time, there was a lantern in the sea.')
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toBe('Once upon a time, there was a lantern in the sea.')
    runtime.destroy()
  })

  it('continue this paragraph appends new prose to the end', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'The rain stopped at dawn.' })
    run(runtime, 'start_streaming_edit', { mode: 'continue' })
    await runtime.pushStreamingText(' The streets steamed in the first light.')
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toBe('The rain stopped at dawn. The streets steamed in the first light.')
    runtime.destroy()
  })

  it('draft an introduction about AI safety starts from an empty document', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'start_streaming_edit', { mode: 'continue' })
    await runtime.pushStreamingText(
      'AI safety is the practice of building systems that remain useful, reliable, and aligned with human intent.',
    )
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toContain('AI safety is the practice')
    runtime.destroy()
  })

  it('add a sentence after beta inserts text at the end of the matched phrase', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma' })
    const beta = searchOne(runtime, 'beta')
    run(runtime, 'place_cursor', { matchId: beta.matchId, edge: 'end' })
    run(runtime, 'insert_text', { text: ' and then a coda' })

    expect(readDocText(session)).toBe('alpha beta and then a coda gamma')
    runtime.destroy()
  })

  it('insert a note before beta places the cursor at the start edge', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma' })
    const beta = searchOne(runtime, 'beta')
    run(runtime, 'place_cursor', { matchId: beta.matchId, edge: 'start' })
    run(runtime, 'insert_text', { text: '[note] ' })

    expect(readDocText(session)).toBe('alpha [note] beta gamma')
    runtime.destroy()
  })

  it('replace beta with gamma uses selection replacement', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma' })
    const beta = searchOne(runtime, 'beta')
    run(runtime, 'select_text', { matchId: beta.matchId })
    run(runtime, 'insert_text', { text: 'delta' })

    expect(readDocText(session)).toBe('alpha delta gamma')
    runtime.destroy()
  })

  it('delete beta removes only the selected word', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma' })
    const beta = searchOne(runtime, 'beta')
    run(runtime, 'select_text', { matchId: beta.matchId })
    run(runtime, 'delete_selection', {})

    expect(readDocText(session)).toBe('alpha  gamma')
    runtime.destroy()
  })

  it('rewrite the phrase bad into good streams a rewrite into the selected text', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'One bad sentence.' })
    const bad = searchOne(runtime, 'bad')
    run(runtime, 'select_text', { matchId: bad.matchId })
    run(runtime, 'start_streaming_edit', { mode: 'rewrite' })
    await runtime.pushStreamingText('good')
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toBe('One good sentence.')
    runtime.destroy()
  })

  it('rewrite this sentence to be shorter can replace a longer selected sentence', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', {
      text: 'This sentence is long and winding. Another line.',
    })
    const first = searchOne(runtime, 'This sentence is long and winding.')
    run(runtime, 'select_text', { matchId: first.matchId })
    run(runtime, 'start_streaming_edit', { mode: 'rewrite' })
    await runtime.pushStreamingText('This sentence is brief.')
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toBe('This sentence is brief. Another line.')
    runtime.destroy()
  })

  it('replace everything between alpha and delta with bridge text uses range selection', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma delta' })
    const alpha = searchOne(runtime, 'alpha')
    const delta = searchOne(runtime, 'delta')
    run(runtime, 'select_between_matches', {
      startMatchId: alpha.matchId,
      endMatchId: delta.matchId,
      startEdge: 'end',
      endEdge: 'start',
    })
    run(runtime, 'insert_text', { text: ' -> ' })

    expect(readDocText(session)).toBe('alpha -> delta')
    runtime.destroy()
  })

  it('add a title at the start inserts before the first matched content', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'Opening paragraph' })
    const opening = searchOne(runtime, 'Opening')
    run(runtime, 'place_cursor', { matchId: opening.matchId, edge: 'start' })
    run(runtime, 'insert_text', { text: 'Title: Dawn\n' })

    expect(readDocText(session)).toBe('Title: Dawn\nOpening paragraph')
    runtime.destroy()
  })

  it('add a closing sentence at the end uses continue mode', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'Body text.' })
    run(runtime, 'start_streaming_edit', { mode: 'continue' })
    await runtime.pushStreamingText(' Final thought.')
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toBe('Body text. Final thought.')
    runtime.destroy()
  })

  it('edit the second beta only uses a later search match', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'beta one beta two' })
    const search = run(runtime, 'search_text', { query: 'beta', maxResults: 2 }) as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    run(runtime, 'select_text', { matchId: search.matches[1]!.matchId })
    run(runtime, 'insert_text', { text: 'delta' })

    expect(readDocText(session)).toBe('beta one delta two')
    runtime.destroy()
  })

  it('review the later part of a document can use paged snapshots before editing', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma delta epsilon zeta' })
    const snapshot = run(runtime, 'get_document_snapshot', { startChar: 17, maxChars: 12 })

    expect(snapshot).toEqual({
      text: 'delta epsilo',
      charCount: 35,
      startChar: 17,
      endChar: 29,
    })
    runtime.destroy()
  })

  it('continue writing while a collaborator edits nearby keeps the insertion semantically anchored', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'Hello world' })
    const world = searchOne(runtime, 'world')
    run(runtime, 'place_cursor', { matchId: world.matchId, edge: 'start' })
    run(runtime, 'start_streaming_edit', { mode: 'insert' })
    applyExternalInsert(session, 1, 'Hey! ')
    await runtime.pushStreamingText('beautiful ')
    run(runtime, 'stop_streaming_edit', {})

    expect(readDocText(session)).toBe('Hey! Hello beautiful world')
    runtime.destroy()
  })

  it('stop writing now can cancel an in-flight streaming edit and drop the buffered tail', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'Start' })
    run(runtime, 'start_streaming_edit', { mode: 'continue' })
    await runtime.pushStreamingText('unfinished')
    const result = runtime.stopStreamingEdit(true)

    expect(result).toEqual({ ok: true, committedChars: 0, cancelled: true })
    expect(readDocText(session)).toBe('Start')
    runtime.destroy()
  })
})
