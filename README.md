# Boricua · 波多黎各旅行 Agent

一个**对话式行程生成 + RAG 知识问答** Web 应用：用户用自然语言描述出发城市、日期、人数、预算与偏好，Agent 现场计算并生成可调整、可比价、可执行的逐日行程；开放式攻略问题由 FastAPI 后端检索知识库后交给云端轻量模型或 Ollama 本地模型回答。

前端纯静态实现 —— 原生 HTML / CSS / JavaScript，无框架、无构建步骤、无外部运行依赖，任何静态托管都能直接部署。后端为 Python FastAPI，可选接入，未配置时前端自动降级到规则引擎。

**by Fuyang Fan**

---

## 这不是一个演示壳

行程不是固定模板。`engine.js` 里是一套可测试的生成引擎，每次生成都是现场计算：

| 能力 | 说明 |
| --- | --- |
| 月相推理 | 用朔望月算法计算出发日期的真实月相，判断生物湾（Bioluminescent Bay）是否值得去、安排在哪天 |
| 行程编排 | 偏好（6 类）× 出行关系（4 类）× 预算 → 从 13 种日程模板中打分挑选，约束相邻离岛日、控制节奏 |
| 预算拟合 | 机票按出发城市估算，住宿按档位试算；超预算时按「酒店降档 → 餐饮降档 → 替换付费项目」逐级收敛，无法收敛时**如实提示差额**而非伪造低价 |
| 对话式重排 | "第二天换海滩""降低预算 150""增加一天 Culebra"都会真正改写行程，并同步预算、预订清单与汇总文案 |
| 内容生成 | 按行程标签与季节生成打包清单；按场景生成英文/西语话术；雨天自动生成室内替代路线 |
| 分享还原 | 行程状态（输入 + 编辑历史）编码进 URL hash，打开链接即可还原同一份行程 |

## 后端 RAG 增强（可选）

接入 `backend/` 后，开放式攻略问题（如"Culebra 怎么玩""渡轮怎么订"）会走三层检索：Supabase 向量召回 → Supabase 词法检索 → 本地 JSON 词法降级，再交给 LLM 生成带来源标注的回答。行程修改类操作（增删地点、调整预算）仍由前端确定性规则处理，保证行程可预测、可复现。

```
GitHub Pages 前端 ──► FastAPI Agent API ──► Supabase 知识与会话
                       ├─► 云端轻量模型（OpenAI 兼容）
                       ├─► Ollama 本地模型
                       └─► 本地 JSON 降级知识
```

- 云端模型与 Ollama 双模式生成，通过 `MODEL_PROVIDER` 切换
- 后端或模型不可用时，自动降级到本地知识与前端规则，不影响行程生成
- 首批 18 条知识来自 2026 年 1 月四人 6 天 5 夜真实旅行案例和产品路线规则
- 聊天记录与行程会话持久化到 Supabase，`service_role` 密钥仅存后端环境变量

## 快速开始

### 项目目录结构

```
fuyangfan/
├── index.html          # 落地页 + 行程工作台
├── styles.css          # 全部样式（Caribbean 色板）
├── engine.js           # 生成引擎（纯函数，可测试）
├── app.js              # 界面与交互层（含后端 RAG 接入，自动降级）
├── config.js           # 前端 API 地址配置（部署后修改）
├── tests/
│   └── engine.test.js  # 引擎单元测试
├── backend/            # FastAPI Agent 后端（可选）
│   ├── app/main.py     # /health + /api/chat，三层 RAG 检索
│   ├── data/knowledge.json  # 首批 18 条知识
│   ├── scripts/ingest.py    # Supabase 知识导入脚本
│   ├── tests/validate_project.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── supabase/
│   └── schema.sql      # 数据表与向量检索函数
├── render.yaml         # Render 部署配置
└── 部署说明.md          # 最短上线步骤
```

### 只看前端演示

```bash
cd ~/Downloads && python3 -m http.server 8080
# 打开 http://localhost:8080/fuyangfan/
```

没有后端时，页面右上角显示"DEMO · 待接后端"，路线生成和规则对话仍可完整使用。

### 运行引擎单元测试

```bash
node tests/engine.test.js
```

### 启动完整 Agent（后端 + RAG）

#### 1. 创建 Supabase 数据表

进入 Supabase 项目的 SQL Editor，复制并运行 `supabase/schema.sql`。`service_role` 密钥只能放在后端环境变量中，不得写入 `config.js` 或提交到 GitHub。

#### 2. 配置后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

在 `.env` 中填入 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和云端模型密钥。任何兼容 OpenAI Chat Completions 的云端接口都可以使用，模型名称以你选择的供应商控制台为准。

#### 3. 导入知识库

```bash
python scripts/ingest.py --dry-run   # 只校验，不写入
python scripts/ingest.py             # 正式导入 Supabase
```

`EMBEDDING_PROVIDER=none` 时使用关键词检索；配置为 `cloud` 或 `ollama` 后，导入脚本会同时写入向量并启用 Supabase 向量召回。

#### 4. 启动后端

```bash
uvicorn app.main:app --reload --port 8000
```

访问 `http://127.0.0.1:8000/health`，看到 `status: ok` 即表示后端运行成功。本地前端会自动请求 `http://127.0.0.1:8000`。

#### 5. 运行项目校验

```bash
python backend/tests/validate_project.py
```

### Ollama 本地小模型模式

安装 Ollama 后拉取一个适合自己电脑配置的中文指令模型，例如：

```bash
ollama pull qwen2.5:3b
ollama serve
```

然后在 `backend/.env` 中设置：

```env
MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

生成模型与嵌入模型互相独立，也可以使用"Ollama 生成＋云端向量"组合。

## 部署到公网

### 前端（GitHub Pages）

代码是纯静态的，整个 `fuyangfan/` 目录上传到 GitHub 仓库，GitHub Pages 从仓库根目录发布 `index.html` 即可，地址形如 `https://<用户名>.github.io/fuyangfan/`。

### 后端（Render）

将整个项目提交到 GitHub 后，可用根目录的 `render.yaml` 创建 Render Web Service。Render 中填写 `CLOUD_API_KEY`、`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，部署完成后把服务地址写进 `config.js` 的 `API_URL`，再由 GitHub Pages 发布前端。详细操作见 `部署说明.md`。

## 数据与安全边界

价格、天气、库存、航班、轮渡班次和营业时间均可能变化。用户实测条目标有来源日期，只用于历史参考；实时问题必须进一步接入官方 API 或由用户跳转官方渠道核验。产品不代替移民、医疗或安全专业意见，也不会声称已完成预订或付款。

## 技术栈

- 原生 JavaScript（ES2020），无依赖、无构建
- 引擎层（`engine.js`）与 DOM 层（`app.js`）分离，引擎可在 Node 下直接单测
- 分享链接使用 `base64url(hash)` 编码，不依赖后端
- 后端 FastAPI + httpx，支持 Cloud / Ollama 双模式 LLM
- RAG 三层检索：Supabase pgvector → Supabase 词法 → 本地 JSON 词法
- 响应式布局，桌面 / 移动端均可完整使用

## 路线图

- [x] 接入 FastAPI 后端与 RAG 知识问答（三层检索 + 自动降级）
- [x] Supabase 知识库、向量检索、聊天记录持久化
- [ ] 接入真实 LLM 完成自由文本意图解析（当前行程修改为规则引擎，攻略咨询走后端 LLM）
- [ ] 接入航班 / 酒店 / 活动 / 天气实时 API
- [ ] 行程持久化到本地 IndexedDB 并支持多行程管理
- [ ] 为推荐结果增加来源、更新时间与置信度字段
