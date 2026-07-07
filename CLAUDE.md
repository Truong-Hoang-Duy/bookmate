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
- **Chat transport**: `@tanstack/ai-react` (`useChat` hook) over `@durable-streams/tanstack-ai-transport`. `@tanstack/ai` is kept only as the source of the shared `StreamChunk`/`AGUIEvent` wire-format types consumed by both the frontend and `chatStreamRouting.ts`/`pythonAgentBridge.ts` — it does not run any model/tool loop in this repo.
- **Agent brain**: Python (`agent_server.py`, FastAPI) — see "The agent brain" below. This is the only thing that decides tool calls; there is no TypeScript/`@tanstack/ai`-driven fallback.
- **Validation**: `zod` for tool input schemas on the Node side, `pydantic` (mirrored schemas) on the Python side.
- Package manager: **pnpm** (`packageManager: pnpm@10.15.0` in `package.json`).

## Key directories

```
src/routes/api/            # TanStack Start server routes (real API routes)
  chat.ts                  # POST /api/chat - delegates the turn to agent_server.py via the bridge
  chat-stream.ts           # GET  /api/chat-stream - proxies the Durable Stream read side
  agent/stop.ts            # POST /api/agent/stop - cancels an in-flight agent run
  agent-bridge/tool.ts     # POST /api/agent-bridge/tool - executes one real tool call for Python
  yjs/                      # Yjs proxy routes
  agent-python-demo/       # the agent brain itself (agent_server.py) - see below, NOT a TanStack route

src/lib/agent/             # the real agent runtime
  documentToolDispatch.ts   # shared tool-execution core (zod schemas + DocumentToolRuntime calls),
                            #   used by the bridge route to run each tool call Python decides on
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
tests/evals/liveAgentModelEvals.ts  # live evals against the real running app (pnpm test:evals)
```

## The agent brain: `src/routes/api/agent-python-demo/agent_server.py`

Not a real TanStack Start route (TanStack Router only picks up `.ts`/`.tsx`
files, so `.py` files here don't affect routing) — it's a separate Python
process that `src/routes/api/chat.ts` always delegates to.

- **`agent_server.py`** — a FastAPI server. `src/routes/api/chat.ts` POSTs the
  system prompt + conversation to its `/agent/run` endpoint; Python runs an
  explicit tool-calling loop against real OpenAI streaming and decides tool
  calls. Actual document mutations happen in Node via the existing
  `DocumentToolRuntime`, reached through the internal
  `POST /api/agent-bridge/tool` route (`src/routes/api/agent-bridge/tool.ts`,
  guarded by `AGENT_BRIDGE_SECRET`). **Requires running
  `python agent_server.py` alongside `pnpm dev`** — if it isn't running, chat
  fails outright (there is no fallback). See this folder's `README.md` for
  the full architecture diagram and setup.
- **`agent_shared.py`** — pydantic schemas + tool name/description table
  (Vietnamese, translated from `documentToolDispatch.ts`) used by
  `agent_server.py`. System prompts are NOT here — `agent_server.py` uses
  the real prompt text sent over by Node via `/agent/run`, so there's a
  single source of truth for agent instructions.

Rules:
- Do not wire any of this into `package.json`, `pnpm build`, or
  `pnpm typecheck` — it's Python, run independently.
- Don't delete it as part of "unused route" cleanup — this IS the chat
  backend, not a demo or an optional path.
- `agent_server.py` / the bridge route are **local-dev-only** — they cannot
  run on the Cloudflare Workers deployment described in the root `README.md`
  (no Python runtime there). **Chat does not work at all on the deployed
  Cloudflare version** unless `PYTHON_AGENT_BASE_URL` is pointed at a
  separately hosted Python process — there is no in-repo fallback anymore.
- When editing the real TypeScript agent (`documentToolDispatch.ts`,
  `documentToolRuntime.ts`, `prompts.ts`), the Python side will drift out of
  sync since nothing keeps them in lockstep automatically — treat it as a
  snapshot, not a spec.

## Conventions to follow when touching the real agent code

- **Tools**: schemas and execution logic both live in `documentToolDispatch.ts`
  (`DOCUMENT_TOOL_SCHEMAS` + `executeDocumentTool`). The bridge route
  (`agent-bridge/tool.ts`) is the only caller in the live app — it validates
  input with the zod schema, calls `executeDocumentTool`, and returns
  `{ result, customEvents }`, which `pythonAgentBridge.ts` turns into
  `CUSTOM` stream chunks for the client UI (`agent-edit-applied`,
  `agent-cursor-updated`, etc.).
- **No manual tool loop in TypeScript**: the explicit "call model → run tool →
  repeat" loop lives entirely in `agent_server.py` (Python). Node's role is
  purely to create/track the `DocumentToolRuntime`, relay the system prompt +
  messages to Python, execute whatever tool calls Python decides on via the
  bridge, and translate Python's NDJSON output into the `StreamChunk`/`AGUIEvent`
  shapes the chat transport expects (`routeAgentStreamChunks`,
  `toDurableChatSessionResponse` — both reused unchanged, since they only
  care about chunk shape, not chunk origin).
- **Chat summary after edits**: `agent_server.py` decides on its own whether
  a closing chat sentence is needed (tracks `had_mutation`/`chat_message_sent`)
  and, if so, makes one extra tool-less OpenAI call itself to generate it.
  There is no TypeScript-side equivalent anymore.
- **Logging**: plain `console.<level>('[tag]', event, { ...data })`, no custom
  logger abstraction. Tags are per-module/session, e.g. `` `[agent-session:${sessionId}]` ``.
  Use `error`/`warn` for failure paths, `info` for lifecycle/status events.
- **Imports**: path aliases `#/*` and `@/*` both resolve to `src/*` (see
  `package.json` `imports` field and `tsconfig.json` `paths`), but existing
  agent code mostly uses relative imports — either is fine for new code.

## Commands

- `pnpm dev` — run app + Durable Streams + Yjs servers together (also run
  `python agent_server.py` separately — see the agent brain section above)
- `pnpm dev:app` / `pnpm dev:ds` — run app only / servers only
- `pnpm test:unit` — deterministic unit tests (Vitest)
- `pnpm test:evals` — live evals against the real running app; requires
  `pnpm dev` **and** `python agent_server.py` already running, plus
  `OPENAI_API_KEY`
- `pnpm typecheck` — TypeScript checks
- `pnpm build` — production build
- `pnpm preview:cloudflare` / `pnpm deploy:cloudflare` — Cloudflare Workers preview/deploy (editor/collaboration only — chat does not work there, see above)
