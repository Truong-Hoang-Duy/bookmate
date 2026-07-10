"""Định nghĩa tool RAG pháp lý — TÁCH RIÊNG khỏi TOOLS lõi của editor.

Dùng lại kiểu ToolMeta của agent_shared để agent_server có thể ghép vào
build_openai_tools() mà không phải sửa danh sách TOOLS lõi."""

from typing import Optional

from pydantic import BaseModel, Field

from agent_shared import ToolMeta


class SearchLegalDocsInput(BaseModel):
    query: str = Field(min_length=1, description="Câu hỏi/nội dung pháp lý cần tra cứu.")
    top_k: Optional[int] = Field(default=None, ge=1, le=20)
    # Chỉ lấy văn bản có hiệu lực tại thời điểm này (ISO date, vd "2024-01-01").
    as_of_date: Optional[str] = Field(default=None)
    # Mặc định bỏ qua văn bản đã hết hiệu lực/đã bị thay thế.
    include_superseded: Optional[bool] = Field(default=False)


class GetLegalArticleInput(BaseModel):
    document_no: str = Field(min_length=1, description='Số hiệu văn bản, vd "59/2020/QH14".')
    article: str = Field(min_length=1, description='Số điều, vd "Điều 17".')


LEGAL_TOOLS: list[ToolMeta] = [
    ToolMeta(
        "search_legal_docs",
        "Tra cứu các điều/khoản luật liên quan tới một câu hỏi pháp lý, trả về "
        "kèm trích dẫn (số điều/khoản, số hiệu văn bản, ngày hiệu lực, trạng "
        "thái). Dùng tool này TRƯỚC khi tư vấn pháp luật hoặc soạn thảo điều "
        "khoản hợp đồng; chỉ trích dẫn nội dung do tool trả về, không tự bịa. "
        "Mặc định chỉ trả văn bản đang còn hiệu lực.",
        SearchLegalDocsInput,
    ),
    ToolMeta(
        "get_legal_article",
        "Lấy toàn văn một Điều cụ thể theo số hiệu văn bản và số điều, khi đã "
        "biết chính xác cần trích dẫn điều nào.",
        GetLegalArticleInput,
    ),
]
