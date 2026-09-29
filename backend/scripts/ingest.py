from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def setting(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def embedding_for(text: str) -> list[float] | None:
    provider = setting("EMBEDDING_PROVIDER", "none").lower()
    model = setting("EMBEDDING_MODEL", "text-embedding-3-small")
    if provider == "cloud":
        base = setting("EMBEDDING_API_BASE", setting("CLOUD_API_BASE", "https://api.openai.com/v1")).rstrip("/")
        key = setting("EMBEDDING_API_KEY", setting("CLOUD_API_KEY"))
        if not key:
            raise RuntimeError("EMBEDDING_PROVIDER=cloud 但未配置 EMBEDDING_API_KEY")
        response = httpx.post(
            f"{base}/embeddings",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "input": text},
            timeout=40,
        )
        response.raise_for_status()
        return response.json()["data"][0]["embedding"]
    if provider == "ollama":
        base = setting("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
        response = httpx.post(
            f"{base}/api/embed",
            json={"model": model, "input": text},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()["embeddings"][0]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="导入 Boricua 知识条目到 Supabase")
    parser.add_argument("--dry-run", action="store_true", help="只检查数据，不写入 Supabase")
    args = parser.parse_args()

    data_path = BACKEND_DIR / "data" / "knowledge.json"
    items = json.loads(data_path.read_text(encoding="utf-8"))
    ids = [item["id"] for item in items]
    if len(ids) != len(set(ids)):
        raise RuntimeError("knowledge.json 存在重复 id")

    provider = setting("EMBEDDING_PROVIDER", "none").lower()
    model = setting("EMBEDDING_MODEL", "text-embedding-3-small") if provider != "none" else None
    rows = []
    for item in items:
        row = dict(item)
        row["embedding"] = embedding_for(f"{item['title']}\n{item['content']}")
        row["embedding_model"] = model
        rows.append(row)

    if args.dry_run:
        print(f"校验通过：{len(rows)} 条知识；embedding_provider={provider}")
        return

    url = setting("SUPABASE_URL").rstrip("/")
    key = setting("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("请在 backend/.env 配置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY")
    response = httpx.post(
        f"{url}/rest/v1/knowledge_chunks?on_conflict=id",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json=rows,
        timeout=90,
    )
    response.raise_for_status()
    print(f"导入完成：{len(rows)} 条知识；embedding_provider={provider}")


if __name__ == "__main__":
    main()
