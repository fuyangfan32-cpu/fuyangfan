from __future__ import annotations

import json
import os
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


MODEL_PROVIDER = env("MODEL_PROVIDER", "cloud").lower()
CLOUD_API_BASE = env("CLOUD_API_BASE", "https://api.openai.com/v1").rstrip("/")
CLOUD_API_KEY = env("CLOUD_API_KEY")
CLOUD_MODEL = env("CLOUD_MODEL", "gpt-4o-mini")
OLLAMA_BASE_URL = env("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = env("OLLAMA_MODEL", "qwen2.5:3b")
EMBEDDING_PROVIDER = env("EMBEDDING_PROVIDER", "none").lower()
EMBEDDING_API_BASE = env("EMBEDDING_API_BASE", CLOUD_API_BASE).rstrip("/")
EMBEDDING_API_KEY = env("EMBEDDING_API_KEY", CLOUD_API_KEY)
EMBEDDING_MODEL = env("EMBEDDING_MODEL", "text-embedding-3-small")
SUPABASE_URL = env("SUPABASE_URL").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
REQUESTS_PER_HOUR = int(env("REQUESTS_PER_HOUR", "40"))
ALLOWED_ORIGINS = [item.strip() for item in env(
    "ALLOWED_ORIGINS",
    "http://localhost:4173,http://127.0.0.1:4173,https://fuyangfan32-cpu.github.io",
).split(",") if item.strip()]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class TripContext(BaseModel):
    departure: str | None = None
    start: str | None = None
    end: str | None = None
    days: int | None = None
    people: int | None = None
    budget_limit: float | None = None
    destinations: list[str] = Field(default_factory=list)
    preferences: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str | None = Field(default=None, max_length=80)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    trip: TripContext | None = None
    intent: str | None = Field(default=None, max_length=80)
    mode: Literal["cloud", "ollama", "auto"] | None = None


class SourceItem(BaseModel):
    id: str
    title: str
    source_type: str
    source_date: str | None = None
    source_url: str | None = None


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    provider: str
    knowledge_mode: str
    sources: list[SourceItem]


app = FastAPI(
    title="Boricua Puerto Rico Travel Agent API",
    version="1.0.0",
    description="Cloud/Ollama dual-mode RAG backend for the Boricua travel Agent.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
KNOWLEDGE_PATH = BACKEND_DIR / "data" / "knowledge.json"
LOCAL_KNOWLEDGE: list[dict[str, Any]] = json.loads(KNOWLEDGE_PATH.read_text(encoding="utf-8"))


PLACE_ALIASES = {
    "sanjuan": ["san juan", "sanjuan", "圣胡安", "老城", "主岛"],
    "vieques": ["vieques", "v岛", "维克斯", "生物湾", "荧光海"],
    "culebra": ["culebra", "c岛", "库莱布拉", "flamenco", "浮潜"],
    "ponce": ["ponce", "庞塞", "南部"],
    "elyunque": ["el yunque", "雨林", "云盖", "yunque"],
}

CONCEPT_ALIASES = {
    "night": ["晚上", "夜间", "夜游", "生物湾", "荧光海"],
    "budget": ["预算", "多少钱", "花费", "费用", "成本", "价格", "便宜"],
    "transport": ["交通", "打车", "uber", "租车", "接送", "司机"],
    "ferry": ["轮渡", "渡轮", "船票", "码头", "ceiba"],
    "food": ["吃饭", "餐厅", "中餐", "当地菜", "外卖"],
    "lodging": ["住宿", "酒店", "民宿", "住哪里", "留宿"],
    "snorkel": ["浮潜", "下水", "海滩", "flamenco"],
    "rainforest": ["雨林", "yunque", "滑梯", "跳水"],
    "risk": ["风险", "取消", "退款", "备选", "突发"],
}


def supabase_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def chinese_bigrams(text: str) -> set[str]:
    runs = re.findall(r"[\u4e00-\u9fff]+", text)
    return {run[index:index + 2] for run in runs for index in range(max(0, len(run) - 1))}


def searchable_terms(text: str) -> tuple[set[str], set[str]]:
    lowered = text.lower()
    latin = set(re.findall(r"[a-z0-9][a-z0-9.-]{1,}", lowered))
    return latin, chinese_bigrams(lowered)


def lexical_score(query: str, item: dict[str, Any], trip: TripContext | None = None) -> float:
    searchable = " ".join([
        str(item.get("title", "")),
        str(item.get("content", "")),
        str(item.get("category", "")),
        " ".join(item.get("places") or []),
        " ".join(item.get("tags") or []),
    ]).lower()
    q_latin, q_zh = searchable_terms(query)
    d_latin, d_zh = searchable_terms(searchable)
    score = 2.0 * len(q_latin & d_latin) + 0.38 * len(q_zh & d_zh)
    normalized_query = query.lower().replace(" ", "")
    for place, aliases in PLACE_ALIASES.items():
        if any(alias.replace(" ", "") in normalized_query for alias in aliases):
            if place in (item.get("places") or []):
                score += 6.0
            if any(alias in searchable for alias in aliases):
                score += 2.0
    for concept, aliases in CONCEPT_ALIASES.items():
        if any(alias in query.lower() for alias in aliases) and any(alias in searchable for alias in aliases):
            score += 5.0
            if concept == "night" and item.get("category") == "activity":
                score += 3.0
            if concept == "budget" and item.get("category") in {"budget", "route_case"}:
                score += 2.0
    if trip:
        overlap = set(trip.destinations) & set(item.get("places") or [])
        score += 0.8 * len(overlap)
    return score


def local_search(query: str, trip: TripContext | None, limit: int = 6) -> list[dict[str, Any]]:
    ranked = sorted(
        ((lexical_score(query, item, trip), item) for item in LOCAL_KNOWLEDGE),
        key=lambda pair: pair[0],
        reverse=True,
    )
    positive = [{**item, "similarity": round(score, 4)} for score, item in ranked if score > 0]
    return positive[:limit] or [{**item, "similarity": 0.01} for item in LOCAL_KNOWLEDGE[:3]]


async def create_embedding(text: str) -> list[float] | None:
    if EMBEDDING_PROVIDER == "cloud" and EMBEDDING_API_KEY:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post(
                f"{EMBEDDING_API_BASE}/embeddings",
                headers={"Authorization": f"Bearer {EMBEDDING_API_KEY}"},
                json={"model": EMBEDDING_MODEL, "input": text},
            )
            response.raise_for_status()
            return response.json()["data"][0]["embedding"]
    if EMBEDDING_PROVIDER == "ollama":
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/embed",
                json={"model": EMBEDDING_MODEL, "input": text},
            )
            response.raise_for_status()
            payload = response.json()
            return payload.get("embeddings", [None])[0]
    return None


async def supabase_vector_search(query: str, limit: int = 6) -> list[dict[str, Any]]:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return []
    embedding = await create_embedding(query)
    if not embedding:
        return []
    payload = {
        "query_embedding": embedding,
        "query_model": EMBEDDING_MODEL,
        "match_threshold": 0.12,
        "match_count": limit,
    }
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/match_knowledge",
            headers=supabase_headers(),
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def supabase_lexical_search(query: str, trip: TripContext | None, limit: int = 6) -> list[dict[str, Any]]:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return []
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            f"{SUPABASE_URL}/rest/v1/knowledge_chunks",
            headers=supabase_headers(),
            params={
                "select": "id,title,content,category,places,tags,source_type,source_date,source_url,metadata",
                "order": "created_at.desc",
                "limit": "250",
            },
        )
        response.raise_for_status()
        items = response.json()
    ranked = sorted(
        ((lexical_score(query, item, trip), item) for item in items),
        key=lambda pair: pair[0],
        reverse=True,
    )
    return [{**item, "similarity": round(score, 4)} for score, item in ranked if score > 0][:limit]


