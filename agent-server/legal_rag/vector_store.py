"""Tầng lưu trữ/truy xuất, tách qua một interface để dễ đổi backend.

- MemoryVectorStore: chạy được NGAY, không cần cài gì (chấm điểm từ khoá kiểu
  BM25 nhẹ trên corpus JSON trong data/). Dùng cho dev/demo.
- QdrantVectorStore / PgVectorStore: khung sẵn, import lười; cần cài phụ thuộc
  trong legal_rag/requirements.txt và một pipeline ingest có embedding.
"""

import glob
import json
import math
import os
import re
from collections import Counter
from typing import Optional

from .config import LegalRagConfig
from .models import LegalChunk, STATUS_CURRENT

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


def _passes_temporal(chunk: LegalChunk, as_of_date: Optional[str], include_superseded: bool) -> bool:
    if not include_superseded and chunk.status != STATUS_CURRENT:
        return False
    if as_of_date and chunk.effective_date and chunk.effective_date > as_of_date:
        return False
    return True


class VectorStore:
    def search(
        self,
        query: str,
        top_k: int,
        as_of_date: Optional[str] = None,
        include_superseded: bool = False,
    ) -> list[tuple[LegalChunk, float]]:
        raise NotImplementedError

    def get_article(self, document_no: str, article: str) -> list[LegalChunk]:
        raise NotImplementedError


class MemoryVectorStore(VectorStore):
    """Chấm điểm TF-IDF nhẹ, thuần Python (không phụ thuộc ngoài)."""

    def __init__(self, data_dir: Optional[str] = None):
        self._chunks: list[LegalChunk] = []
        self._df: Counter = Counter()  # document frequency theo token
        if data_dir:
            self._load(data_dir)
            self._reindex()

    @classmethod
    def from_chunks(cls, chunks: list[LegalChunk]) -> "MemoryVectorStore":
        """Dựng store từ danh sách chunk có sẵn (không đọc file) — dùng cho
        chế độ 'editor' khi chunk lấy từ tài liệu đang mở."""
        store = cls()
        store._chunks = list(chunks)
        store._reindex()
        return store

    def _reindex(self) -> None:
        self._df = Counter()
        for chunk in self._chunks:
            for token in set(_tokenize(chunk.text)):
                self._df[token] += 1

    def _load(self, data_dir: str) -> None:
        if not os.path.isdir(data_dir):
            return
        for path in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
            except (OSError, ValueError):
                continue
            if not isinstance(raw, list):
                continue
            for item in raw:
                try:
                    self._chunks.append(LegalChunk.from_dict(item))
                except (KeyError, TypeError):
                    continue

    def _idf(self, token: str) -> float:
        n = max(1, len(self._chunks))
        df = self._df.get(token, 0)
        return math.log(1 + n / (1 + df))

    def search(self, query, top_k, as_of_date=None, include_superseded=False):
        q_tokens = _tokenize(query)
        if not q_tokens:
            return []
        scored: list[tuple[LegalChunk, float]] = []
        for chunk in self._chunks:
            if not _passes_temporal(chunk, as_of_date, include_superseded):
                continue
            tf = Counter(_tokenize(chunk.text))
            score = sum(tf.get(tok, 0) * self._idf(tok) for tok in q_tokens)
            if score > 0:
                scored.append((chunk, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]

    def get_article(self, document_no, article):
        dn = document_no.strip().lower()
        art = article.strip().lower()
        return [
            c
            for c in self._chunks
            if c.document_no.strip().lower() == dn and c.article.strip().lower() == art
        ]


class QdrantVectorStore(VectorStore):
    """Khung Qdrant (hybrid dense+sparse). Cần `qdrant-client` + pipeline ingest."""

    def __init__(self, config: LegalRagConfig):
        self._config = config
        self._client = None

    def _lazy_client(self):
        if self._client is None:
            try:
                from qdrant_client import QdrantClient  # type: ignore
            except ImportError as exc:
                raise RuntimeError(
                    "Backend 'qdrant' cần `pip install -r legal_rag/requirements.txt`."
                ) from exc
            self._client = QdrantClient(url=self._config.qdrant_url)
        return self._client

    def search(self, query, top_k, as_of_date=None, include_superseded=False):
        # TODO(ingest): embed query + hybrid search + build metadata filter theo
        # status/effective_date. Chưa nối để tránh code nửa vời.
        raise NotImplementedError(
            "QdrantVectorStore.search chưa được cài đặt — dùng backend 'memory' "
            "hoặc hoàn thiện pipeline ingest trước."
        )

    def get_article(self, document_no, article):
        raise NotImplementedError("QdrantVectorStore.get_article chưa được cài đặt.")


class PgVectorStore(VectorStore):
    """Khung pgvector. Cần Postgres + pgvector và pipeline ingest."""

    def __init__(self, config: LegalRagConfig):
        self._config = config

    def search(self, query, top_k, as_of_date=None, include_superseded=False):
        raise NotImplementedError(
            "PgVectorStore.search chưa được cài đặt — dùng backend 'memory' trước."
        )

    def get_article(self, document_no, article):
        raise NotImplementedError("PgVectorStore.get_article chưa được cài đặt.")


def build_vector_store(config: LegalRagConfig) -> VectorStore:
    if config.backend == "memory":
        return MemoryVectorStore(config.data_dir)
    if config.backend == "qdrant":
        return QdrantVectorStore(config)
    if config.backend == "pgvector":
        return PgVectorStore(config)
    raise RuntimeError(f"LEGAL_RAG_BACKEND không hợp lệ: {config.backend!r}")
