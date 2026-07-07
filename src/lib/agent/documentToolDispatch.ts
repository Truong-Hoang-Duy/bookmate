import { z } from 'zod'
import { DocumentToolRuntime } from './documentToolRuntime'
import type { FormatAction, FormatKind, FormatName } from './documentToolRuntime'
import type { AgentRunMode } from './types'

/**
 * Single source of truth for the 17 document tools' input schemas and
 * execution logic, shared by the real `@tanstack/ai` tool wiring
 * (`documentTools.ts`) and the Python-agent bridge route
 * (`src/routes/api/agent-bridge/tool.ts`). Framework-agnostic on purpose:
 * no `@tanstack/ai` types appear here.
 */
export const DOCUMENT_TOOL_SCHEMAS = {
  get_document_snapshot: z.object({
    startChar: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(200).max(12000).optional(),
  }),
  get_selection_snapshot: z.object({}),
  get_cursor_context: z.object({
    maxCharsBefore: z.number().int().min(0).max(1000).optional(),
    maxCharsAfter: z.number().int().min(0).max(1000).optional(),
  }),
  search_text: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),
  replace_matches: z.object({
    matchIds: z.array(z.string().min(1)).min(1).max(50),
    text: z.string(),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
  place_cursor: z.object({
    matchId: z.string().min(1),
    edge: z.enum(['start', 'end']).optional(),
  }),
  place_cursor_at_document_boundary: z.object({
    boundary: z.enum(['start', 'end']),
  }),
  insert_paragraph_break: z.object({}),
  select_text: z.object({
    matchId: z.string().min(1),
  }),
  select_current_block: z.object({}),
  select_between_matches: z.object({
    startMatchId: z.string().min(1),
    endMatchId: z.string().min(1),
    startEdge: z.enum(['start', 'end']).optional(),
    endEdge: z.enum(['start', 'end']).optional(),
  }),
  clear_selection: z.object({}),
  set_format: z.object({
    kind: z.enum(['mark', 'block']),
    format: z.enum(['bold', 'italic', 'code', 'paragraph', 'heading', 'bullet_list', 'ordered_list']),
    action: z.enum(['add', 'remove', 'toggle', 'set']).optional(),
    level: z.number().int().min(1).max(6).optional(),
  }),
  insert_text: z.object({
    text: z.string(),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
  delete_selection: z.object({}),
  start_streaming_edit: z.object({
    mode: z.enum(['continue', 'insert', 'rewrite']),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
  stop_streaming_edit: z.object({}),
} as const

export type DocumentToolName = keyof typeof DOCUMENT_TOOL_SCHEMAS

export const DOCUMENT_TOOL_NAMES = Object.keys(DOCUMENT_TOOL_SCHEMAS) as DocumentToolName[]

export interface DocumentToolCustomEvent {
  name: string
  payload: Record<string, unknown>
}

export interface DocumentToolDispatchResult {
  result: unknown
  customEvents: DocumentToolCustomEvent[]
}

export function isDocumentToolName(name: string): name is DocumentToolName {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TOOL_SCHEMAS, name)
}

/** Validates raw (untrusted) input against a tool's schema. Callers that
 * receive input from outside the `@tanstack/ai` framework (e.g. the Python
 * bridge route) should call this before `executeDocumentTool`. The
 * `@tanstack/ai` tool-calling path already validates via `inputSchema`
 * before invoking `.server()`, so `executeDocumentTool` itself does not
 * re-validate — it trusts the caller. */
export function parseDocumentToolInput(name: DocumentToolName, rawInput: unknown) {
  return DOCUMENT_TOOL_SCHEMAS[name].parse(rawInput)
}

type Input<K extends DocumentToolName> = z.infer<(typeof DOCUMENT_TOOL_SCHEMAS)[K]>

export function executeDocumentTool(
  runtime: DocumentToolRuntime,
  name: string,
  rawInput: unknown,
): DocumentToolDispatchResult {
  if (!isDocumentToolName(name)) {
    throw new Error(`Unknown tool: ${name}`)
  }

  switch (name) {
    case 'get_document_snapshot': {
      const { startChar, maxChars } = rawInput as Input<'get_document_snapshot'>
      return { result: runtime.getDocumentSnapshot(maxChars, startChar), customEvents: [] }
    }
    case 'get_selection_snapshot': {
      const snapshot = runtime.getSelectionSnapshot()
      return {
        result: snapshot ? { ok: true, ...snapshot } : { ok: false, reason: 'No active selection' },
        customEvents: [],
      }
    }
    case 'get_cursor_context': {
      const { maxCharsBefore, maxCharsAfter } = rawInput as Input<'get_cursor_context'>
      const context = runtime.getCursorContext(maxCharsBefore, maxCharsAfter)
      return {
        result: context ? { ok: true, ...context } : { ok: false, reason: 'No active cursor' },
        customEvents: [],
      }
    }
    case 'search_text': {
      const { query, maxResults } = rawInput as Input<'search_text'>
      return { result: { ok: true, matches: runtime.searchText(query, maxResults) }, customEvents: [] }
    }
    case 'replace_matches': {
      const { matchIds, text, contentFormat } = rawInput as Input<'replace_matches'>
      const result = runtime.replaceMatches(matchIds, text, contentFormat ?? 'plain_text')
      return {
        result,
        customEvents: [
          {
            name: 'agent-edit-applied',
            payload: { kind: 'replace_matches', count: result.replacedCount, chars: text.length },
          },
        ],
      }
    }
    case 'place_cursor': {
      const { matchId, edge } = rawInput as Input<'place_cursor'>
      const result = runtime.placeCursor(matchId, edge)
      return {
        result,
        customEvents: [{ name: 'agent-cursor-updated', payload: { matchId, edge: edge ?? 'start' } }],
      }
    }
    case 'place_cursor_at_document_boundary': {
      const { boundary } = rawInput as Input<'place_cursor_at_document_boundary'>
      const result = runtime.placeCursorAtDocumentBoundary(boundary)
      return { result, customEvents: [{ name: 'agent-cursor-updated', payload: { boundary } }] }
    }
    case 'insert_paragraph_break': {
      const result = runtime.insertParagraphBreak()
      return { result, customEvents: [{ name: 'agent-edit-applied', payload: { kind: 'insert_paragraph_break' } }] }
    }
    case 'select_text': {
      const { matchId } = rawInput as Input<'select_text'>
      const result = runtime.selectText(matchId)
      return { result, customEvents: [{ name: 'agent-selection-updated', payload: { matchId } }] }
    }
    case 'select_current_block': {
      const result = runtime.selectCurrentBlock()
      return {
        result,
        customEvents: [{ name: 'agent-selection-updated', payload: { currentBlock: true } }],
      }
    }
    case 'select_between_matches': {
      const { startMatchId, endMatchId, startEdge, endEdge } = rawInput as Input<'select_between_matches'>
      const result = runtime.selectBetweenMatches(startMatchId, endMatchId, startEdge, endEdge)
      return {
        result,
        customEvents: [{ name: 'agent-selection-updated', payload: { startMatchId, endMatchId } }],
      }
    }
    case 'clear_selection': {
      const result = runtime.clearSelection()
      return { result, customEvents: [{ name: 'agent-selection-cleared', payload: {} }] }
    }
    case 'set_format': {
      const { kind, format, action, level } = rawInput as Input<'set_format'>
      const result = runtime.setFormat({
        kind: kind as FormatKind,
        format: format as FormatName,
        action: action as FormatAction | undefined,
        level,
      })
      return {
        result,
        customEvents: [
          {
            name: 'agent-format-applied',
            payload: {
              kind,
              format,
              action: result.action,
              ...(typeof level === 'number' ? { level } : {}),
            },
          },
        ],
      }
    }
    case 'insert_text': {
      const { text, contentFormat } = rawInput as Input<'insert_text'>
      const result = runtime.insertText(text, contentFormat ?? 'plain_text')
      return {
        result,
        customEvents: [{ name: 'agent-edit-applied', payload: { kind: 'insert_text', chars: text.length } }],
      }
    }
    case 'delete_selection': {
      const result = runtime.deleteSelection()
      return { result, customEvents: [{ name: 'agent-edit-applied', payload: { kind: 'delete_selection' } }] }
    }
    case 'start_streaming_edit': {
      const { mode, contentFormat } = rawInput as Input<'start_streaming_edit'>
      const result = runtime.startStreamingEdit(mode as AgentRunMode, contentFormat ?? 'plain_text')
      return {
        result,
        customEvents: [
          {
            name: 'agent-streaming-edit',
            payload: { active: true, mode, contentFormat: result.contentFormat },
          },
        ],
      }
    }
    case 'stop_streaming_edit': {
      const result = runtime.stopStreamingEdit(false)
      return { result, customEvents: [{ name: 'agent-streaming-edit', payload: { active: false } }] }
    }
  }
}
