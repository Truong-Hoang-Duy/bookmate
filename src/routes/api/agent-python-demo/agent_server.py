"""Server Python đóng vai trò "bộ não" thật cho chat thật của
collaborative-ai-editor. Đây KHÔNG PHẢI route của TanStack Start — đây là một
tiến trình HTTP riêng (FastAPI + uvicorn) mà Node (`src/routes/api/chat.ts`,
khi `AGENT_BRAIN_MODE=python`) gọi sang qua `POST /agent/run`.

File này KHÔNG tự giữ tài liệu nào cả — mỗi khi model quyết định gọi một tool,
file này gọi ngược lại một API nội bộ trên Node
(`POST /api/agent-bridge/tool`, xem `src/routes/api/agent-bridge/tool.ts`) để
tool đó chạy THẬT trên `DocumentToolRuntime`, tức là chỉnh sửa đúng tài liệu
Yjs/ProseMirror đang được chia sẻ trong ứng dụng.

Xem README.md cùng thư mục để biết cách chạy đầy đủ (cần chạy song song
`pnpm dev` ở gốc repo và `python agent_server.py` ở đây).
"""

import json
import os
from pathlib import Path
from typing import Any

import requests
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from agent_shared import TOOL_BY_NAME, build_openai_tools, log_step

load_dotenv(Path(__file__).parent / ".env")

NODE_BRIDGE_BASE_URL = os.environ.get("NODE_BRIDGE_BASE_URL", "http://localhost:3000").rstrip("/")
AGENT_BRIDGE_SECRET = os.environ.get("AGENT_BRIDGE_SECRET", "")

# Tool nào tính là một "mutation" thật trên tài liệu (khớp với
# DocumentToolRuntime.completedMutations thật) — dùng để quyết định có cần tự
# tóm tắt cho chat hay không.
MUTATING_TOOLS = {
    "insert_text",
    "insert_paragraph_break",
    "replace_matches",
    "delete_selection",
    "set_format",
    "start_streaming_edit",
}

SUMMARY_REQUEST_MESSAGE = (
    "Hãy trả lời bằng đúng một câu ngắn, mô tả chính xác những gì bạn vừa "
    "thay đổi trong tài liệu. Đừng nhắc đến tool, streaming, hay chi tiết kỹ "
    "thuật nào."
)

app = FastAPI()

# runId đang bị yêu cầu huỷ giữa chừng (do người dùng bấm "stop" trong app that).
CANCELLED_RUN_IDS: set[str] = set()


class AgentRunRequest(BaseModel):
    runId: str
    systemPrompt: str
    messages: list[dict[str, Any]]
    mode: str = "insert"


class AgentCancelRequest(BaseModel):
    runId: str


def bridge_execute_tool(run_id: str, name: str, args: dict) -> tuple[dict, list[dict]]:
    """Gọi ngược về Node để thực thi tool THẬT trên DocumentToolRuntime."""
    if not AGENT_BRIDGE_SECRET:
        raise RuntimeError("AGENT_BRIDGE_SECRET chưa được cấu hình cho agent_server.py")

    response = requests.post(
        f"{NODE_BRIDGE_BASE_URL}/api/agent-bridge/tool",
        json={"runId": run_id, "name": name, "input": args},
        headers={
            "Content-Type": "application/json",
            "X-Agent-Bridge-Token": AGENT_BRIDGE_SECRET,
        },
        timeout=30,
    )
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Bridge trả về nội dung không phải JSON (HTTP {response.status_code})") from exc

    if not data.get("ok"):
        raise RuntimeError(data.get("error") or f"Bridge tool call thất bại (HTTP {response.status_code})")

    return data.get("result"), data.get("customEvents", [])


