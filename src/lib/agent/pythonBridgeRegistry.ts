import type { DocumentToolRuntime } from './documentToolRuntime'

/**
 * In-memory registry mapping a chat run's `runId` to the live
 * `DocumentToolRuntime` handling that turn, so the Python agent bridge route
 * (`src/routes/api/agent-bridge/tool.ts`) can look up which runtime to
 * execute a tool call against. Modeled on `agentRunCancellation.ts`'s
 * `Map`-based pattern.
 */
const runtimes = new Map<string, DocumentToolRuntime>()

export function registerBridgeRun(runId: string, runtime: DocumentToolRuntime): void {
  runtimes.set(runId, runtime)
}

export function getBridgeRun(runId: string): DocumentToolRuntime | undefined {
  return runtimes.get(runId)
}

export function releaseBridgeRun(runId: string): void {
  runtimes.delete(runId)
}
