"""Gói RAG pháp lý tiếng Việt — tự đóng gói.

agent_server chỉ cần 3 thứ export ở đây:
- LEGAL_TOOLS: nối vào build_openai_tools()
- LOCAL_TOOL_EXECUTORS: dispatcher tool cục bộ (read-only, không qua Node bridge)
- system_prompt_fragment(): đoạn prompt pháp lý (rỗng khi tính năng tắt)
- is_enabled(): cờ bật/tắt theo config
"""

from .config import load_config
from .executor import LOCAL_TOOL_EXECUTORS, ToolContext
from .prompts import system_prompt_fragment
from .tools import LEGAL_TOOLS


def is_enabled() -> bool:
    return load_config().enabled


__all__ = [
    "LEGAL_TOOLS",
    "LOCAL_TOOL_EXECUTORS",
    "ToolContext",
    "system_prompt_fragment",
    "is_enabled",
]
