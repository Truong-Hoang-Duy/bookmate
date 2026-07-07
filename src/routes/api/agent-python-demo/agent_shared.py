"""Schema pydantic + tên/mô tả tool (tiếng Việt, dịch từ documentTools.ts /
documentToolDispatch.ts thật) dùng chung cho agent_server.py. KHÔNG chứa
system prompt — agent_server.py dùng system prompt thật do Node gửi sang qua
`/agent/run`, không tự dịch riêng."""

import json
import logging
import sys
from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel, Field

# Console mac dinh tren Windows thuong dung codepage cp1252/cp437, se crash
# voi UnicodeEncodeError khi in tieng Viet co dau. Ep stdout/stderr sang UTF-8
# o day de log tieng Viet luon in duoc, bat ke codepage cua terminal.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("agent_shared")


def log_step(tag: str, event: str, **data: object) -> None:
    if data:
        logger.info("%s %s | %s", tag, event, json.dumps(data, ensure_ascii=False, default=str))
    else:
        logger.info("%s %s", tag, event)


# --------------------------------------------------------------------------
# Schema input cho tung tool (pydantic) - tuong duong vai tro cua zod trong
# ban that (src/lib/agent/documentTools.ts / documentToolDispatch.ts). Ten
# field giu nguyen dang camelCase de khop chinh xac hop dong tool (JSON) voi
# ban TypeScript that.
# --------------------------------------------------------------------------


class GetDocumentSnapshotInput(BaseModel):
    startChar: Optional[int] = Field(default=None, ge=0)
    maxChars: Optional[int] = Field(default=None, ge=200, le=12000)


class GetSelectionSnapshotInput(BaseModel):
    pass


class GetCursorContextInput(BaseModel):
    maxCharsBefore: Optional[int] = Field(default=None, ge=0, le=1000)
    maxCharsAfter: Optional[int] = Field(default=None, ge=0, le=1000)


class SearchTextInput(BaseModel):
    query: str = Field(min_length=1)
    maxResults: Optional[int] = Field(default=None, ge=1, le=20)


class ReplaceMatchesInput(BaseModel):
    matchIds: list[str] = Field(min_length=1, max_length=50)
    text: str
    contentFormat: Optional[Literal["plain_text", "markdown"]] = None


class PlaceCursorInput(BaseModel):
    matchId: str = Field(min_length=1)
    edge: Optional[Literal["start", "end"]] = None


class PlaceCursorAtDocumentBoundaryInput(BaseModel):
    boundary: Literal["start", "end"]


class InsertParagraphBreakInput(BaseModel):
    pass


class SelectTextInput(BaseModel):
    matchId: str = Field(min_length=1)


class SelectCurrentBlockInput(BaseModel):
    pass


class SelectBetweenMatchesInput(BaseModel):
    startMatchId: str = Field(min_length=1)
    endMatchId: str = Field(min_length=1)
    startEdge: Optional[Literal["start", "end"]] = None
    endEdge: Optional[Literal["start", "end"]] = None


class ClearSelectionInput(BaseModel):
    pass


class SetFormatInput(BaseModel):
    kind: Literal["mark", "block"]
    format: Literal["bold", "italic", "code", "paragraph", "heading", "bullet_list", "ordered_list"]
    action: Optional[Literal["add", "remove", "toggle", "set"]] = None
    level: Optional[int] = Field(default=None, ge=1, le=6)


class InsertTextInput(BaseModel):
    text: str
    contentFormat: Optional[Literal["plain_text", "markdown"]] = None


class DeleteSelectionInput(BaseModel):
    pass


class StartStreamingEditInput(BaseModel):
    mode: Literal["continue", "insert", "rewrite"]
    contentFormat: Optional[Literal["plain_text", "markdown"]] = None


class StopStreamingEditInput(BaseModel):
    pass


@dataclass
class ToolMeta:
    name: str
    description: str
    input_model: type[BaseModel]


