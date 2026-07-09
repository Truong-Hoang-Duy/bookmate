# CLAUDE.md

Guidance for Claude Code (and other AI assistants) and the team working in this
repository. All facts here are verified from the source (`package.json`,
`tsconfig.json`, `vite.config.ts`, `nitro.config.mjs`, `wrangler.jsonc`,
`.env.example`, `agent-server/`, and the `src/` tree). Items that cannot be
derived from the source are marked **[Cần bổ sung]**.

> Note: Claude Code auto-loads `./CLAUDE.md` at the repo root. This file lives
> at `.claude/CLAUDE.md`, so it is **not** auto-loaded into context — treat it
> as a reference doc to read or point tools at deliberately.

## Tổng quan dự án (Project overview)

`collaborative-ai-editor` (package name `y-llm`) is a demo of
[Durable Streams](http://durablestreams.com) as the transport/persistence layer
for a collaborative AI writing app. It combines two Durable Streams integrations:

- **Durable Streams + Yjs** — shared ProseMirror document collaboration over plain HTTP.
- **Durable Streams + TanStack AI** — resilient chat sessions with streamed model output and tool-driven agent interaction.

An AI collaborator called **Electra** joins the shared document as a
server-side peer, inspects/edits it through tools, streams generated content
directly into the document, and chats in the sidebar.

**Tech stack (verified versions):**

- **App framework**: TanStack Start `@tanstack/react-start ^1.167.0` + TanStack Router `@tanstack/react-router ^1.168.0` (file-based routing) + React `^18.3.1` + Vite `^7.3.1` + TypeScript `^5.7.2`. ESM (`"type": "module"`).
- **Collaborative editor**: ProseMirror (`prosemirror-*`) + Yjs `^13.6.27` (CRDT) + `y-prosemirror ^1.3.7` + `y-protocols ^1.0.6` (awareness/presence). React binding via `@handlewithcare/react-prosemirror ^3.0.0`.
- **Durable Streams**: `@durable-streams/y-durable-streams ^0.2.3` (Yjs sync), `@durable-streams/tanstack-ai-transport ^0.0.2` (chat transport), `@durable-streams/server ^0.2.3` (local dev server, devDependency).
- **Chat transport**: `@tanstack/ai-react ^0.7.6` (`useChat`) over the Durable Streams transport. `@tanstack/ai ^0.9.2` is used only for shared `StreamChunk`/`AGUIEvent` wire-format types — it runs no model/tool loop in this repo.
- **Agent brain**: **Python** (FastAPI + OpenAI), in `agent-server/`. Deps: `openai>=1.40.0`, `pydantic>=2.7.0`, `fastapi>=0.110.0`, `uvicorn>=0.29.0`, `python-dotenv>=1.0.1`, `requests>=2.31.0`. This is the only thing that decides tool calls — there is no TypeScript fallback.
- **Validation**: `zod ^4.3.6` (Node tool schemas), `pydantic` (mirrored schemas on the Python side).
- **Deploy target**: Cloudflare Workers via Nitro (`nitro` nightly) + Wrangler `^4.79.0`.
- **Package manager**: **pnpm@10.15.0** (`packageManager` field).

## Cấu trúc thư mục (Directory structure)

```
agent-server/                # Python agent brain — NOT a TanStack route, NOT part of src/
  agent_server.py            #   FastAPI app: POST /agent/run (NDJSON stream), POST /agent/cancel
  agent_shared.py            #   pydantic tool schemas + tool table (mirror of the TS tools)
  prompts.py                 #   builds Vietnamese system prompts (source of truth for prompt text)
  requirements.txt           #   Python deps
  .env / .env.example        #   Python server env (git-ignored .env)

src/
  router.tsx                 # getRouter() — wires the generated routeTree + preload settings
  routeTree.gen.ts           # AUTO-GENERATED route tree — do NOT hand-edit
  styles.css                 # global styles

  routes/                    # file-based routing (TanStack Router picks up .ts/.tsx only)
    __root.tsx               #   root route — HTML shell + <Scripts>, title "Collaborative AI Editor"
    index.tsx                #   /            landing page (enter display name + doc name)
    doc/$name.tsx            #   /doc/$name   main page: editor + chat sidebar + presence bar
    api/
      chat.ts                #   POST /api/chat           — drives the agent turn via the Python bridge
      chat-stream.ts         #   GET  /api/chat-stream     — serves the durable chat session stream
      agent/stop.ts          #   POST /api/agent/stop      — aborts the in-flight agent run
      agent/bridge-tool.ts   #   POST /api/agent/bridge-tool — runs ONE real tool call for Python (secret-guarded)
      yjs/$.ts               #   /api/yjs/*      — proxy to the Durable Streams Yjs upstream
      yjs/docs/$.ts          #   /api/yjs/docs/* — proxy to the Yjs docs/ upstream

  components/
    CollaborativeEditor.tsx  # ProseMirror + Yjs editor, toolbar, awareness/cursors, chat-target overlay
    ChatSidebar.tsx          # chat UI (useChat over the durable connection) + streaming doc insertions
    PresenceBar.tsx          # presence avatars from Yjs awareness

  lib/
    agent/                   # the real agent runtime (see Architecture below)
      documentToolDispatch.ts  #   single source of truth: tool Zod schemas + execution dispatch
      documentToolRuntime.ts   #   DocumentToolRuntime — real tool logic over Yjs/ProseMirror
      serverAgentSession.ts    #   server-side Yjs "Electra" peer + awareness
      pythonAgentBridge.ts     #   Python NDJSON -> StreamChunk/AGUIEvent
      pythonBridgeRegistry.ts  #   runId -> live DocumentToolRuntime (for the bridge route)
      agentRunCancellation.ts  #   one AbortController per (docKey, sessionId)
      chatStreamRouting.ts     #   durable messages -> model messages; stream-chunk routing
      openaiStream.ts, markdownToProsemirror.ts, stability.ts, relativeAnchors.ts,
      clientAnchors.ts, editorContext.ts, types.ts
    chat/createDurableChatConnection.ts  # builds the durable chat connection (send/read + editor context)
    editor/                  # schema.ts, createHumanEditor.ts, chatTargetOverlay.ts
    ui/displayName.ts        # useStoredDisplayName (localStorage-backed)
    yjs/                     # createRoomProvider.ts, streamIds.ts

  dev/durableStreamsServer.ts  # local dev: DurableStreamTestServer (:4437) + YjsServer (:4438)

tests/
  agent/*.test.ts            # deterministic unit tests (Vitest)
  agent/testUtils.ts         # shared test helpers
  evals/liveAgentModelEvals.ts  # live evals against the running app (pnpm test:evals)

Root docs: README.md (overview, English), AGENT_FLOWS.md (flow walkthrough, Vietnamese), PLAN.md (design doc).
Root config: vite.config.ts, nitro.config.mjs, wrangler.jsonc, tsconfig.json, .env.example, .dev.vars.example.
```

**Entry points:** root route `src/routes/__root.tsx`, router `src/router.tsx`,
generated tree `src/routeTree.gen.ts`. There are **no** hand-written
`client`/`server`/`ssr` entry files — client/server wiring comes from the
`tanstackStart()` Vite plugin + Nitro. The local data plane entry is
`src/dev/durableStreamsServer.ts`.

## Lệnh thường dùng (Common commands)

| Command | What it runs |
| --- | --- |
| `pnpm dev` | `concurrently` runs `dev:ds` + `dev:app` together |
| `pnpm dev:app` | `vite dev --port 3000` (app only) |
| `pnpm dev:ds` | `tsx src/dev/durableStreamsServer.ts` (Durable Streams :4437 + Yjs :4438) |
| `python agent_server.py` | Run **from `agent-server/`** after `pip install -r requirements.txt`. **Required alongside `pnpm dev`** — chat has no fallback and fails outright without it. Serves `127.0.0.1:8787` (`PYTHON_AGENT_PORT`). |
| `pnpm build` | `vite build` (production) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test:unit` | `vitest run tests/agent` (deterministic unit tests) |
| `pnpm test:evals` | `node --env-file=.env --import tsx tests/evals/liveAgentModelEvals.ts` — live; needs `pnpm dev` + `python agent_server.py` running and `OPENAI_API_KEY` |
| `pnpm preview:cloudflare` | `pnpm build && wrangler dev --config .output/server/wrangler.json` |
| `pnpm deploy:cloudflare` | `pnpm build && wrangler deploy --config .output/server/wrangler.json` |
| `pnpm cf:typegen` | `wrangler types` |

**First-time setup:** `pnpm install`; copy `.env.example` → `.env` and
`agent-server/.env.example` → `agent-server/.env`; `pip install -r
agent-server/requirements.txt`. There is **no lockfile-less linter step** — the
only quality gate is `pnpm typecheck`.

## Kiến trúc & luồng chính (Architecture & main flow)

Layered app: a TanStack Start front end + Node server routes, a Yjs/Durable
Streams data plane, and a separate Python "brain" process.

**Chat / agent flow — Node does NOT decide tool calls:**

1. Client sends a message → `POST /api/chat` (`src/routes/api/chat.ts`).
2. Node relays raw ingredients (`editorContextKind`, `selectedText`, `mode`,
   conversation — no prompt text) to Python `POST /agent/run`.
3. `agent_server.py` builds its own Vietnamese system prompt (`prompts.py`) and
   runs an explicit OpenAI tool-calling loop, deciding tool calls.
4. For each tool call, Python calls back to Node `POST /api/agent/bridge-tool`
   (`src/routes/api/agent/bridge-tool.ts`, guarded by header
   `X-Agent-Bridge-Token` = `AGENT_BRIDGE_SECRET`), which validates input with
   the Zod schema and runs it against the live `DocumentToolRuntime`.
5. `pythonAgentBridge.ts` translates Python's NDJSON output into
   `StreamChunk`/`AGUIEvent`; `chatStreamRouting.ts` routes it to the durable
   chat session; the client reads it back over `GET /api/chat-stream`.
6. `agent_server.py` decides on its own whether a closing chat sentence is
   needed and makes one extra tool-less OpenAI call for it. No TS equivalent.

**Collaboration flow:** ProseMirror + Yjs share a `Y.XmlFragment` ("prosemirror")
synced over Durable Streams. `serverAgentSession.ts` is the server-side "Electra"
peer; `y-protocols` awareness drives presence; relative anchors
(`relativeAnchors.ts`, `clientAnchors.ts`) make ProseMirror positions portable
across peers.

**Tools:** schemas *and* execution logic live in
`src/lib/agent/documentToolDispatch.ts` (`DOCUMENT_TOOL_SCHEMAS` +
`executeDocumentTool`). The bridge route is the only live caller. Python's
`agent_shared.py` is a **manual mirror** of these tools.

## Quy ước code (Conventions)

- **TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `moduleResolution:
  bundler`, `allowImportingTsExtensions`, ESM only. `tsc --noEmit` must pass.
- **Path aliases**: both `#/*` and `@/*` resolve to `src/*` (`package.json`
  `imports` + `tsconfig.json` `paths`). Existing agent code mostly uses relative
  imports — either style is fine for new code; match the surrounding file.
