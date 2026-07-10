"""Chế độ 'editor': coi CHÍNH văn bản đang mở trong editor là kho tri thức.

Lấy toàn văn tài liệu (do agent_server bơm vào qua ctx.fetch_document_text),
chunk theo Điều/Khoản (tái dùng parser của ingest.py), rồi dựng một
MemoryVectorStore trong bộ nhớ. Có cache theo hash văn bản để không phải chunk
lại mỗi lần model gọi tool trong cùng một lượt."""

import hashlib
from typing import Optional

from agent_shared import log_step

from .ingest import parse_law_text
from .models import LegalChunk, STATUS_CURRENT
from .vector_store import MemoryVectorStore

_EDITOR_DOC_TITLE = "(tài liệu đang mở)"
_TAG = "[legal_rag]"

# Cache nhỏ: hash(text) -> MemoryVectorStore. Giữ vài mục gần nhất là đủ.
_cache: "dict[str, MemoryVectorStore]" = {}
_cache_order: list[str] = []
_CACHE_MAX = 4


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", "ignore")).hexdigest()


def text_to_chunks(text: str) -> list[LegalChunk]:
    """Chunk văn bản luật thuần thành LegalChunk (không có metadata hiệu lực)."""
    chunks: list[LegalChunk] = []
    for i, p in enumerate(parse_law_text(text)):
        article = p.get("article") or ""
        clause = p.get("clause")
        body = (p.get("text") or "").strip()
        if not body:
            continue
        art_slug = article.replace(" ", "").lower()
        clause_slug = (clause or "").replace(" ", "").lower()
        chunks.append(
            LegalChunk(
                id=f"editor::{art_slug}::{clause_slug or i}",
                text=body,
                document_no="",
                document_title=_EDITOR_DOC_TITLE,
                article=article,
                clause=clause,
                effective_date=None,
                status=STATUS_CURRENT,
                sample=False,
            )
        )
    return chunks


def build_editor_store(text: str) -> MemoryVectorStore:
    """Dựng (hoặc lấy từ cache) store cho văn bản editor hiện tại."""
    key = _hash(text)
    cached = _cache.get(key)
    if cached is not None:
        log_step(_TAG, "dùng lại chỉ mục tài liệu editor (cache)", chars=len(text))
        return cached
    chunks = text_to_chunks(text)
    log_step(_TAG, "đã chunk tài liệu editor", chars=len(text), n_chunks=len(chunks))
    store = MemoryVectorStore.from_chunks(chunks)
    _cache[key] = store
    _cache_order.append(key)
    while len(_cache_order) > _CACHE_MAX:
        old = _cache_order.pop(0)
        _cache.pop(old, None)
    return store


def has_legal_structure(text: str) -> bool:
    """True nếu văn bản có ít nhất một 'Điều N' — dùng để degrade an toàn khi
    tài liệu không phải văn bản luật."""
    return any(c.article for c in text_to_chunks(text)) if text else False


def clear_cache() -> None:
    _cache.clear()
    _cache_order.clear()
