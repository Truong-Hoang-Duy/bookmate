"""Pipeline offline (tối giản): parse một văn bản luật .txt tiếng Việt thành các
chunk theo Điều/Khoản kèm metadata, ghi ra JSON để backend nạp.

Ví dụ:
    python -m legal_rag.ingest --input luat_xyz.txt \
        --document-no 59/2020/QH14 --title "Luật Doanh nghiệp 2020" \
        --effective-date 2021-01-01 --out data/ldn2020.json

Với backend 'memory', file JSON kết quả đặt trong data/ là dùng được ngay. Với
Qdrant/pgvector cần thêm bước embedding + upsert (chưa nối trong bản khung này)."""

import argparse
import json
import re
from pathlib import Path

# "Điều 12." / "Điều 12 -" / "Điều 12:"
_ARTICLE_RE = re.compile(r"^\s*(Điều\s+\d+[a-zA-Z]?)\s*[.\-:]?\s*(.*)$")
# "1." / "2)" ở đầu dòng -> khoản
_CLAUSE_RE = re.compile(r"^\s*(\d+)[.)]\s+(.*)$")


def parse_law_text(text: str) -> list[dict]:
    """Trả về danh sách {article, clause, text} chưa gắn metadata văn bản."""
    articles: list[dict] = []
    current_article = None
    buffer: list[str] = []

    def flush():
        if current_article and buffer:
            _split_clauses(current_article, "\n".join(buffer).strip(), articles)

    for line in text.splitlines():
        m = _ARTICLE_RE.match(line)
        if m:
            flush()
            buffer = []
            current_article = m.group(1).strip()
            head = m.group(2).strip()
            if head:
                buffer.append(head)
        else:
            buffer.append(line)
    flush()
    return articles


def _split_clauses(article: str, body: str, out: list[dict]) -> None:
    clauses: list[tuple[str, list[str]]] = []
    current = None
    for line in body.splitlines():
        m = _CLAUSE_RE.match(line)
        if m:
            current = (f"Khoản {m.group(1)}", [m.group(2).strip()])
            clauses.append(current)
        elif current:
            current[1].append(line.strip())
        else:
            current = (None, [line.strip()])
            clauses.append(current)
    if not clauses:
        return
    if len(clauses) == 1 and clauses[0][0] is None:
        out.append({"article": article, "clause": None, "text": " ".join(clauses[0][1]).strip()})
        return
    for clause, lines in clauses:
        chunk_text = " ".join(x for x in lines if x).strip()
        if chunk_text:
            out.append({"article": article, "clause": clause, "text": chunk_text})


def build_chunks(parsed: list[dict], meta: dict) -> list[dict]:
    chunks = []
    for i, p in enumerate(parsed):
        clause_slug = (p["clause"] or "").replace(" ", "").lower()
        art_slug = p["article"].replace(" ", "").lower()
        chunks.append(
            {
                "id": f"{meta['document_no']}::{art_slug}::{clause_slug or i}",
                "text": p["text"],
                "document_no": meta["document_no"],
                "document_title": meta["title"],
                "article": p["article"],
                "clause": p["clause"],
                "effective_date": meta.get("effective_date"),
                "status": meta.get("status", "current"),
                "superseded_by": meta.get("superseded_by"),
                "source_url": meta.get("source_url"),
                "sample": False,
            }
        )
    return chunks


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest văn bản luật .txt -> chunks JSON")
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--document-no", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--effective-date", default=None)
    ap.add_argument("--status", default="current")
    ap.add_argument("--superseded-by", default=None)
    ap.add_argument("--source-url", default=None)
    args = ap.parse_args()

    text = Path(args.input).read_text(encoding="utf-8")
    parsed = parse_law_text(text)
    chunks = build_chunks(
        parsed,
        {
            "document_no": args.document_no,
            "title": args.title,
            "effective_date": args.effective_date,
            "status": args.status,
            "superseded_by": args.superseded_by,
            "source_url": args.source_url,
        },
    )
    Path(args.out).write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Đã ghi {len(chunks)} chunk vào {args.out}")


if __name__ == "__main__":
    main()
