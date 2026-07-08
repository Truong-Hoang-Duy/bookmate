import { afterEach, describe, expect, it } from 'vitest'
import type { StreamChunk } from '@tanstack/ai'
import { runPythonAgentStream } from '../../src/lib/agent/pythonAgentBridge'
import { routeAgentStreamChunks, type StreamingEditRouter } from '../../src/lib/agent/chatStreamRouting'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

function ndjsonResponse(lines: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`))
      }
      controller.close()
    },
  })
  return new Response(body, { status })
}

function createRouterStub(initiallyActive: boolean): StreamingEditRouter & { pushed: string[]; stops: boolean[] } {
  let active = initiallyActive
  const pushed: string[] = []
  const stops: boolean[] = []
  return {
    pushed,
    stops,
    isStreamingEditActive: () => active,
    async pushStreamingText(delta: string) {
      pushed.push(delta)
    },
    stopStreamingEdit(cancelled?: boolean) {
      stops.push(Boolean(cancelled))
      active = false
      return { ok: true, committedChars: pushed.join('').length, ...(cancelled ? { cancelled: true } : {}) }
    },
    getActiveStreamingEditInfo: () => (active ? { mode: 'insert', contentFormat: 'plain_text' } : null),
  }
}

describe('runPythonAgentStream (NDJSON -> AGUIEvent translation)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('translates text_delta + done into RUN_STARTED/TEXT_MESSAGE_*/RUN_FINISHED', async () => {
    globalThis.fetch = (async () =>
      ndjsonResponse([
        JSON.stringify({ type: 'text_delta', delta: 'Xin ' }),
        JSON.stringify({ type: 'text_delta', delta: 'chào' }),
        JSON.stringify({ type: 'done' }),
      ])) as typeof fetch

    const chunks = await collect(
      runPythonAgentStream({
        runId: 'run-1',
        messages: [{ role: 'user', content: 'hi' }],
        editorContextKind: null,
        selectedText: null,
        mode: 'insert',
        abortController: new AbortController(),
      }),
    )

    expect(chunks[0]).toEqual({ type: 'RUN_STARTED', timestamp: expect.any(Number), runId: 'run-1' })
    expect(chunks[1]).toMatchObject({ type: 'TEXT_MESSAGE_START', role: 'assistant' })
    const messageId = (chunks[1] as { messageId: string }).messageId
    expect(chunks[2]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'Xin ' })
    expect(chunks[3]).toMatchObject({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'chào' })
    expect(chunks[4]).toMatchObject({ type: 'TEXT_MESSAGE_END', messageId })
    expect(chunks[5]).toMatchObject({ type: 'RUN_FINISHED', runId: 'run-1', finishReason: 'stop' })
  })

  it('translates a tool_call line into TOOL_CALL_START/END plus CUSTOM events', async () => {
    globalThis.fetch = (async () =>
      ndjsonResponse([
        JSON.stringify({
          type: 'tool_call',
          name: 'insert_text',
          args: { text: 'hello' },
          result: { ok: true, insertedChars: 5 },
          customEvents: [{ name: 'agent-edit-applied', payload: { kind: 'insert_text', chars: 5 } }],
        }),
        JSON.stringify({ type: 'done' }),
      ])) as typeof fetch

    const chunks = await collect(
      runPythonAgentStream({
        runId: 'run-2',
        messages: [],
        editorContextKind: null,
        selectedText: null,
        mode: 'insert',
        abortController: new AbortController(),
      }),
    )

    const toolStart = chunks.find((c) => c.type === 'TOOL_CALL_START')
    const toolEnd = chunks.find((c) => c.type === 'TOOL_CALL_END')
    const custom = chunks.find((c) => c.type === 'CUSTOM')

    expect(toolStart).toMatchObject({ toolName: 'insert_text' })
    expect(toolEnd).toMatchObject({
      toolName: 'insert_text',
      input: { text: 'hello' },
      result: JSON.stringify({ ok: true, insertedChars: 5 }),
    })
    expect(custom).toMatchObject({ name: 'agent-edit-applied', value: { kind: 'insert_text', chars: 5 } })
  })

  it('yields RUN_ERROR when the python server is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch

    const chunks = await collect(
      runPythonAgentStream({
        runId: 'run-3',
        messages: [],
        editorContextKind: null,
        selectedText: null,
        mode: 'insert',
        abortController: new AbortController(),
      }),
    )

    expect(chunks[0]).toMatchObject({ type: 'RUN_STARTED' })
    expect(chunks[1]).toMatchObject({ type: 'RUN_ERROR' })
    expect((chunks[1] as { error: { message: string } }).error.message).toContain('ECONNREFUSED')
  })

  it('chunks produced from a streaming-edit turn are correctly intercepted by routeAgentStreamChunks', async () => {
    globalThis.fetch = (async () =>
      ndjsonResponse([
        JSON.stringify({ type: 'text_delta', delta: 'Once ' }),
        JSON.stringify({ type: 'text_delta', delta: 'upon a time' }),
        JSON.stringify({ type: 'done' }),
      ])) as typeof fetch

    const pythonStream = runPythonAgentStream({
      runId: 'run-4',
      messages: [],
      editorContextKind: null,
      selectedText: null,
      mode: 'insert',
      abortController: new AbortController(),
    })

    // Simulates the runtime already being in an active streaming edit (as it
    // would be after a real start_streaming_edit tool call executed via the
    // bridge route in a real run).
    const runtime = createRouterStub(true)
    const routed = await collect(routeAgentStreamChunks(pythonStream, runtime))

    expect(runtime.pushed).toEqual(['Once ', 'upon a time'])
    const customNames = routed.filter((c) => c.type === 'CUSTOM').map((c) => (c as { name: string }).name)
    expect(customNames).toContain('streaming-insert-start')
    expect(customNames).toContain('streaming-insert-delta')
    expect(customNames).toContain('streaming-insert-end')
    // Raw TEXT_MESSAGE_* chunks must NOT leak through while suppressed.
    expect(routed.some((c) => c.type === 'TEXT_MESSAGE_CONTENT')).toBe(false)
  })
})
