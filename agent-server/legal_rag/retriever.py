"""Điều phối truy xuất: vector store -> (lọc thời gian trong store) -> rerank."""

from functools import lru_cache
from typing import Optional

from .config import LegalRagConfig, load_config
from .embeddings import maybe_rerank
from .models import LegalChunk
from .vector_store import VectorStore, build_vector_store


def rank_hits(
    config: LegalRagConfig,
    store: VectorStore,
    query: str,
    top_k: Optional[int] = None,
    as_of_date: Optional[str] = None,
    include_superseded: bool = False,
) -> list[LegalChunk]:
    """Truy xuất + (tuỳ chọn) rerank trên MỘT store bất kỳ (corpus hoặc editor)."""
    k = top_k or config.top_k
    hits = store.search(query, k, as_of_date, include_superseded)
    chunks = [c for c, _ in hits]
    if config.rerank_enabled and chunks:
        chunks = maybe_rerank(query, chunks, config.reranker_model, config.rerank_top_k)
    else:
        chunks = chunks[: config.rerank_top_k]
    return chunks


class LegalRetriever:
    def __init__(self, config: Optional[LegalRagConfig] = None):
        self.config = config or load_config()
        self.store: VectorStore = build_vector_store(self.config)

    def retrieve(
        self,
        query: str,
        top_k: Optional[int] = None,
        as_of_date: Optional[str] = None,
        include_superseded: bool = False,
    ) -> list[LegalChunk]:
        return rank_hits(self.config, self.store, query, top_k, as_of_date, include_superseded)

    def get_article(self, document_no: str, article: str) -> list[LegalChunk]:
        return self.store.get_article(document_no, article)


@lru_cache(maxsize=1)
def get_retriever() -> LegalRetriever:
    """Singleton để không nạp lại corpus mỗi lần gọi tool."""
    return LegalRetriever()
