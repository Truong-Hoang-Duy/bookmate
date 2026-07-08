import type { DocumentToolRuntime } from './documentToolRuntime'


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
