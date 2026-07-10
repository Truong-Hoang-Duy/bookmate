"""Cấu hình riêng cho tính năng RAG pháp lý. Đọc hoàn toàn từ biến môi trường
để không đụng vào cấu hình lõi của agent-server."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_TRUTHY = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class LegalRagConfig:
    enabled: bool
    source: str  # "editor" | "corpus"
    backend: str  # "memory" | "qdrant" | "pgvector"
    embedding_model: str
    reranker_model: str
    rerank_enabled: bool
    qdrant_url: str
    qdrant_collection: str
    pg_dsn: str
    top_k: int
    rerank_top_k: int
    data_dir: str


@lru_cache(maxsize=1)
def load_config() -> LegalRagConfig:
    here = Path(__file__).parent
    return LegalRagConfig(
        # Mặc định TẮT: tính năng đã được nối dây nhưng không đổi hành vi editor
        # hiện có cho tới khi bật rõ ràng bằng LEGAL_RAG_ENABLED=1.
        enabled=os.environ.get("LEGAL_RAG_ENABLED", "0").strip().lower() in _TRUTHY,
        # "editor": truy xuất CHÍNH tài liệu đang mở trong editor (mặc định).
        # "corpus": truy xuất kho luật dựng sẵn trong data/*.json.
        source=os.environ.get("LEGAL_RAG_SOURCE", "editor").strip().lower(),
        # "memory" chạy được ngay, không cần cài thêm gì. "qdrant"/"pgvector" cần
        # cài phụ thuộc trong legal_rag/requirements.txt.
        backend=os.environ.get("LEGAL_RAG_BACKEND", "memory").strip().lower(),
        embedding_model=os.environ.get("LEGAL_RAG_EMBEDDING_MODEL", "BAAI/bge-m3"),
        reranker_model=os.environ.get("LEGAL_RAG_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3"),
        rerank_enabled=os.environ.get("LEGAL_RAG_RERANK", "0").strip().lower() in _TRUTHY,
        qdrant_url=os.environ.get("LEGAL_RAG_QDRANT_URL", "http://localhost:6333"),
        qdrant_collection=os.environ.get("LEGAL_RAG_QDRANT_COLLECTION", "vn_legal"),
        pg_dsn=os.environ.get("LEGAL_RAG_PG_DSN", ""),
        top_k=int(os.environ.get("LEGAL_RAG_TOP_K", "20")),
        rerank_top_k=int(os.environ.get("LEGAL_RAG_RERANK_TOP_K", "6")),
        data_dir=os.environ.get("LEGAL_RAG_DATA_DIR", str(here / "data")),
    )
