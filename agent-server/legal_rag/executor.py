"""Executor cho các tool RAG (read-only, chạy thẳng trong Python — KHÔNG qua
Node bridge). agent_server gọi qua LOCAL_TOOL_EXECUTORS[name](args, ctx).

Hai chế độ nguồn (LEGAL_RAG_SOURCE):
- "editor" (mặc định): tra cứu CHÍNH văn bản đang mở trong editor (lấy qua
  ctx.fetch_document_text do agent_server bơm vào).
- "corpus": tra cứu kho luật dựng sẵn trong data/*.json.
"""

from dataclasses import dataclass
from typing import Callable, Optional

from agent_shared import log_step

from . import editor_source
from .config import load_config
from .retriever import get_retriever, rank_hits
from .vector_store import MemoryVectorStore
from .tools import GetLegalArticleInput, SearchLegalDocsInput

_TAG = "[legal_rag]"

_DISCLAIMER = "Nội dung chỉ mang tính tham khảo, không thay thế tư vấn của luật sư."
_NOT_A_LAW = "Tài liệu đang mở không phải văn bản luật (không có cấu trúc Điều/Khoản)."
_NO_CTX = "Thiếu ngữ cảnh tài liệu để đọc nội dung editor."


@dataclass
class ToolContext:
    """agent_server dựng và bơm khả năng đọc tài liệu editor vào executor."""

    fetch_document_text: Optional[Callable[[], str]] = None


def _editor_text(ctx: Optional[ToolContext]) -> Optional[str]:
    if ctx is None or ctx.fetch_document_text is None:
        return None
    return ctx.fetch_document_text() or ""


def _search_legal_docs(args: dict, ctx: Optional[ToolContext] = None) -> dict:
    cfg = load_config()
    log_step(_TAG, "search_legal_docs ĐƯỢC GỌI", source=cfg.source, query=args.get("query"))
    try:
        inp = SearchLegalDocsInput(**args)
        if cfg.source == "editor":
            text = _editor_text(ctx)
            if text is None:
                return {"ok": False, "error": _NO_CTX}
            if not editor_source.has_legal_structure(text):
                log_step(_TAG, "tài liệu editor không phải văn bản luật -> bỏ qua", chars=len(text))
                return {"ok": True, "results": [], "note": _NOT_A_LAW}
            store: MemoryVectorStore = editor_source.build_editor_store(text)
            chunks = rank_hits(cfg, store, inp.query, inp.top_k)
        else:
            chunks = get_retriever().retrieve(
                inp.query, inp.top_k, inp.as_of_date, bool(inp.include_superseded)
            )
    except Exception as exc:  # noqa: BLE001 - trả lỗi rõ ràng cho model
        log_step(_TAG, "search_legal_docs LỖI", error=str(exc))
        return {"ok": False, "error": str(exc)}
    if not chunks:
        log_step(_TAG, "search_legal_docs: không có căn cứ phù hợp")
        return {
            "ok": True,
            "results": [],
            "note": "Không tìm thấy căn cứ pháp lý phù hợp trong tài liệu. Đừng suy diễn.",
        }
    log_step(
        _TAG,
        "search_legal_docs -> có kết quả",
        n_results=len(chunks),
        articles=[c.article for c in chunks],
    )
    return {
        "ok": True,
        "results": [c.to_result() for c in chunks],
        "disclaimer": _DISCLAIMER,
    }


def _get_legal_article(args: dict, ctx: Optional[ToolContext] = None) -> dict:
    cfg = load_config()
    log_step(
        _TAG,
        "get_legal_article ĐƯỢC GỌI",
        source=cfg.source,
        document_no=args.get("document_no"),
        article=args.get("article"),
    )
    try:
        inp = GetLegalArticleInput(**args)
        if cfg.source == "editor":
            text = _editor_text(ctx)
            if text is None:
                return {"ok": False, "error": _NO_CTX}
            want = inp.article.strip().lower()
            chunks = [c for c in editor_source.text_to_chunks(text) if c.article.strip().lower() == want]
        else:
            chunks = get_retriever().get_article(inp.document_no, inp.article)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    if not chunks:
        return {"ok": True, "results": [], "note": f"Không tìm thấy {inp.article} trong tài liệu."}
    return {"ok": True, "results": [c.to_result() for c in chunks], "disclaimer": _DISCLAIMER}


LOCAL_TOOL_EXECUTORS: dict[str, Callable[..., dict]] = {
    "search_legal_docs": _search_legal_docs,
    "get_legal_article": _get_legal_article,
}
