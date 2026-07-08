import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DocumentToolRuntime } from '../../src/lib/agent/documentToolRuntime'
import { registerBridgeRun, releaseBridgeRun } from '../../src/lib/agent/pythonBridgeRegistry'
import { handleAgentBridgeToolRequest } from '../../src/routes/api/agent/bridge-tool'
import { createTestSession, readDocText } from './testUtils'

const SECRET = 'test-secret'

function postTool(body: unknown, headers: Record<string, string> = { 'X-Agent-Bridge-Token': SECRET }) {
  return handleAgentBridgeToolRequest(
    new Request('http://localhost/api/agent/bridge-tool', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

describe('agent bridge tool route', () => {
  const originalSecret = process.env.AGENT_BRIDGE_SECRET

  beforeEach(() => {
    process.env.AGENT_BRIDGE_SECRET = SECRET
  })

  afterEach(() => {
    process.env.AGENT_BRIDGE_SECRET = originalSecret
  })

  it('rejects requests with a missing or wrong secret', async () => {
    const missing = await postTool({ runId: 'x', name: 'insert_text', input: {} }, {})
    expect(missing.status).toBe(401)

    const wrong = await postTool(
      { runId: 'x', name: 'insert_text', input: {} },
      { 'X-Agent-Bridge-Token': 'nope' },
    )
    expect(wrong.status).toBe(401)
  })

  it('returns 404 for an unknown runId without touching any document', async () => {
    const res = await postTool({ runId: 'does-not-exist', name: 'insert_text', input: { text: 'hi' } })
    expect(res.status).toBe(404)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(false)
  })

  it('rejects an unknown tool name', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    registerBridgeRun('run-unknown-tool', runtime)

    const res = await postTool({ runId: 'run-unknown-tool', name: 'delete_everything', input: {} })
    expect(res.status).toBe(400)

    releaseBridgeRun('run-unknown-tool')
    runtime.destroy()
  })

  it('rejects input that fails schema validation', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    registerBridgeRun('run-bad-input', runtime)

    const res = await postTool({ runId: 'run-bad-input', name: 'place_cursor_at_document_boundary', input: {} })
    expect(res.status).toBe(400)

    releaseBridgeRun('run-bad-input')
    runtime.destroy()
  })

  it('executes insert_text against the real runtime and returns custom events', async () => {
    const session = createTestSession()
    const runtime = DocumentToolRuntime.createForSession({ session })
    registerBridgeRun('run-insert', runtime)

    const res = await postTool({
      runId: 'run-insert',
      name: 'insert_text',
      input: { text: 'hello from bridge' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; result: unknown; customEvents: Array<{ name: string }> }
    expect(json.ok).toBe(true)
    expect(json.customEvents).toEqual([expect.objectContaining({ name: 'agent-edit-applied' })])
    expect(readDocText(session)).toContain('hello from bridge')

    releaseBridgeRun('run-insert')
    runtime.destroy()
  })
})
