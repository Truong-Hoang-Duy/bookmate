"""Test tất định cho backend 'memory' — không cần dịch vụ ngoài.

Chạy: từ thư mục agent-server/  ->  python -m legal_rag.tests.test_retriever
(cũng tương thích pytest)."""

import os

from legal_rag.config import load_config
from legal_rag.executor import _get_legal_article, _search_legal_docs
from legal_rag.models import STATUS_REPEALED
from legal_rag.retriever import LegalRetriever


def _force_corpus():
    """Các test executor dưới đây kiểm tra chế độ corpus (mặc định là editor)."""
    os.environ["LEGAL_RAG_SOURCE"] = "corpus"
    load_config.cache_clear()


def test_retrieve_filters_repealed_by_default():
    r = LegalRetriever()
    hits = r.retrieve("phạt vi phạm hợp đồng")
    assert hits, "phải tìm được điều khoản phạt vi phạm mẫu"
    assert all(c.status != STATUS_REPEALED for c in hits), "mặc định phải loại văn bản hết hiệu lực"


def test_include_superseded_returns_repealed():
    r = LegalRetriever()
    hits = r.retrieve("thành lập doanh nghiệp", include_superseded=True)
    assert any(c.status == STATUS_REPEALED for c in hits), "khi bật include_superseded phải thấy bản đã bị thay thế"


def test_search_executor_returns_citations():
    _force_corpus()
    out = _search_legal_docs({"query": "hợp đồng là gì"})
    assert out["ok"] is True
    assert out["results"], "phải có kết quả"
    assert out["results"][0]["citation"], "mỗi kết quả phải có trích dẫn"


def test_get_article_executor():
    _force_corpus()
    out = _get_legal_article({"document_no": "91/2015/QH13", "article": "Điều 385"})
    assert out["ok"] is True
    assert len(out["results"]) == 1
    assert out["results"][0]["article"] == "Điều 385"


def _run_all():
    fns = [
        test_retrieve_filters_repealed_by_default,
        test_include_superseded_returns_repealed,
        test_search_executor_returns_citations,
        test_get_article_executor,
    ]
    for fn in fns:
        fn()
        print(f"  ok - {fn.__name__}")
    print(f"PASSED {len(fns)}/{len(fns)}")


if __name__ == "__main__":
    _run_all()
