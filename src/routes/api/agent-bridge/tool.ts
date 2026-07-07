import { createFileRoute } from '@tanstack/react-router'
import { executeDocumentTool, isDocumentToolName, parseDocumentToolInput } from '../../../lib/agent/documentToolDispatch'
import { getBridgeRun } from '../../../lib/agent/pythonBridgeRegistry'

/**
 * Internal bridge route: the Python agent server (see
 * `src/routes/api/agent-python-demo/agent_server.py`) calls this to execute
 * a real document tool against the live `DocumentToolRuntime` for a chat run,
 * since Python cannot speak the Yjs CRDT protocol directly. Local-dev-only —
 * requires `AGENT_BRIDGE_SECRET` to be configured, and this route is not
 * meant to be reachable from a deployed/public environment.
 */
export async function handleAgentBridgeToolRequest(request: Request): Promise<Response> {
  const expectedSecret = process.env.AGENT_BRIDGE_SECRET
  const providedSecret = request.headers.get('X-Agent-Bridge-Token')
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Expected JSON object' }, { status: 400 })
  }

  const o = body as Record<string, unknown>
  const runId = typeof o.runId === 'string' ? o.runId : null
  const name = typeof o.name === 'string' ? o.name : null
  if (!runId || !name) {
    return Response.json({ error: 'runId and name are required' }, { status: 400 })
  }

  const runtime = getBridgeRun(runId)
  if (!runtime) {
    // Expected outcome once a run has finished/been cancelled — not a server error.
    return Response.json({ ok: false, error: 'unknown runId' }, { status: 404 })
  }

  if (!isDocumentToolName(name)) {
    return Response.json({ ok: false, error: `Unknown tool: ${name}` }, { status: 400 })
  }

  let parsedInput: unknown
  try {
    parsedInput = parseDocumentToolInput(name, o.input)
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'Invalid input' }, { status: 400 })
  }

  try {
    const { result, customEvents } = executeDocumentTool(runtime, name, parsedInput)
    return Response.json(
      { ok: true, result, customEvents },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Tool execution failed' },
      { status: 400 },
    )
  }
}

export const Route = createFileRoute('/api/agent-bridge/tool')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => handleAgentBridgeToolRequest(request),
    },
  },
} as never)
