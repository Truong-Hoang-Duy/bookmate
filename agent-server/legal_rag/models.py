"""Mô hình dữ liệu dùng chung cho tầng RAG pháp lý."""

from dataclasses import dataclass
from typing import Optional

# Trạng thái hiệu lực của một đơn vị văn bản luật.
STATUS_CURRENT = "current"
STATUS_SUPERSEDED = "superseded"
STATUS_REPEALED = "repealed"


@dataclass
class LegalChunk:
    """Một đơn vị truy xuất (thường là một Khoản/Điều) kèm metadata trích dẫn."""

    id: str
    text: str
    document_no: str  # số hiệu văn bản, vd "59/2020/QH14"
    document_title: str  # vd "Luật Doanh nghiệp 2020"
    article: str  # vd "Điều 17"
    clause: Optional[str] = None  # vd "Khoản 2"
    effective_date: Optional[str] = None  # ISO "2021-01-01"
    status: str = STATUS_CURRENT
    superseded_by: Optional[str] = None  # số hiệu VB thay thế, nếu có
    source_url: Optional[str] = None
    sample: bool = False  # True nếu là dữ liệu mẫu, chưa phải luật thật

    def citation(self) -> str:
        parts = [self.article]
        if self.clause:
            parts.append(self.clause)
        parts.append(self.document_title or self.document_no)
        return ", ".join(p for p in parts if p)

    def to_result(self) -> dict:
        """Payload gọn để trả cho model (đủ để trích dẫn chính xác)."""
        return {
            "id": self.id,
            "text": self.text,
            "citation": self.citation(),
            "document_no": self.document_no,
            "document_title": self.document_title,
            "article": self.article,
            "clause": self.clause,
            "effective_date": self.effective_date,
            "status": self.status,
            "superseded_by": self.superseded_by,
            "source_url": self.source_url,
            "sample": self.sample,
        }

    @staticmethod
    def from_dict(d: dict) -> "LegalChunk":
        return LegalChunk(
            id=str(d["id"]),
            text=d["text"],
            document_no=d.get("document_no", ""),
            document_title=d.get("document_title", ""),
            article=d.get("article", ""),
            clause=d.get("clause"),
            effective_date=d.get("effective_date"),
            status=d.get("status", STATUS_CURRENT),
            superseded_by=d.get("superseded_by"),
            source_url=d.get("source_url"),
            sample=bool(d.get("sample", False)),
        )
