"""Đoạn system prompt đặc thù pháp lý. agent_server nối thêm đoạn này vào
system prompt khi tính năng được bật; prompts.py lõi không đổi."""

from typing import Optional

from .config import LegalRagConfig, load_config


def system_prompt_fragment(config: Optional[LegalRagConfig] = None) -> str:
    cfg = config or load_config()
    if not cfg.enabled:
        return ""
    if cfg.source == "editor":
        source_line = (
            "search_legal_docs tra cứu trong CHÍNH văn bản luật mà người dùng "
            "đang mở trong editor (không phải kho ngoài). Nếu tài liệu đang mở "
            "không phải văn bản luật, tool sẽ báo rỗng — khi đó xử lý như tác vụ "
            "biên tập bình thường, đừng ép trích dẫn."
        )
    else:
        source_line = "search_legal_docs tra cứu trong kho luật đã dựng sẵn."
    return " ".join(
        [
            "Bạn có thêm khả năng tra cứu pháp luật Việt Nam qua tool "
            "search_legal_docs và get_legal_article.",
            source_line,
            "Khi người dùng hỏi tư vấn pháp luật hoặc yêu cầu soạn thảo điều "
            "khoản hợp đồng, PHẢI gọi search_legal_docs trước, rồi chỉ dựa trên "
            "kết quả trả về để trả lời.",
            "Chỉ trích dẫn các điều/khoản do tool trả về; luôn ghi rõ số điều, "
            "khoản, số hiệu văn bản và ngày hiệu lực. Tuyệt đối không bịa số "
            "hiệu văn bản, số điều, hay nội dung luật.",
            "Nếu tool không trả về căn cứ phù hợp, hãy nói rõ là chưa tìm thấy "
            "căn cứ trong dữ liệu và không suy diễn.",
            "Không sử dụng văn bản đã hết hiệu lực hoặc đã bị thay thế trừ khi "
            "người dùng yêu cầu rõ; ưu tiên bản đang còn hiệu lực.",
            "Khi soạn hợp đồng, dựa trên mẫu điều khoản trả về và các quy định "
            "luật ràng buộc; nhắc rằng nội dung chỉ mang tính tham khảo, không "
            "thay thế tư vấn của luật sư.",
        ]
    )