- **Logging**: plain `console.<level>('[tag]', event, { ...data })` — no logger
  abstraction. Tags are per-module/session, e.g. `` `[agent-session:${sessionId}]` ``.
  Use `error`/`warn` for failures, `info` for lifecycle/status.
- **Formatting/linting**: **none configured** — no ESLint, Prettier, or Biome
  config or dependency exists. Match the style of the surrounding code; the only
  automated check is `pnpm typecheck`. `[formatter: none]`
- **Python side**: much of `agent-server/` logging/comments and the system
  prompts are intentionally in Vietnamese; `prompts.py` is the single source of
  truth for prompt text.

## Quy tắc quan trọng cho Claude (Rules for Claude)

- **Do NOT hand-edit** `src/routeTree.gen.ts` — it is generated.
- **`agent-server/` (Python) is the real chat backend**, not a demo or optional
  path. Do NOT wire it into `package.json` / `pnpm build` / `pnpm typecheck`
  (it's Python, run independently), and do NOT delete it as an "unused route".
- **Chat requires the Python server.** If `python agent_server.py` isn't running
  alongside `pnpm dev`, chat fails outright — there is no fallback.
- **Cloudflare deploy has no Python runtime**, so chat does NOT work on the
  deployed Workers version unless `PYTHON_AGENT_BASE_URL` points at a separately
  hosted Python process. The editor/collaboration parts still work there.
- **Secrets / env**: `.env` and `agent-server/.env` are git-ignored — never
  commit them. `AGENT_BRIDGE_SECRET` must match between the root `.env` and
  `agent-server/.env`. Default `OPENAI_MODEL=gpt-5.4`. Cloudflare required
  secrets (`wrangler.jsonc`): `OPENAI_API_KEY`, `DURABLE_STREAMS_YJS_SECRET`,
  `DURABLE_STREAMS_CHAT_SECRET`.
- **Tool schema drift**: `agent_shared.py` mirrors the TS tools by hand and can
  drift when you change `documentToolDispatch.ts` / `documentToolRuntime.ts` —
  treat it as a snapshot, not a spec, and update it deliberately. (Prompt text
  is exempt: `prompts.py` is the only place it's written.)
- **Verify before finishing** non-trivial TS changes: run `pnpm typecheck` and
  `pnpm test:unit`. See `AGENT_FLOWS.md` for the full architecture walkthrough.

## Git & Workflow

- Recent history uses short lowercase commit subjects (e.g. `first commit`,
  `second commit`). End co-authored commits with the trailer configured for
  this environment when applicable.
- Commit message convention (Conventional Commits, etc.): **[Cần bổ sung]** — no
  enforced convention found in-repo.
- Branch / PR workflow, PR template, branch protection: **[Cần bổ sung]** — none
  found in the repository.
