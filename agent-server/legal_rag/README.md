# legal_rag — RAG pháp lý tiếng Việt (module tách riêng)

Toàn bộ tính năng tra cứu luật + hỗ trợ soạn hợp đồng nằm gọn trong folder này.
Code lõi của `agent-server` chỉ chạm vào qua **3 hook mỏng** (xem `agent_server.py`).
Tool truy xuất là **read-only** nên chạy thẳng trong Python, **không qua Node bridge**.

## Bật/tắt

Mặc định **TẮT** để không đổi hành vi editor hiện có. Bật trong `agent-server/.env`:

```
LEGAL_RAG_ENABLED=1
```

Khi bật, agent có thêm 2 tool: `search_legal_docs`, `get_legal_article`, và system
prompt được nối thêm quy tắc bắt buộc trích dẫn.

## Nguồn tri thức (`LEGAL_RAG_SOURCE`)

| Giá trị | Ý nghĩa |
| --- | --- |
| `editor` (mặc định) | Tra cứu **chính văn bản đang mở trong editor**. Khi bạn dán một văn bản luật (vd Bộ luật Lao động) vào editor rồi hỏi, agent lấy toàn văn qua `get_document_snapshot`, chunk theo Điều/Khoản trong bộ nhớ, rồi truy xuất + trích dẫn. Nếu tài liệu không phải luật → tool báo rỗng và agent xử lý như biên tập thường. **Không** có metadata ngày hiệu lực/trạng thái (đó là văn bản thuần). |
| `corpus` | Tra cứu kho luật dựng sẵn trong `data/*.json` (có metadata hiệu lực/trạng thái, lọc theo thời gian). |

### Demo nhanh (chế độ editor)

1. `.env`: `LEGAL_RAG_ENABLED=1`, `LEGAL_RAG_SOURCE=editor`.
2. Chạy `pnpm dev` + `python agent_server.py`, mở `/doc/<tên>`, **dán Bộ luật Lao động** vào editor.
3. Hỏi trong chat, ví dụ: "Thời gian thử việc tối đa?" (→ Điều 25), "Nghỉ phép năm mấy ngày?" (→ Điều 113), "Giờ làm bình thường tối đa/tuần?" (→ Điều 105), "Soạn điều khoản thử việc đúng luật đang mở" (chèn bản thảo + dẫn Điều). Hỏi ngoài phạm vi (vd thuế TNDN) → agent báo không có căn cứ trong tài liệu.
4. Dán nội dung KHÁC (blog…) và hỏi biên tập bình thường → agent **không** gọi tool luật, hành vi như cũ.

## Backend

| Biến `LEGAL_RAG_BACKEND` | Cần cài gì | Ghi chú |
| --- | --- | --- |
| `memory` (mặc định) | Không | Chấm điểm từ khoá TF-IDF thuần Python trên `data/*.json`. Dùng cho dev/demo — **chạy được ngay**. |
| `qdrant` | `pip install -r legal_rag/requirements.txt` + Qdrant | Khung sẵn (`vector_store.py`), cần hoàn thiện ingest có embedding. |
| `pgvector` | Postgres + pgvector | Khung sẵn, chưa nối. |

Các biến khác (đều có mặc định): `LEGAL_RAG_EMBEDDING_MODEL` (`BAAI/bge-m3`),
`LEGAL_RAG_RERANKER_MODEL` (`BAAI/bge-reranker-v2-m3`), `LEGAL_RAG_RERANK` (0/1),
`LEGAL_RAG_TOP_K`, `LEGAL_RAG_RERANK_TOP_K`, `LEGAL_RAG_QDRANT_URL`,
`LEGAL_RAG_QDRANT_COLLECTION`, `LEGAL_RAG_DATA_DIR`.

## Dữ liệu

- `data/sample_chunks.json` — **DỮ LIỆU MẪU** (đánh dấu `"sample": true`), chỉ để
  demo/test. **Phải thay bằng corpus luật thật** trước khi dùng thực tế.
- `clause_library/` — mẫu điều khoản hợp đồng (cho use case soạn thảo).

### Nạp văn bản luật thật (backend memory)

```
python -m legal_rag.ingest --input luat.txt \
  --document-no 59/2020/QH14 --title "Luật Doanh nghiệp 2020" \
  --effective-date 2021-01-01 --out legal_rag/data/ldn2020.json
```

Parser tách theo `Điều N` và `Khoản`, gắn metadata (số hiệu, ngày hiệu lực,
trạng thái). Với Qdrant/pgvector cần thêm bước embedding + upsert.

## Chạy test

Từ thư mục `agent-server/`:

```
python -m legal_rag.tests.test_retriever
```

## Kiến trúc trong folder

```
config.py       # cấu hình theo env
models.py       # LegalChunk + metadata trích dẫn/hiệu lực
tools.py        # ToolMeta + pydantic input (search_legal_docs, get_legal_article)
vector_store.py # MemoryVectorStore (chạy ngay) + Qdrant/pgvector (khung)
embeddings.py   # wrapper BGE-M3 + rerank (import lười)
retriever.py    # điều phối: store -> lọc hiệu lực -> rerank
executor.py     # LOCAL_TOOL_EXECUTORS (read-only, chạy thẳng Python)
prompts.py      # đoạn system prompt pháp lý
ingest.py       # CLI parse luật .txt -> chunks JSON
```

## Giới hạn / lưu ý

- Dữ liệu mẫu **không phải luật thật** — không dùng để tư vấn thực tế.
- Backend `memory` chỉ là baseline từ khoá; production nên dùng Qdrant/pgvector
  + embedding BGE-M3 + reranker (đã có khung).
- Cloudflare Workers không chạy Python → tính năng này chỉ hoạt động khi
  `agent_server.py` chạy (local hoặc host Python riêng), giống giới hạn sẵn có
  của chat.