def stream_agent_run(run_id: str, system_prompt: str, messages: list[dict], mode: str):
    """Vòng lặp tool-calling tường minh, dùng OpenAI streaming thật (token-by-
    token) để mô phỏng đúng trải nghiệm "chèn dần từng ký tự" của agent thật.
    Yield từng dòng NDJSON — xem pythonAgentBridge.ts phía Node để biết cách
    các dòng này được dịch thành StreamChunk/AGUIEvent."""

    def emit(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False) + "\n"

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    model = os.environ.get("OPENAI_MODEL", "gpt-5.4")
    tools_schema = build_openai_tools()
    convo: list[dict] = [{"role": "system", "content": system_prompt}, *messages]

    log_step("[server]", "bắt đầu xử lý run", runId=run_id, mode=mode)

    streaming_edit_active = False
    had_mutation = False
    chat_message_sent = False

    try:
        while True:
            if run_id in CANCELLED_RUN_IDS:
                log_step("[server]", "run đã bị huỷ trước khi gọi model, dừng lại", runId=run_id)
                yield emit({"type": "done"})
                return

            log_step("[model]", "đang gửi yêu cầu tới model (streaming)...", runId=run_id)
            stream = client.chat.completions.create(model=model, messages=convo, tools=tools_schema, stream=True)

            accumulated_content = ""
            tool_call_acc: dict[int, dict] = {}

            for chunk in stream:
                if run_id in CANCELLED_RUN_IDS:
                    log_step("[server]", "run bị huỷ giữa chừng, đóng kết nối OpenAI", runId=run_id)
                    stream.close()
                    yield emit({"type": "done"})
                    return

                delta = chunk.choices[0].delta
                if delta.content:
                    accumulated_content += delta.content
                    yield emit({"type": "text_delta", "delta": delta.content})
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        acc = tool_call_acc.setdefault(tc.index, {"id": None, "name": "", "arguments": ""})
                        if tc.id:
                            acc["id"] = tc.id
                        if tc.function and tc.function.name:
                            acc["name"] += tc.function.name
                        if tc.function and tc.function.arguments:
                            acc["arguments"] += tc.function.arguments

            if accumulated_content:
                yield emit({"type": "message_end"})

            assistant_message: dict = {"role": "assistant", "content": accumulated_content or None}
            if tool_call_acc:
                assistant_message["tool_calls"] = [
                    {
                        "id": acc["id"],
                        "type": "function",
                        "function": {"name": acc["name"], "arguments": acc["arguments"]},
                    }
                    for acc in tool_call_acc.values()
                ]
            convo.append(assistant_message)

            if not tool_call_acc:
                log_step("[agent]", "model trả lời cuối cùng (không còn tool call), dừng vòng lặp chính", runId=run_id)
                # Trong khi streaming edit đang hoạt động, nội dung văn bản
                # này đi vào TÀI LIỆU (Node chặn lại qua routeAgentStreamChunks),
                # không phải một câu chat thật — nên KHÔNG tính là đã có câu
                # đóng lượt chat.
                chat_message_sent = bool(accumulated_content) and not streaming_edit_active
                break

            for acc in tool_call_acc.values():
                name = acc["name"]
                tag = f"[tool:{name}]"
                log_step("[agent]", "model yêu cầu gọi tool", runId=run_id, tool=name, arguments=acc["arguments"])

                spec = TOOL_BY_NAME.get(name)
                if spec is None:
                    result: dict = {"ok": False, "error": f"Tool không xác định: {name}"}
                    args_dict: dict = {}
                    custom_events: list[dict] = []
                    log_step(tag, "lỗi: tool không xác định")
                else:
                    try:
                        validated = spec.input_model.model_validate_json(acc["arguments"] or "{}")
                        args_dict = validated.model_dump(exclude_none=True)
                        log_step(tag, "input đã được pydantic xác thực", args=args_dict)
                    except ValidationError as exc:
                        log_step(tag, "input KHÔNG hợp lệ (pydantic ValidationError)", errors=exc.errors())
                        result = {"ok": False, "error": f"Tham số không hợp lệ: {exc}"}
                        args_dict = {}
                        custom_events = []
                        convo.append(
                            {"role": "tool", "tool_call_id": acc["id"], "content": json.dumps(result, ensure_ascii=False)}
                        )
                        yield emit({"type": "tool_call", "name": name, "args": {}, "result": result, "customEvents": []})
                        continue

                    try:
                        result, custom_events = bridge_execute_tool(run_id, name, args_dict)
                        log_step(tag, "kết quả từ bridge (đã sửa tài liệu thật)", result=result)
                    except Exception as exc:  # noqa: BLE001 - surface any bridge failure to the model + UI
                        log_step(tag, "lỗi khi gọi bridge", error=str(exc))
                        result = {"ok": False, "error": str(exc)}
                        custom_events = []

                if result.get("ok"):
                    if name == "start_streaming_edit":
                        streaming_edit_active = True
                    elif name == "stop_streaming_edit":
                        streaming_edit_active = False
                    if name in MUTATING_TOOLS:
                        had_mutation = True

                convo.append(
                    {"role": "tool", "tool_call_id": acc["id"], "content": json.dumps(result, ensure_ascii=False)}
                )
                yield emit(
                    {"type": "tool_call", "name": name, "args": args_dict, "result": result, "customEvents": custom_events}
                )
            # quay lại đầu vòng lặp để model tiếp tục sau khi có kết quả tool

        if had_mutation and not chat_message_sent:
            log_step(
                "[server]",
                "đã có thay đổi tài liệu nhưng chưa có câu chat đóng lượt -> tự tóm tắt (không kèm tool)",
                runId=run_id,
            )
            convo.append({"role": "user", "content": SUMMARY_REQUEST_MESSAGE})
            summary_response = client.chat.completions.create(model=model, messages=convo)
            summary = summary_response.choices[0].message.content or ""
            if summary:
                yield emit({"type": "text_delta", "delta": summary})
                yield emit({"type": "message_end"})
            log_step("[server]", "tóm tắt cho chat", runId=run_id, summary=summary)

        yield emit({"type": "done"})
        log_step("[server]", "hoàn tất run", runId=run_id)
    except Exception as exc:  # noqa: BLE001 - báo lỗi rõ ràng cho Node/UI thay vì treo kết nối
        log_step("[server]", "lỗi trong vòng lặp agent", runId=run_id, error=str(exc))
        yield emit({"type": "error", "message": str(exc)})
    finally:
        CANCELLED_RUN_IDS.discard(run_id)


@app.post("/agent/run")
async def agent_run(body: AgentRunRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_agent_run(body.runId, body.systemPrompt, body.messages, body.mode),
        media_type="application/x-ndjson",
    )


@app.post("/agent/cancel")
async def agent_cancel(body: AgentCancelRequest) -> dict:
    CANCELLED_RUN_IDS.add(body.runId)
    log_step("[server]", "đã nhận yêu cầu huỷ run", runId=body.runId)
    return {"ok": True}


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_AGENT_PORT", "8787"))
    log_step("[server]", f"agent_server.py đang lắng nghe tại http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)
