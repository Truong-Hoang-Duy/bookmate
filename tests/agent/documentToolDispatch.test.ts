import { describe, expect, it } from 'vitest'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { DOCUMENT_TOOL_NAMES, executeDocumentTool } from '../../src/lib/agent/documentToolDispatch'
import { createTestSession, readDocJson, readDocText } from './testUtils'

function run(runtime: DocumentToolRuntime, name: string, input: unknown) {
  return executeDocumentTool(runtime, name, input)
}

describe('document tool dispatch unit tests', () => {
  it('exposes the full tool set', () => {
    expect(DOCUMENT_TOOL_NAMES).toEqual([
      'get_document_snapshot',
      'get_selection_snapshot',
      'get_cursor_context',
      'search_text',
      'replace_matches',
      'place_cursor',
      'place_cursor_at_document_boundary',
      'insert_paragraph_break',
      'select_text',
      'select_current_block',
      'select_between_matches',
      'clear_selection',
      'set_format',
      'insert_text',
      'delete_selection',
      'start_streaming_edit',
      'stop_streaming_edit',
    ])
  })

  it('runs get_document_snapshot and search_text tools', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    runtime.insertText('alpha beta gamma beta')

    const snapshot = run(runtime, 'get_document_snapshot', { startChar: 6, maxChars: 9 }).result
    const search = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result

    expect(snapshot).toEqual({
      text: 'beta gamm',
      charCount: 21,
      startChar: 6,
      endChar: 15,
      hasMore: true,
    })
    expect(search).toEqual({
      ok: true,
      matches: [expect.objectContaining({ text: 'beta' })],
    })

    runtime.destroy()
  })

  it('runs selection and cursor context tools', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    runtime.insertText('alpha beta gamma')
    const search = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }

    run(runtime, 'select_text', { matchId: search.matches[0]!.matchId })
    const selection = run(runtime, 'get_selection_snapshot', {}).result
    run(runtime, 'place_cursor', { matchId: search.matches[0]!.matchId, edge: 'start' })
    const cursor = run(runtime, 'get_cursor_context', { maxCharsBefore: 6, maxCharsAfter: 9 }).result

    expect(selection).toEqual({
      ok: true,
      text: 'beta',
      from: expect.any(Number),
      to: expect.any(Number),
      before: 'alpha ',
      after: ' gamma',
    })
    expect(cursor).toEqual({ ok: true, before: 'alpha ', after: 'beta gamm' })

    runtime.destroy()
  })

  it('runs cursor and selection tools and emits matching custom events', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    runtime.insertText('alpha beta gamma delta')
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []
    const matches = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    const deltas = run(runtime, 'search_text', { query: 'delta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }

    events.push(...run(runtime, 'place_cursor', { matchId: matches.matches[0]!.matchId, edge: 'end' }).customEvents)
    events.push(...run(runtime, 'select_text', { matchId: matches.matches[0]!.matchId }).customEvents)
    events.push(
      ...run(runtime, 'select_between_matches', {
        startMatchId: matches.matches[0]!.matchId,
        endMatchId: deltas.matches[0]!.matchId,
        startEdge: 'end',
        endEdge: 'start',
      }).customEvents,
    )
    events.push(...run(runtime, 'clear_selection', {}).customEvents)

    expect(events.map((event) => event.name)).toEqual([
      'agent-cursor-updated',
      'agent-selection-updated',
      'agent-selection-updated',
      'agent-selection-cleared',
    ])

    runtime.destroy()
  })

  it('runs the document boundary cursor tool', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []

    events.push(...run(runtime, 'insert_text', { text: 'body' }).customEvents)
    events.push(...run(runtime, 'place_cursor_at_document_boundary', { boundary: 'start' }).customEvents)
    events.push(...run(runtime, 'insert_text', { text: 'title ' }).customEvents)

    expect(readDocText(session)).toBe('title body')
    expect(events.find((event) => event.name === 'agent-cursor-updated')).toEqual({
      name: 'agent-cursor-updated',
      payload: { boundary: 'start' },
    })

    runtime.destroy()
  })

  it('runs the paragraph break tool and emits an edit event', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []

    events.push(...run(runtime, 'insert_text', { text: 'First paragraph.' }).customEvents)
    events.push(...run(runtime, 'place_cursor_at_document_boundary', { boundary: 'end' }).customEvents)
    events.push(...run(runtime, 'insert_paragraph_break', {}).customEvents)
    events.push(...run(runtime, 'insert_text', { text: 'Second paragraph.' }).customEvents)

    expect(readDocText(session)).toBe('First paragraph.\n\nSecond paragraph.')
    expect(events.filter((event) => event.name === 'agent-edit-applied')).toEqual([
      { name: 'agent-edit-applied', payload: { kind: 'insert_text', chars: 16 } },
      { name: 'agent-edit-applied', payload: { kind: 'insert_paragraph_break' } },
      { name: 'agent-edit-applied', payload: { kind: 'insert_text', chars: 17 } },
    ])

    runtime.destroy()
  })

  it('runs the current block selection tool', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'body text' })
    run(runtime, 'place_cursor_at_document_boundary', { boundary: 'end' })
    const result = run(runtime, 'select_current_block', {}).result

    expect(result).toEqual({ ok: true, selectedText: 'body text' })

    runtime.destroy()
  })

  it('runs insert_text and delete_selection tools', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []

    events.push(...run(runtime, 'insert_text', { text: 'alpha beta' }).customEvents)
    const matches = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    events.push(...run(runtime, 'select_text', { matchId: matches.matches[0]!.matchId }).customEvents)
    events.push(...run(runtime, 'delete_selection', {}).customEvents)

    expect(readDocText(session)).toBe('alpha ')
    expect(events.filter((event) => event.name === 'agent-edit-applied')).toEqual([
      { name: 'agent-edit-applied', payload: { kind: 'insert_text', chars: 10 } },
      { name: 'agent-edit-applied', payload: { kind: 'delete_selection' } },
    ])

    runtime.destroy()
  })

  it('runs replace_matches across repeated exact search hits', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []

    events.push(...run(runtime, 'insert_text', { text: 'Mara waved. Mara smiled.' }).customEvents)
    const search = run(runtime, 'search_text', { query: 'Mara', maxResults: 10 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    const replaceResult = run(runtime, 'replace_matches', {
      matchIds: search.matches.map((match) => match.matchId),
      text: 'Kiki',
    })
    events.push(...replaceResult.customEvents)

    expect(replaceResult.result).toEqual({ ok: true, replacedCount: 2, insertedChars: 4 })
    expect(readDocText(session)).toBe('Kiki waved. Kiki smiled.')
    expect(events.filter((event) => event.name === 'agent-edit-applied')).toEqual([
      { name: 'agent-edit-applied', payload: { kind: 'insert_text', chars: 24 } },
      { name: 'agent-edit-applied', payload: { kind: 'replace_matches', count: 2, chars: 4 } },
    ])

    runtime.destroy()
  })

  it('runs replace_matches with markdown inline formatting', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma' })
    const search = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    const result = run(runtime, 'replace_matches', {
      matchIds: [search.matches[0]!.matchId],
      text: '**beta**',
      contentFormat: 'markdown',
    }).result

    expect(result).toEqual({ ok: true, replacedCount: 1, insertedChars: 8 })
    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'alpha ' },
            { type: 'text', text: 'beta', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' gamma' },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('runs the format tool and emits a formatting event', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []

    events.push(...run(runtime, 'insert_text', { text: 'alpha beta' }).customEvents)
    const matches = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    events.push(...run(runtime, 'select_text', { matchId: matches.matches[0]!.matchId }).customEvents)
    events.push(...run(runtime, 'set_format', { kind: 'mark', format: 'bold', action: 'add' }).customEvents)

    expect(events.find((event) => event.name === 'agent-format-applied')).toEqual({
      name: 'agent-format-applied',
      payload: { kind: 'mark', format: 'bold', action: 'add' },
    })

    runtime.destroy()
  })

  it('runs insert_text with markdown inline formatting over a selection', () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })

    run(runtime, 'insert_text', { text: 'alpha beta gamma' })
    const matches = run(runtime, 'search_text', { query: 'beta', maxResults: 1 }).result as {
      ok: true
      matches: Array<{ matchId: string }>
    }
    run(runtime, 'select_text', { matchId: matches.matches[0]!.matchId })
    run(runtime, 'insert_text', { text: '**beta**', contentFormat: 'markdown' })

    expect(readDocJson(session)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'alpha ' },
            { type: 'text', text: 'beta', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' gamma' },
          ],
        },
      ],
    })

    runtime.destroy()
  })

  it('runs start_streaming_edit and stop_streaming_edit tools', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    const events: Array<{ name: string; payload: Record<string, unknown> }> = []

    events.push(...run(runtime, 'insert_text', { text: 'Hello' }).customEvents)
    const startedCall = run(runtime, 'start_streaming_edit', { mode: 'continue', contentFormat: 'plain_text' })
    events.push(...startedCall.customEvents)
    await runtime.pushStreamingText(' world')
    const stoppedCall = run(runtime, 'stop_streaming_edit', {})
    events.push(...stoppedCall.customEvents)

    expect(startedCall.result).toEqual(
      expect.objectContaining({
        ok: true,
        mode: 'continue',
        contentFormat: 'plain_text',
        editSessionId: expect.any(String),
      }),
    )
    expect(stoppedCall.result).toEqual(
      expect.objectContaining({
        ok: true,
        committedChars: expect.any(Number),
      }),
    )
    expect(readDocText(session)).toBe('Hello world')
    expect(events.filter((event) => event.name === 'agent-streaming-edit')).toEqual([
      {
        name: 'agent-streaming-edit',
        payload: { active: true, mode: 'continue', contentFormat: 'plain_text' },
      },
      { name: 'agent-streaming-edit', payload: { active: false } },
    ])

    runtime.destroy()
  })
})
