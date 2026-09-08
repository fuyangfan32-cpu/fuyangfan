# Boricua · 波多黎各旅行 Agent

一个**对话式行程生成** Web 应用：用户用自然语言描述出发城市、日期、人数、预算与偏好，Agent 现场计算并生成可调整、可比价、可执行的逐日行程。

纯前端实现 —— 原生 HTML / CSS / JavaScript，无框架、无构建步骤、无外部运行依赖，任何静态托管都能直接部署。

**by Fuyang Fan**

---

## 这不是一个演示壳

行程不是固定模板。`engine.js` 里是一套可测试的生成引擎，每次生成都是现场计算：

| 能力 | 说明 |
| --- | --- |
| 月相推理 | 用朔望月算法计算出发日期的真实月相，判断生物湾（Bioluminescent Bay）是否值得去、安排在哪天 |
| 行程编排 | 偏好（6 类）× 出行关系（4 类）× 预算 → 从 13 种日程模板中打分挑选，约束相邻离岛日、控制节奏 |
| 预算拟合 | 机票按出发城市估算，住宿按档位试算；超预算时按「酒店降档 → 餐饮降档 → 替换付费项目」逐级收敛，无法收敛时**如实提示差额**而非伪造低价 |
| 对话式重排 | “第二天换海滩”“降低预算 150”“增加一天 Culebra”都会真正改写行程，并同步预算、预订清单与汇总文案 |
| 内容生成 | 按行程标签与季节生成打包清单；按场景生成英文/西语话术；雨天自动生成室内替代路线 |
| 分享还原 | 行程状态（输入 + 编辑历史）编码进 URL hash，打开链接即可还原同一份行程 |

## 快速开始

项目目录结构：

```
fuyangfan/
├── index.html      # 落地页 + 行程工作台
├── styles.css      # 全部样式（Caribbean 色板）
├── engine.js       # 生成引擎（纯函数，可测试）
├── app.js          # 界面与交互层
└── tests/
    └── engine.test.js
```

本地运行（URL 会带上项目名 fuyangfan）：

```bash
cd ~/Downloads && python3 -m http.server 8080
# 打开 http://localhost:8080/fuyangfan/
```

运行单元测试：

```bash
node tests/engine.test.js
```

## 部署到公网（URL 里带 fuyangfan）

代码是纯静态的，三选一即可：

- **GitHub Pages**：仓库名设为 `fuyangfan` → 地址形如 `https://<用户名>.github.io/fuyangfan/`
- **Vercel / Netlify**：项目名 `fuyangfan` → `https://fuyangfan.vercel.app` 或 `https://fuyangfan.netlify.app`
- **自定义域名**：购买 `fuyangfan.com` 后 CNAME 指向托管服务

> 静态托管对 `index.html` 同级目录下的 `styles.css`、`engine.js`、`app.js` 使用相对路径引用，整个 `fuyangfan/` 目录一起上传即可，无需改任何代码。

## 数据说明

价格、天气与班次为生成时的**估算区间**，会随日期与库存变动；确认预订前请以官方渠道为准。渡轮信息已按 Puerto Rico Ferry 官方路线（Ceiba 出发）校正。身份相关内容只提供一般信息，不构成法律意见，用户应根据个人情况向学校 DSO、USCIS、CBP 或合格移民律师核验。

## 技术栈

- 原生 JavaScript（ES2020），无依赖、无构建
- 引擎层（`engine.js`）与 DOM 层（`app.js`）分离，引擎可在 Node 下直接单测
- 分享链接使用 `base64url(hash)` 编码，不依赖后端
- 响应式布局，桌面 / 移动端均可完整使用

## 路线图

- [ ] 接入真实 LLM 完成自由文本意图解析（当前为规则引擎）
- [ ] 接入航班 / 酒店 / 活动 / 天气实时 API
- [ ] 行程持久化到本地 IndexedDB 并支持多行程管理
- [ ] 为推荐结果增加来源、更新时间与置信度字段
