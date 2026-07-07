# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## Project overview

`collaborative-ai-editor` is a demo of [Durable Streams](http://durablestreams.com)
as the transport/persistence layer for a collaborative AI writing app. Two
Durable Streams integrations are combined:

- **Durable Streams + Yjs** — shared ProseMirror document collaboration over plain HTTP.
- **Durable Streams + TanStack AI** — resilient chat sessions, streamed model output, tool-driven agent interaction.

An AI collaborator called **Electra** joins the shared document as a
server-side peer, inspects/edits it through tools, and streams generated
content directly into the document while also chatting in the sidebar.

See `README.md` for the full tech stack, setup, and deployment notes.

## Tech stack

- **App framework**: TanStack Start + TanStack Router (file-based routing) + React + Vite + TypeScript.
- **Collaborative editor**: ProseMirror + Yjs (CRDT) + `y-prosemirror` + `y-protocols` (awareness/presence).
- **Durable Streams**: `@durable-streams/y-durable-streams` (Yjs sync), `@durable-streams/tanstack-ai-transport` (chat transport), `@durable-streams/server` (local dev server).
- **AI stack**: `@tanstack/ai` (model/tool loop), `@tanstack/ai-react` (`useChat`), `@tanstack/ai-openai` (OpenAI adapter), OpenAI Responses API.
- **Validation**: `zod` for all tool input schemas.
- Package manager: **pnpm** (`packageManager: pnpm@10.15.0` in `package.json`).

## Key directories

```
src/routes/api/            # TanStack Start server routes (real API routes)
  chat.ts                  # POST /api/chat - runs the agent (chat() call + tool loop)
  chat-stream.ts           # GET  /api/chat-stream - proxies the Durable Stream read side
  agent/stop.ts            # POST /api/agent/stop - cancels an in-flight agent run
  yjs/                      # Yjs proxy routes
  agent-python-demo/       # standalone Python/pydantic learning demo — see below, NOT a real route

src/lib/agent/             # the real agent runtime
  documentTools.ts          # tool definitions (toolDefinition + zod schema + .server(fn))
  documentToolDispatch.ts   # shared tool-execution core (schemas + runtime calls), used by
                            #   both documentTools.ts (@tanstack/ai path) and the Python bridge route
  documentToolRuntime.ts    # DocumentToolRuntime - real tool logic over Yjs/ProseMirror
  prompts.ts                # system prompt builders (plain string concatenation, no template lib)
  chatStreamRouting.ts      # request parsing + stream-chunk routing/interception
  serverAgentSession.ts     # Yjs "agent peer" session + awareness + logging
  agentRunCancellation.ts   # per-(docKey,sessionId) AbortController registry
  pythonBridgeRegistry.ts   # runId -> live DocumentToolRuntime, for the Python agent bridge
  pythonAgentBridge.ts      # translates agent_server.py's NDJSON into StreamChunk/AGUIEvent

src/lib/chat/               # chat transport glue (createDurableChatConnection)
src/dev/durableStreamsServer.ts  # local dev Durable Streams + Yjs server bootstrap
tests/agent/*.test.ts       # deterministic unit tests
tests/evals/liveAgentModelEvals.ts  # live, model-backed evals (pnpm test:evals)
```

## Conventions to follow when touching the real agent code

- **Tools**: defined with `toolDefinition({ name, description, inputSchema: zod... })`
  from `@tanstack/ai`, then given a server executor via `.server(async (input, context) => ...)`.
  Each executor calls into a matching method on `DocumentToolRuntime` and often
  calls `context?.emitCustomEvent(name, payload)` to surface a `CUSTOM` stream
  chunk for the client UI (`agent-edit-applied`, `agent-cursor-updated`, etc.).
- **Two possible "brains" for `/api/chat`**, switched by `AGENT_BRAIN_MODE`:
  - `tanstack` (rollback path): calls `@tanstack/ai`'s `chat({ tools, ... })`
    **once**; the tool-calling loop is internal to `@tanstack/ai`.
  - `python` (default): delegates the turn to `agent_server.py`, which runs
    an **explicit** tool-calling loop itself and calls back into Node's
    `/api/agent-bridge/tool` to execute each tool for real. Either way,
    `routeAgentStreamChunks` and `toDurableChatSessionResponse` are reused
    unchanged — both paths just produce the same `StreamChunk`/`AGUIEvent`
    shapes (see `src/lib/agent/pythonAgentBridge.ts` for the translation).
- **Two model calls per turn when edits happen**: after the main tool-driven
  run, if the document was mutated and the assistant didn't already send a
  closing chat message, a second, separate, tool-less `chat()` call
  (`postEditSummaryStream`) generates a one-line "here's what I changed"
  message for the chat sidebar.
- **Logging**: plain `console.<level>('[tag]', event, { ...data })`, no custom
  logger abstraction. Tags are per-module/session, e.g. `` `[agent-session:${sessionId}]` ``.
  Use `error`/`warn` for failure paths, `info` for lifecycle/status events.
- **Imports**: path aliases `#/*` and `@/*` both resolve to `src/*` (see
  `package.json` `imports` field and `tsconfig.json` `paths`), but existing
  agent code mostly uses relative imports — either is fine for new code.

## Commands

- `pnpm dev` — run app + Durable Streams + Yjs servers together
- `pnpm dev:app` / `pnpm dev:ds` — run app only / servers only
- `pnpm test:unit` — deterministic unit tests (Vitest)
- `pnpm test:evals` — live, OpenAI-backed evals (needs `OPENAI_API_KEY`)
- `pnpm typecheck` — TypeScript checks
- `pnpm build` — production build
- `pnpm preview:cloudflare` / `pnpm deploy:cloudflare` — Cloudflare Workers preview/deploy

## `src/routes/api/agent-python-demo/`

Not a real TanStack Start route (TanStack Router only picks up `.ts`/`.tsx`
files, so `.py` files here don't affect routing). This is a real, opt-in
alternate "brain" for the live app's chat:

- **`agent_server.py`** — when the root `.env` has `AGENT_BRAIN_MODE=python`
  (the default — set it to `tanstack` to revert), `src/routes/api/chat.ts`
  sends the turn to this FastAPI server instead of calling `@tanstack/ai`'s
  `chat()`. Python runs an explicit tool-calling loop against real OpenAI
  streaming and decides tool calls; actual document mutations still happen
  in Node via the existing `DocumentToolRuntime`, reached through the
  internal `POST /api/agent-bridge/tool` route
  (`src/routes/api/agent-bridge/tool.ts`, guarded by `AGENT_BRIDGE_SECRET`).
  Requires running `python agent_server.py` alongside `pnpm dev` — see this
  folder's `README.md` for the full architecture diagram and setup.
- **`agent_shared.py`** — pydantic schemas + tool name/description table
  (Vietnamese, translated from `documentToolDispatch.ts`) used by
  `agent_server.py`. System prompts are NOT here — `agent_server.py` uses
  the real prompt text sent over by Node via `/agent/run`, so there's a
  single source of truth for agent instructions.

Rules:
- Do not wire any of this into `package.json`, `pnpm build`, or
  `pnpm typecheck` — it's Python, run independently.
- Don't delete it as part of "unused route" cleanup — `AGENT_BRAIN_MODE`
  defaults to `python`, so the live chat backend actually depends on
  `agent_server.py` being run; it's not dead code.
- `agent_server.py` / the bridge route are **local-dev-only** — they cannot
  run on the Cloudflare Workers deployment described in the root `README.md`
  (no Python runtime there). Don't enable `AGENT_BRAIN_MODE=python` in a
  deployed environment.
- When editing the real TypeScript agent (`documentTools.ts`,
  `documentToolDispatch.ts`, `prompts.ts`), the Python side will drift out of
  sync since nothing keeps them in lockstep automatically — treat it as a
  snapshot, not a spec.
