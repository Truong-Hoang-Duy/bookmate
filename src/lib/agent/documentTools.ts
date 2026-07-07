import { toolDefinition } from '@tanstack/ai'
import { DOCUMENT_TOOL_SCHEMAS, executeDocumentTool } from './documentToolDispatch'
import { DocumentToolRuntime } from './documentToolRuntime'

const getDocumentSnapshotDef = toolDefinition({
  name: 'get_document_snapshot',
  description:
    'Read a plain-text snapshot of the current document so you can decide where to edit.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.get_document_snapshot,
})

const getSelectionSnapshotDef = toolDefinition({
  name: 'get_selection_snapshot',
  description:
    'Read the currently active selection, if there is one, including the selected text and exact range. Use this when the user refers to "this" or the current selection and you want to inspect it before editing.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.get_selection_snapshot,
})

const getCursorContextDef = toolDefinition({
  name: 'get_cursor_context',
  description:
    'Read nearby plain-text context around the current cursor location. Use this when the user says "here" and you want to inspect the insertion point before editing.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.get_cursor_context,
})

const searchTextDef = toolDefinition({
  name: 'search_text',
  description:
    'Search for exact text inside the document and return stable match handles with surrounding context.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.search_text,
})

const replaceMatchesDef = toolDefinition({
  name: 'replace_matches',
  description:
    'Replace multiple previously found exact matches in one step. Use this after search_text when the user wants the same exact text changed in several places, such as renaming a character throughout the document. Set contentFormat to markdown when the replacement string uses inline markdown like **bold**, *italic*, or `code` and should become formatting instead of literal punctuation.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.replace_matches,
})

const placeCursorDef = toolDefinition({
  name: 'place_cursor',
  description:
    'Place the agent cursor at the start or end of a previously returned match handle.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.place_cursor,
})

const placeCursorAtDocumentBoundaryDef = toolDefinition({
  name: 'place_cursor_at_document_boundary',
  description:
    'Place the agent cursor at the very start or very end of the document. Use this for requests like adding a title at the top or appending exact text at the end.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.place_cursor_at_document_boundary,
})

const insertParagraphBreakDef = toolDefinition({
  name: 'insert_paragraph_break',
  description:
    'Create a new empty paragraph block at the current cursor position and move the cursor into it. Use this when the user asks for a second paragraph, a new paragraph, or a closing paragraph as a distinct block.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.insert_paragraph_break,
})

const selectTextDef = toolDefinition({
  name: 'select_text',
  description: 'Select the exact text represented by a previously returned match handle.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.select_text,
})

const selectCurrentBlockDef = toolDefinition({
  name: 'select_current_block',
  description:
    'Select the full current text block around the cursor. Use this for formatting or rewriting the current line/paragraph when you already know the cursor is in the right block.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.select_current_block,
})

const selectBetweenMatchesDef = toolDefinition({
  name: 'select_between_matches',
  description:
    'Create a selection between two previously returned matches, choosing start/end edges for each.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.select_between_matches,
})

const clearSelectionDef = toolDefinition({
  name: 'clear_selection',
  description: 'Clear the current selection while keeping the current cursor target.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.clear_selection,
})

const setFormatDef = toolDefinition({
  name: 'set_format',
  description:
    'Apply formatting to the current selection. Use this after selecting text for marks like bold/italic/code or block formats like paragraph, heading, bullet list, or ordered list.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.set_format,
})

const insertTextDef = toolDefinition({
  name: 'insert_text',
  description:
    'Insert text at the current cursor. If a selection exists, it will be replaced. Use plain_text for exact literal strings that should appear verbatim in the document. Set contentFormat to markdown when short inline markdown like **bold**, *italic*, or `code` should become real formatting instead of literal punctuation.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.insert_text,
})

const deleteSelectionDef = toolDefinition({
  name: 'delete_selection',
  description: 'Delete the current selection, if there is one.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.delete_selection,
})

const startStreamingEditDef = toolDefinition({
  name: 'start_streaming_edit',
  description:
    'Arm the next assistant text message for document insertion at the current cursor or selection. Use this when the user wants actual document prose written, such as a story, paragraph, continuation, or rewrite. While active, output only document prose, not explanations. Set contentFormat to markdown when you want streamed markdown to become structured document formatting. Use rewrite mode only when a selection is already set.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.start_streaming_edit,
})

const stopStreamingEditDef = toolDefinition({
  name: 'stop_streaming_edit',
  description:
    'Stop the currently armed streaming edit. Normally the server auto-stops at message end, so this is mainly for cancelling or early exit.',
  inputSchema: DOCUMENT_TOOL_SCHEMAS.stop_streaming_edit,
})

export function createDocumentTools(runtime: DocumentToolRuntime) {
  return [
    getDocumentSnapshotDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'get_document_snapshot', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    getSelectionSnapshotDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'get_selection_snapshot', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    getCursorContextDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'get_cursor_context', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    searchTextDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'search_text', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    replaceMatchesDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'replace_matches', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    placeCursorDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'place_cursor', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    placeCursorAtDocumentBoundaryDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'place_cursor_at_document_boundary', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    insertParagraphBreakDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'insert_paragraph_break', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    selectTextDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'select_text', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    selectCurrentBlockDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'select_current_block', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    selectBetweenMatchesDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'select_between_matches', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    clearSelectionDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'clear_selection', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    setFormatDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'set_format', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    insertTextDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'insert_text', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    deleteSelectionDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'delete_selection', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    startStreamingEditDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'start_streaming_edit', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
    stopStreamingEditDef.server(async (input, context) => {
      const { result, customEvents } = executeDocumentTool(runtime, 'stop_streaming_edit', input)
      for (const e of customEvents) context?.emitCustomEvent(e.name, e.payload)
      return result
    }),
  ]
}