async def retrieve_knowledge(query: str, trip: TripContext | None) -> tuple[list[dict[str, Any]], str]:
    remote: list[dict[str, Any]] = []
    mode = "local-json"
    try:
        remote = await supabase_vector_search(query)
        if remote:
            mode = "supabase-vector"
        else:
            remote = await supabase_lexical_search(query, trip)
            if remote:
                mode = "supabase-lexical"
    except (httpx.HTTPError, KeyError, IndexError, TypeError):
        remote = []

    combined: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in [*remote, *local_search(query, trip)]:
        item_id = str(item.get("id", item.get("title", "unknown")))
        if item_id not in seen:
            seen.add(item_id)
            combined.append(item)
    return combined[:6], mode


def trip_summary(trip: TripContext | None) -> str:
    if not trip:
        return "用户尚未生成结构化行程。"
    fields = {
        "出发地": trip.departure,
        "日期": " 至 ".join(value for value in [trip.start, trip.end] if value),
        "天数": f"{trip.days}天" if trip.days else None,
        "人数": f"{trip.people}人" if trip.people else None,
        "人均预算上限": f"${trip.budget_limit:g}" if trip.budget_limit else None,
        "地点": "、".join(trip.destinations),
        "偏好": "、".join(trip.preferences),
        "硬约束": "、".join(trip.constraints),
    }
    return "；".join(f"{key}：{value}" for key, value in fields.items() if value) or "用户尚未生成结构化行程。"


def build_system_prompt(knowledge: list[dict[str, Any]], trip: TripContext | None) -> str:
    context = "\n\n".join(
        f"[{index}] {item.get('title')}｜来源类型：{item.get('source_type')}｜来源日期：{item.get('source_date') or '未标注'}\n{item.get('content')}"
        for index, item in enumerate(knowledge, start=1)
    )
    return f"""你是 Boricua，一名面向中文用户的波多黎各旅行规划 Agent。

当前行程：{trip_summary(trip)}

你的任务：结合当前行程和检索知识回答问题；信息不足时只追问一个最影响方案的问题；指出路线取舍，而不是罗列景点。

强约束：
1. 不编造实时船班、天气、票价、库存、航班状态或营业时间。此类问题要明确说明需要实时核验。
2. 用户实测只能表达为个人案例，价格必须带日期并标明仅供参考。
3. 不把移民身份、健康或安全问题说成确定结论，应引导用户核验官方渠道。
4. 不声称已经完成预订、付款或联系商家。
5. 优先使用下面的知识；关键事实用[1]这样的编号标注来源。若知识库没有答案，明确说不知道。
6. 用自然、简洁的中文回复，通常控制在180字内；不要输出Markdown表格。

检索知识：
{context}
"""


