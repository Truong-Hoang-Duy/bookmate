# Agent Python kết nối thật với app (`agent_server.py`)

> **Đây KHÔNG PHẢI route thật của TanStack Start.** TanStack Router chỉ nhận
> file `.ts`/`.tsx` làm route trong `src/routes/api`, nên thư mục này chỉ
> nằm cạnh các route thật cho tiện tham chiếu — không file `.py` nào ở đây
> được `pnpm dev`, `pnpm build`, hay `pnpm typecheck` đụng tới.

Thư mục này chứa một **agent Python thật**, đóng vai trò "bộ não" cho chat
thật của app `collaborative-ai-editor`. Khi bật (`AGENT_BRAIN_MODE=python`,
giá trị mặc định), chính Python — không phải `@tanstack/ai` — quyết định gọi
tool nào khi người dùng chat trong sidebar thật, và các tool đó **chỉnh sửa
thật** tài liệu ProseMirror/Yjs đang được chia sẻ trong ứng dụng.

## Vì sao lại có file Python trong một dự án TypeScript?

Dự án `collaborative-ai-editor` 100% dùng TypeScript (xem `README.md` ở gốc
repo). Agent thật (`Electra`) dùng `@tanstack/ai` + `zod`, chạy tool-calling
loop **ẩn bên trong thư viện** — bạn không thấy được vòng lặp gọi model từng
bước khi đọc code TypeScript thật. `agent_server.py` viết lại đúng ý tưởng
đó bằng Python + `pydantic` (thay cho vai trò của `zod`) với **vòng lặp
tường minh**: gửi request tới model → model yêu cầu gọi tool → validate
tham số bằng pydantic → gọi ngược về Node để thực thi tool thật → gửi kết
quả lại cho model → lặp lại → cho tới khi model trả lời cuối cùng.

Vì Yjs là thư viện JavaScript, Python không thể tự nói chuyện với nó. Nên
`agent_server.py` chỉ đóng vai trò "bộ não" (gọi OpenAI streaming thật,
quyết định gọi tool nào) — còn việc **thực thi tool thật** (đọc/sửa tài
liệu) do Node làm qua `DocumentToolRuntime` đã có sẵn, gọi ngược lại qua một
route nội bộ.

## Kiến trúc

```
Browser (useChat, KHÔNG đổi gì)
   │  POST /api/chat  (Durable Streams, như cũ)
   ▼
Node: src/routes/api/chat.ts  (AGENT_BRAIN_MODE=python)
   │  tạo DocumentToolRuntime thật, đăng ký theo runId
   ▼                                              ▲
POST /agent/run (NDJSON stream) ──────────►  agent_server.py
   (systemPrompt thật, messages, mode)             │  vòng lặp tool-calling
                                                    │  streaming thật + pydantic
   ◄── mỗi lần cần chạy tool ──────────────────    │  validate, OpenAI thật
POST /api/agent-bridge/tool                        │
   { runId, name, input } (kèm secret) ────────────►│
   trả về { ok, result, customEvents } (đã sửa  ◄───┘
   THẬT qua DocumentToolRuntime)
```

- `agent_shared.py`: schema pydantic + tên/mô tả tiếng Việt cho 17 tool,
  dịch từ `src/lib/agent/documentToolDispatch.ts` thật — nguồn sự thật duy
  nhất cho hợp đồng tool giữa Python và Node.
- `agent_server.py`: FastAPI + uvicorn, vòng lặp tool-calling tường minh,
  gọi OpenAI thật (streaming token-by-token), thực thi tool qua bridge, và
  tự sinh câu tóm tắt cho chat khi cần (xem `MUTATING_TOOLS` trong file).

## Bảng đối chiếu với agent thật (TypeScript)

