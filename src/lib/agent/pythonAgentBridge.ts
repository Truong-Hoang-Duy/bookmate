import type { StreamChunk } from '@tanstack/ai'

/**
 * Translates the Python agent server's simple NDJSON protocol (see
 * `agent-server/agent_server.py`) into the same
 * `AGUIEvent`/`StreamChunk` shapes `@tanstack/ai`'s own `chat()` produces, so
 * the rest of the pipeline (`routeAgentStreamChunks`,
 * `toDurableChatSessionResponse`, and the real browser `useChat`) doesn't
 * need to know or care that a different "brain" generated them.
 *
 * Python NDJSON line shapes (one JSON object per line):
 *   {"type":"text_delta","delta":"..."}
 *   {"type":"message_end"}
 *   {"type":"tool_call","name":"...","args":{...},"result":..., "customEvents":[{"name":"...","payload":{...}}]}
 *   {"type":"done"}
 *   {"type":"error","message":"..."}
 */

export interface PythonAgentRunInput {
  runId: string
  messages: Array<{ role: string; content: string }>
  editorContextKind: 'cursor' | 'selection' | null
  selectedText: string | null
  mode: 'continue' | 'insert' | 'rewrite'
  abortController: AbortController
}

async function* readNdjsonLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) yield line
        newlineIndex = buffer.indexOf('\n')
      }
    }
    const rest = buffer.trim()
    if (rest) yield rest
  } finally {
    reader.releaseLock()
  }
}

export async function* runPythonAgentStream(input: PythonAgentRunInput): AsyncIterable<StreamChunk> {
  const baseUrl = (process.env.PYTHON_AGENT_BASE_URL?.trim() || 'http://127.0.0.1:8787').replace(/\/$/, '')

  yield { type: 'RUN_STARTED', timestamp: Date.now(), runId: input.runId } as StreamChunk

  input.abortController.signal.addEventListener('abort', () => {
    fetch(`${baseUrl}/agent/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: input.runId }),
    }).catch(() => {

    })
  })

  let response: Response
  try {
    console.log({
      runId: input.runId,
      editorContextKind: input.editorContextKind,
      selectedText: input.selectedText,
      messages: input.messages,
      mode: input.mode,
    });

    response = await fetch(`${baseUrl}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: input.runId,
        editorContextKind: input.editorContextKind,
        selectedText: input.selectedText,
        messages: input.messages,
        mode: input.mode,
      }),
      signal: input.abortController.signal,
    })
  } catch (error) {
    yield {
      type: 'RUN_ERROR',
      timestamp: Date.now(),
      error: {
        message: `Không thể kết nối tới Python agent server (${baseUrl}). Đã chạy "python agent_server.py" chưa? Chi tiết: ${error instanceof Error ? error.message : String(error)
          }`,
      },
    } as StreamChunk
    return
  }

  if (!response.ok || !response.body) {
    yield {
      type: 'RUN_ERROR',
      timestamp: Date.now(),
      error: { message: `Python agent server trả về lỗi HTTP ${response.status}` },
    } as StreamChunk
    return
  }

  let currentMessageId: string | null = null

  function closeCurrentMessage(): StreamChunk | null {
    if (!currentMessageId) return null
    const chunk = { type: 'TEXT_MESSAGE_END', timestamp: Date.now(), messageId: currentMessageId } as StreamChunk
    currentMessageId = null
    return chunk
  }

  try {
    for await (const line of readNdjsonLines(response.body)) {
      let event: Record<string, unknown>
      try {
        event = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // skip a malformed line rather than aborting the whole run
      }

      switch (event.type) {
        case 'text_delta': {
          const delta = typeof event.delta === 'string' ? event.delta : ''
          if (!currentMessageId) {
            currentMessageId = crypto.randomUUID()
            yield {
              type: 'TEXT_MESSAGE_START',
              timestamp: Date.now(),
              messageId: currentMessageId,
              role: 'assistant',
            } as StreamChunk
          }
          yield {
            type: 'TEXT_MESSAGE_CONTENT',
            timestamp: Date.now(),
            messageId: currentMessageId,
            delta,
          } as StreamChunk
          break
        }
        case 'message_end': {
          const closeChunk = closeCurrentMessage()
          if (closeChunk) yield closeChunk
          break
        }
        case 'tool_call': {
          const closeChunk = closeCurrentMessage()
          if (closeChunk) yield closeChunk

          const toolCallId = crypto.randomUUID()
          const toolName = typeof event.name === 'string' ? event.name : 'unknown_tool'
          yield { type: 'TOOL_CALL_START', timestamp: Date.now(), toolCallId, toolName } as StreamChunk
          yield {
            type: 'TOOL_CALL_END',
            timestamp: Date.now(),
            toolCallId,
            toolName,
            input: event.args,
            result: typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? null),
          } as StreamChunk

          const customEvents = Array.isArray(event.customEvents) ? event.customEvents : []
          for (const custom of customEvents) {
            if (custom && typeof custom === 'object') {
              const c = custom as { name?: unknown; payload?: unknown }
              if (typeof c.name === 'string') {
                yield { type: 'CUSTOM', timestamp: Date.now(), name: c.name, value: c.payload } as StreamChunk
              }
            }
          }
          break
        }
        case 'error': {
          const closeChunk = closeCurrentMessage()
          if (closeChunk) yield closeChunk
          const message = typeof event.message === 'string' ? event.message : 'Lỗi không xác định từ Python agent'
          yield { type: 'RUN_ERROR', timestamp: Date.now(), error: { message } } as StreamChunk
          return
        }
        case 'done': {
          const closeChunk = closeCurrentMessage()
          if (closeChunk) yield closeChunk
          yield {
            type: 'RUN_FINISHED',
            timestamp: Date.now(),
            runId: input.runId,
            finishReason: 'stop',
          } as StreamChunk
          return
        }
        default:
          break
      }
    }
  } catch (error) {
    const closeChunk = closeCurrentMessage()
    if (closeChunk) yield closeChunk
    yield {
      type: 'RUN_ERROR',
      timestamp: Date.now(),
      error: { message: error instanceof Error ? error.message : String(error) },
    } as StreamChunk
    return
  }

  // Stream ended without an explicit "done" line (e.g. Python crashed) — still
  // close out gracefully so the UI doesn't hang waiting for RUN_FINISHED.
  const closeChunk = closeCurrentMessage()
  if (closeChunk) yield closeChunk
  yield { type: 'RUN_FINISHED', timestamp: Date.now(), runId: input.runId, finishReason: 'stop' } as StreamChunk
}
