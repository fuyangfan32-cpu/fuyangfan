from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    knowledge_path = ROOT / "backend" / "data" / "knowledge.json"
    items = json.loads(knowledge_path.read_text(encoding="utf-8"))
    assert len(items) >= 15, "知识条目太少"
    assert len({item["id"] for item in items}) == len(items), "知识 id 必须唯一"

    required = {"id", "title", "content", "category", "places", "tags", "source_type", "source_date", "metadata"}
    for item in items:
        assert required <= item.keys(), f"{item.get('id')} 缺少字段"
        assert item["source_type"] in {"official", "user_experience", "product_rule", "editorial"}
        assert len(item["content"]) >= 30

    app_js = (ROOT / "app.js").read_text(encoding="utf-8")
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    backend_py = (ROOT / "backend" / "app" / "main.py").read_text(encoding="utf-8")
    assert "askAgentBackend" in app_js
    assert 'src="config.js"' in index_html
    assert '@app.post("/api/chat"' in backend_py
    assert "supabase_vector_search" in backend_py
    assert "ollama_completion" in backend_py
    print(f"项目校验通过：{len(items)} 条知识，前后端连接点完整")


if __name__ == "__main__":
    main()
