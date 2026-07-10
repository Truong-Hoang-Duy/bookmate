"""Test chế độ 'editor': coi văn bản đang mở là kho tri thức.

Chạy: từ agent-server/  ->  python -m legal_rag.tests.test_editor_source"""

import os

from legal_rag import editor_source
from legal_rag.config import load_config
from legal_rag.executor import ToolContext, _get_legal_article, _search_legal_docs

LAW_TEXT = """
Điều 25. Thời gian thử việc
Thời gian thử việc do hai bên thỏa thuận căn cứ vào tính chất và mức độ phức tạp của công việc nhưng chỉ được thử việc một lần đối với một công việc.

Điều 105. Thời giờ làm việc bình thường
1. Thời giờ làm việc bình thường không quá 08 giờ trong 01 ngày và không quá 48 giờ trong 01 tuần.
2. Người sử dụng lao động có quyền quy định thời giờ làm việc theo ngày hoặc theo tuần.

Điều 113. Nghỉ hằng năm
1. Người lao động làm việc đủ 12 tháng cho một người sử dụng lao động thì được nghỉ hằng năm và hưởng nguyên lương.
""".strip()

BLOG_TEXT = "Đây là một đoạn blog marketing bình thường, không có điều khoản luật nào."


def _force_editor():
    os.environ["LEGAL_RAG_SOURCE"] = "editor"
    load_config.cache_clear()
    editor_source.clear_cache()


def test_chunks_split_by_article_and_clause():
    chunks = editor_source.text_to_chunks(LAW_TEXT)
    articles = {c.article for c in chunks}
    assert {"Điều 25", "Điều 105", "Điều 113"} <= articles
    # Điều 105 có 2 khoản -> mỗi khoản là một chunk riêng
    clauses_105 = {c.clause for c in chunks if c.article == "Điều 105"}
    assert "Khoản 1" in clauses_105 and "Khoản 2" in clauses_105


def test_has_legal_structure():
    assert editor_source.has_legal_structure(LAW_TEXT) is True
    assert editor_source.has_legal_structure(BLOG_TEXT) is False


def test_editor_search_returns_matching_article():
    _force_editor()
    ctx = ToolContext(fetch_document_text=lambda: LAW_TEXT)
    out = _search_legal_docs({"query": "thời giờ làm việc tối đa trong một tuần"}, ctx)
    assert out["ok"] is True and out["results"], out
    assert any(r["article"] == "Điều 105" for r in out["results"]), out


def test_editor_non_law_returns_note():
    _force_editor()
    ctx = ToolContext(fetch_document_text=lambda: BLOG_TEXT)
    out = _search_legal_docs({"query": "thời giờ làm việc"}, ctx)
    assert out["ok"] is True
    assert out["results"] == []
    assert "note" in out


def test_editor_get_article():
    _force_editor()
    ctx = ToolContext(fetch_document_text=lambda: LAW_TEXT)
    out = _get_legal_article({"document_no": "-", "article": "Điều 25"}, ctx)
    assert out["ok"] is True
    assert len(out["results"]) == 1
    assert out["results"][0]["article"] == "Điều 25"


def _run_all():
    fns = [
        test_chunks_split_by_article_and_clause,
        test_has_legal_structure,
        test_editor_search_returns_matching_article,
        test_editor_non_law_returns_note,
        test_editor_get_article,
    ]
    for fn in fns:
        fn()
        print(f"  ok - {fn.__name__}")
    print(f"PASSED {len(fns)}/{len(fns)}")


if __name__ == "__main__":
    _run_all()