TOOLS: list[ToolMeta] = [
    ToolMeta(
        "get_document_snapshot",
        "Đọc một bản chụp (snapshot) văn bản thuần của tài liệu hiện tại để bạn "
        "quyết định nơi cần chỉnh sửa.",
        GetDocumentSnapshotInput,
    ),
    ToolMeta(
        "get_selection_snapshot",
        "Đọc vùng chọn (selection) đang hoạt động, nếu có, bao gồm văn bản được "
        'chọn và phạm vi chính xác. Dùng tool này khi người dùng nhắc đến '
        '"đoạn này" hoặc vùng chọn hiện tại và bạn muốn kiểm tra nó trước khi '
        "chỉnh sửa.",
        GetSelectionSnapshotInput,
    ),
    ToolMeta(
        "get_cursor_context",
        "Đọc ngữ cảnh văn bản thuần xung quanh vị trí con trỏ hiện tại. Dùng "
        'tool này khi người dùng nói "ở đây" và bạn muốn kiểm tra điểm chèn '
        "trước khi chỉnh sửa.",
        GetCursorContextInput,
    ),
    ToolMeta(
        "search_text",
        "Tìm kiếm văn bản chính xác trong tài liệu và trả về các match handle "
        "ổn định kèm ngữ cảnh xung quanh.",
        SearchTextInput,
    ),
    ToolMeta(
        "replace_matches",
        "Thay thế nhiều kết quả khớp chính xác đã tìm thấy trước đó trong một "
        "bước. Dùng tool này sau search_text khi người dùng muốn thay đổi cùng "
        "một đoạn văn bản chính xác ở nhiều nơi, ví dụ đổi tên một nhân vật "
        "xuyên suốt tài liệu. Đặt contentFormat thành markdown khi chuỗi thay "
        "thế dùng markdown nội dòng như **đậm**, *nghiêng*, hoặc `code` và cần "
        "trở thành định dạng thay vì ký tự thuần.",
        ReplaceMatchesInput,
    ),
    ToolMeta(
        "place_cursor",
        "Đặt con trỏ của agent ở đầu hoặc cuối một match handle đã trả về "
        "trước đó.",
        PlaceCursorInput,
    ),
    ToolMeta(
        "place_cursor_at_document_boundary",
        "Đặt con trỏ của agent ở vị trí đầu tiên hoặc cuối cùng của tài liệu. "
        "Dùng tool này cho các yêu cầu như thêm tiêu đề ở đầu hoặc thêm văn "
        "bản chính xác ở cuối.",
        PlaceCursorAtDocumentBoundaryInput,
    ),
    ToolMeta(
        "insert_paragraph_break",
        "Tạo một khối đoạn văn mới, rỗng, tại vị trí con trỏ hiện tại và di "
        "chuyển con trỏ vào đó. Dùng tool này khi người dùng yêu cầu đoạn thứ "
        "hai, đoạn văn mới, hoặc đoạn kết như một khối riêng biệt.",
        InsertParagraphBreakInput,
    ),
    ToolMeta(
        "select_text",
        "Chọn chính xác đoạn văn bản được đại diện bởi một match handle đã "
        "trả về trước đó.",
        SelectTextInput,
    ),
    ToolMeta(
        "select_current_block",
        "Chọn toàn bộ khối văn bản hiện tại xung quanh con trỏ. Dùng tool này "
        "để định dạng hoặc viết lại dòng/đoạn văn hiện tại khi bạn đã biết con "
        "trỏ đang ở đúng khối.",
        SelectCurrentBlockInput,
    ),
    ToolMeta(
        "select_between_matches",
        "Tạo một vùng chọn giữa hai kết quả khớp đã trả về trước đó, chọn cạnh "
        "bắt đầu/kết thúc cho mỗi bên.",
        SelectBetweenMatchesInput,
    ),
    ToolMeta(
        "clear_selection",
        "Xóa vùng chọn hiện tại nhưng vẫn giữ nguyên mục tiêu con trỏ hiện tại.",
        ClearSelectionInput,
    ),
    ToolMeta(
        "set_format",
        "Áp dụng định dạng cho vùng chọn hiện tại. Dùng tool này sau khi đã "
        "chọn văn bản, cho các mark như đậm/nghiêng/code hoặc định dạng khối "
        "như đoạn văn, tiêu đề, danh sách gạch đầu dòng, hoặc danh sách đánh "
        "số.",
        SetFormatInput,
    ),
    ToolMeta(
        "insert_text",
        "Chèn văn bản tại vị trí con trỏ hiện tại. Nếu đang có vùng chọn, nó "
        "sẽ bị thay thế. Dùng plain_text cho các chuỗi chính xác cần xuất hiện "
        "y nguyên trong tài liệu. Đặt contentFormat thành markdown khi "
        "markdown nội dòng ngắn như **đậm**, *nghiêng*, hoặc `code` cần trở "
        "thành định dạng thật thay vì ký tự thuần.",
        InsertTextInput,
    ),
    ToolMeta(
        "delete_selection",
        "Xóa vùng chọn hiện tại, nếu có.",
        DeleteSelectionInput,
    ),
    ToolMeta(
        "start_streaming_edit",
        "Kích hoạt tin nhắn văn bản tiếp theo của assistant để chèn vào tài "
        "liệu tại vị trí con trỏ hoặc vùng chọn hiện tại. Dùng tool này khi "
        "người dùng muốn có văn xuôi thật được viết vào tài liệu, như một câu "
        "chuyện, đoạn văn, phần tiếp nối, hoặc bài viết lại. Trong khi đang "
        "hoạt động, chỉ xuất ra văn xuôi tài liệu, không giải thích. Đặt "
        "contentFormat thành markdown khi bạn muốn markdown được stream trở "
        "thành định dạng tài liệu có cấu trúc. Chỉ dùng chế độ rewrite khi đã "
        "có vùng chọn.",
        StartStreamingEditInput,
    ),
    ToolMeta(
        "stop_streaming_edit",
        "Dừng streaming edit đang được kích hoạt. Thông thường server sẽ tự "
        "động dừng khi kết thúc tin nhắn, nên tool này chủ yếu dùng để hủy "
        "hoặc thoát sớm.",
        StopStreamingEditInput,
    ),
]

TOOL_BY_NAME: dict[str, ToolMeta] = {meta.name: meta for meta in TOOLS}


def build_openai_tools(tools: list[ToolMeta] = TOOLS) -> list[dict]:
    """Xây danh sách `tools=` cho OpenAI function calling từ metadata dùng chung."""
    result = []
    for meta in tools:
        schema = meta.input_model.model_json_schema()
        schema.pop("title", None)
        schema.setdefault("properties", {})
        schema["additionalProperties"] = False
        result.append(
            {
                "type": "function",
                "function": {"name": meta.name, "description": meta.description, "parameters": schema},
            }
        )
    return result
