import { createFileRoute } from '@tanstack/react-router'
import type { StreamChunk } from '@tanstack/ai'
import {
  toDurableChatSessionResponse,
  type WaitUntil,
} from '@durable-streams/tanstack-ai-transport'
import type { DurableSessionMessage } from '@durable-streams/tanstack-ai-transport'
import { attachAgentRunController, releaseAgentRunAbort } from '../../lib/agent/agentRunCancellation'
import { parseChatBody, routeAgentStreamChunks, toModelMessages } from '../../lib/agent/chatStreamRouting'
import { buildChatToolSystemPrompt, buildEditorContextSystemPrompt } from '../../lib/agent/prompts'
import { DocumentToolRuntime } from '../../lib/agent/documentToolRuntime'
import type { EditorContextPayload } from '../../lib/agent/editorContext'
import { runPythonAgentStream } from '../../lib/agent/pythonAgentBridge'
import { registerBridgeRun, releaseBridgeRun } from '../../lib/agent/pythonBridgeRegistry'
import {
  chatSessionStreamPath,
  durableStreamResourceUrl,
  getTanStackAiDurableStreamsHeadersServer,
  getTanStackAiDurableStreamsOriginServer,
} from '../../lib/yjs/streamIds'

function latestUserMessage(messages: DurableSessionMessage[]): DurableSessionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'user') {
      return m
    }
  }
  return null
}

function resolveWaitUntil(
  request: Request,
  context: { waitUntil?: WaitUntil } | undefined,
): WaitUntil | undefined {
  if (typeof context?.waitUntil === 'function') {
    return context.waitUntil
  }

  const requestWithContext = request as Request & {
    context?: { waitUntil?: WaitUntil }
    waitUntil?: WaitUntil
  }

  if (typeof requestWithContext.waitUntil === 'function') {
    return requestWithContext.waitUntil
  }

  if (typeof requestWithContext.context?.waitUntil === 'function') {
    return requestWithContext.context.waitUntil
  }

  return undefined
}

async function* agentResponseStream(input: {
  docKey: string
  sessionId: string
  mode: 'continue' | 'insert' | 'rewrite'
  messages: DurableSessionMessage[]
  runAgent: boolean
  editorContext?: EditorContextPayload
}): AsyncIterable<StreamChunk> {
  if (!input.runAgent) return

  const abortController = attachAgentRunController(input.docKey, input.sessionId)
  let runtime: DocumentToolRuntime | null = null
  let bridgeRunId: string | null = null

  try {
    runtime = await DocumentToolRuntime.create({
      docKey: input.docKey,
      sessionId: input.sessionId,
      signal: abortController.signal,
      editorContext: input.editorContext,
    })
    const selectionSnapshot = runtime.getSelectionSnapshot()
    const editorContextPrompt = buildEditorContextSystemPrompt({
      editorContext: input.editorContext,
      selectedText: selectionSnapshot?.text,
    })

    // Python (agent_server.py) owns tool-call decisions + its own closing
    // summary for this turn; real document mutations still run through the
    // same `runtime` via the bridge route (src/routes/api/agent-bridge/tool.ts).
    bridgeRunId = crypto.randomUUID()
    registerBridgeRun(bridgeRunId, runtime)

    const pythonStream = runPythonAgentStream({
      runId: bridgeRunId,
      messages: toModelMessages(input.messages) as any,
      systemPrompt: [buildChatToolSystemPrompt(input.mode), editorContextPrompt]
        .filter((p): p is string => Boolean(p))
        .join(' '),
      mode: input.mode,
      abortController,
    })

    for await (const chunk of routeAgentStreamChunks(pythonStream, runtime)) {
      yield chunk
    }
  } catch (error) {
    const chunk: StreamChunk = {
      type: 'RUN_ERROR',
      timestamp: Date.now(),
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    }
    yield chunk
    yield {
      type: 'CUSTOM',
      timestamp: Date.now(),
      name: 'agent-run-error',
      value: {
        sessionId: input.sessionId,
      },
    }
    console.error('[chat] agent response stream failed', error)
  } finally {
    try {
      if (runtime && runtime.isStreamingEditActive()) {
        runtime.stopStreamingEdit(abortController.signal.aborted)
      }
    } finally {
      if (bridgeRunId) releaseBridgeRun(bridgeRunId)
      await runtime?.destroy()
      releaseAgentRunAbort(input.docKey, input.sessionId, abortController)
    }
  }
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({
        request,
        context,
      }: {
        request: Request
        context?: { waitUntil?: WaitUntil }
      }) => {
        const url = new URL(request.url)
        const docKey = url.searchParams.get('docKey')
        const sessionId = url.searchParams.get('sessionId') ?? 'default'
        if (!docKey) {
          return Response.json({ error: 'docKey is required' }, { status: 400 })
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const { messages, runAgent, agentMode, editorContext } = parseChatBody(body)
        const origin = getTanStackAiDurableStreamsOriginServer()
        const headers = getTanStackAiDurableStreamsHeadersServer()
        const streamPath = chatSessionStreamPath(docKey, sessionId)
        const writeUrl = durableStreamResourceUrl(origin, streamPath)

        const latestUser = latestUserMessage(messages)
        const newMessages = latestUser ? [latestUser] : []
        const waitUntil = resolveWaitUntil(request, context)

        return toDurableChatSessionResponse({
          stream: {
            writeUrl,
            ...(headers ? { headers } : {}),
            createIfMissing: true,
          },
          newMessages,
          responseStream: agentResponseStream({
            docKey,
            sessionId,
            mode: agentMode,
            messages,
            runAgent,
            editorContext,
          }),
          waitUntil,
        })
      },
    },
  },
} as never)