| Trong `agent_server.py` | Tương ứng trong dự án thật |
|---|---|
| Các model `pydantic.BaseModel` cho từng tool (`agent_shared.py`) | Các schema `zod` trong `src/lib/agent/documentToolDispatch.ts` |
| 17 tool cùng tên, cùng tham số | `createDocumentTools()` / `executeDocumentTool()` |
| System prompt nhận từ Node qua `/agent/run` | `buildChatToolSystemPrompt()` trong `src/lib/agent/prompts.ts` |
| Vòng lặp `while True` tường minh trong `stream_agent_run()` | Vòng lặp tool-calling **ẩn bên trong** `chat()` của `@tanstack/ai` (khi `AGENT_BRAIN_MODE=tanstack`) |
| Tự gọi thêm 1 lần model không kèm tool để tóm tắt khi cần | `postEditSummaryStream` trong `src/routes/api/chat.ts` (chỉ dùng ở nhánh `tanstack`) |
| `POST /api/agent-bridge/tool` (thực thi tool thật) | `DocumentToolRuntime` trong `src/lib/agent/documentToolRuntime.ts` |

## Hướng dẫn chạy toàn bộ dự án (frontend + backend)

Cần **3 tiến trình** chạy song song. Mở 3 terminal khác nhau.

### 1. Cấu hình biến môi trường

**Ở gốc repo**, file `.env` (đã có sẵn giá trị mẫu — chỉnh nếu cần):
```
AGENT_BRAIN_MODE=python
AGENT_BRIDGE_SECRET=<một chuỗi bí mật bất kỳ>
PYTHON_AGENT_BASE_URL=http://127.0.0.1:8787
```

**Trong thư mục này** (`src/routes/api/agent-python-demo/`), tạo `.env` từ
`.env.example`:
```
OPENAI_API_KEY=sk-...           # key OpenAI thật
OPENAI_MODEL=gpt-5.4
AGENT_BRIDGE_SECRET=<CÙNG giá trị với .env ở gốc repo>
NODE_BRIDGE_BASE_URL=http://localhost:3000
PYTHON_AGENT_PORT=8787
```

### 2. Backend Node (app + Durable Streams + Yjs) — Terminal 1

```bash
# ở gốc repo
pnpm install     # nếu chưa cài
pnpm dev
```

Lệnh này chạy cùng lúc: app TanStack Start (`localhost:3000`), Durable
Streams server (`127.0.0.1:4437`), và Yjs server (`127.0.0.1:4438`).

### 3. Backend Python (agent thật) — Terminal 2

```bash
cd src/routes/api/agent-python-demo
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# Bash/Git Bash:
source .venv/Scripts/activate

pip install -r requirements.txt
python agent_server.py
```

Log sẽ báo `agent_server.py đang lắng nghe tại http://127.0.0.1:8787`.

### 4. Frontend — Terminal 3 (hoặc trình duyệt)

Mở `http://localhost:3000`, nhập tên tài liệu để tạo/tham gia phòng, rồi
chat trong sidebar như bình thường. Từ giờ Python quyết định mọi tool call,
và tài liệu thật sẽ bị sửa qua bridge — không cần thay đổi gì ở frontend.

### Quay lại backend cũ (tắt Python)

Đặt `AGENT_BRAIN_MODE=tanstack` trong `.env` ở gốc repo, khởi động lại
`pnpm dev` — không cần chạy `agent_server.py` nữa, chat dùng lại
`@tanstack/ai` như trước khi có tính năng này.

## Giới hạn quan trọng

- **Chỉ chạy được ở local dev.** `agent_server.py` và route
  `/api/agent-bridge/tool` không chạy được trên bản deploy Cloudflare
  Workers (Python không chạy trên Workers). Đừng bật
  `AGENT_BRAIN_MODE=python` trên môi trường đã deploy.
- **`AGENT_BRIDGE_SECRET` là ranh giới bảo mật duy nhất** của route
  `/api/agent-bridge/tool` — vì route này thực thi chỉnh sửa tài liệu thật,
  đừng bao giờ để trống giá trị này hay tắt kiểm tra secret.
- **Huỷ chạy (bấm "stop") không dừng ngay lập tức** vòng lặp Python đang
  chạy dở — `agent_server.py` chỉ kiểm tra cờ huỷ giữa các bước (giữa các
  lần gọi model / trong lúc đang stream), không ngắt được một request
  OpenAI đã gửi đi.