async def cloud_completion(messages: list[dict[str, str]]) -> str:
    if not CLOUD_API_KEY:
        raise RuntimeError("CLOUD_API_KEY is not configured")
    async with httpx.AsyncClient(timeout=55) as client:
        response = await client.post(
            f"{CLOUD_API_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {CLOUD_API_KEY}"},
            json={
                "model": CLOUD_MODEL,
                "messages": messages,
                "temperature": 0.35,
                "max_tokens": 600,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"].strip()


async def ollama_completion(messages: list[dict[str, str]]) -> str:
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={"model": OLLAMA_MODEL, "messages": messages, "stream": False},
        )
        response.raise_for_status()
        return response.json()["message"]["content"].strip()


def grounded_fallback(knowledge: list[dict[str, Any]], trip: TripContext | None) -> str:
    if not knowledge:
        return "这条问题目前没有检索到可靠资料。你可以告诉我想去的地点、天数和预算，我先帮你缩小路线范围。"
    top = knowledge[0]
    content = re.sub(r"\s+", " ", str(top.get("content", ""))).strip()
    if len(content) > 210:
        content = content[:207] + "…"
    return f"根据知识库里的“{top.get('title')}”：{content} [1] 如果你告诉我更具体的日期或路线，我可以继续帮你做取舍。"


async def persist_chat(session_id: str, request_data: ChatRequest, reply: str, sources: list[dict[str, Any]]) -> None:
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return
    headers = {**supabase_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"}
    trip_payload = request_data.trip.model_dump() if request_data.trip else {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/trip_sessions?on_conflict=id",
                headers=headers,
                json={"id": session_id, "trip_context": trip_payload, "updated_at": datetime.now(timezone.utc).isoformat()},
            )
            await client.post(
                f"{SUPABASE_URL}/rest/v1/chat_messages",
                headers=supabase_headers(),
                json=[
                    {"session_id": session_id, "role": "user", "content": request_data.message},
                    {
                        "session_id": session_id,
                        "role": "assistant",
                        "content": reply,
                        "retrieval_refs": [str(item.get("id")) for item in sources],
                    },
                ],
            )
    except httpx.HTTPError:
        return


def check_rate_limit(client_host: str) -> None:
    now = time.time()
    bucket = RATE_BUCKETS[client_host]
    while bucket and bucket[0] < now - 3600:
        bucket.popleft()
    if len(bucket) >= REQUESTS_PER_HOUR:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试。")
    bucket.append(now)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "default_provider": MODEL_PROVIDER,
        "cloud_configured": bool(CLOUD_API_KEY),
        "ollama_url": OLLAMA_BASE_URL if MODEL_PROVIDER == "ollama" else None,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
        "embedding_provider": EMBEDDING_PROVIDER,
        "local_knowledge_chunks": len(LOCAL_KNOWLEDGE),
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    check_rate_limit(request.client.host if request.client else "unknown")
    session_id = payload.session_id or str(uuid.uuid4())
    knowledge, knowledge_mode = await retrieve_knowledge(payload.message, payload.trip)
    messages: list[dict[str, str]] = [{"role": "system", "content": build_system_prompt(knowledge, payload.trip)}]
    messages.extend({"role": turn.role, "content": turn.text} for turn in payload.history[-8:])
    if not payload.history or payload.history[-1].text != payload.message:
        messages.append({"role": "user", "content": payload.message})

    requested_provider = payload.mode if payload.mode and payload.mode != "auto" else MODEL_PROVIDER
    provider = requested_provider
    try:
        if requested_provider == "ollama":
            reply = await ollama_completion(messages)
        else:
            reply = await cloud_completion(messages)
            provider = "cloud"
    except (httpx.HTTPError, RuntimeError, KeyError, IndexError, TypeError):
        reply = grounded_fallback(knowledge, payload.trip)
        provider = "retrieval-fallback"

    await persist_chat(session_id, payload, reply, knowledge)
    source_items = [
        SourceItem(
            id=str(item.get("id", index)),
            title=str(item.get("title", "知识条目")),
            source_type=str(item.get("source_type", "unknown")),
            source_date=str(item.get("source_date")) if item.get("source_date") else None,
            source_url=item.get("source_url"),
        )
        for index, item in enumerate(knowledge, start=1)
    ]
    return ChatResponse(
        session_id=session_id,
        reply=reply,
        provider=provider,
        knowledge_mode=knowledge_mode,
        sources=source_items,
    )
