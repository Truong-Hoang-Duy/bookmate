"""Wrapper embedding, import lười. Backend 'memory' KHÔNG dùng file này; nó chỉ
cần cho pipeline ingest/Qdrant (BGE-M3…)."""

from typing import Optional

_model_cache: dict = {}


def embed_texts(texts: list[str], model_name: str) -> list[list[float]]:
    """Sinh embedding cho danh sách văn bản bằng sentence-transformers.

    Ném lỗi rõ ràng nếu chưa cài phụ thuộc (xem legal_rag/requirements.txt)."""
    model = _load_model(model_name)
    return [list(map(float, v)) for v in model.encode(texts, normalize_embeddings=True)]


def _load_model(model_name: str):
    if model_name in _model_cache:
        return _model_cache[model_name]
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Cần `pip install -r legal_rag/requirements.txt` để dùng embedding "
            f"({model_name})."
        ) from exc
    model = SentenceTransformer(model_name)
    _model_cache[model_name] = model
    return model


def maybe_rerank(query: str, chunks: list, model_name: str, top_k: Optional[int] = None) -> list:
    """Rerank bằng cross-encoder (BGE-reranker…). Nếu chưa cài phụ thuộc, trả về
    nguyên thứ tự đầu vào (degrade an toàn)."""
    if not chunks:
        return chunks
    try:
        from sentence_transformers import CrossEncoder  # type: ignore
    except ImportError:
        return chunks[:top_k] if top_k else chunks
    key = f"cross::{model_name}"
    reranker = _model_cache.get(key)
    if reranker is None:
        reranker = CrossEncoder(model_name)
        _model_cache[key] = reranker
    scores = reranker.predict([(query, c.text) for c in chunks])
    order = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)
    ranked = [chunks[i] for i in order]
    return ranked[:top_k] if top_k else ranked
