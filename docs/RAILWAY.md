# Railway 部署（可视化、公网访问）

> **国内用户注意**：[railway.com](https://railway.com) 控制台在**境外**，国内访问常需代理或不稳定。若你**只考虑大陆、不想科学上网**，请优先看 **[DEPLOY-CN.md](./DEPLOY-CN.md)**（腾讯云/阿里云轻量、Docker + 国内云托管等）。

---

部署成功后：**不用在你电脑上开服务**，别人用 Railway 给的 **HTTPS 域名** 就能打开；二维码用任意「网址 → 二维码」工具生成即可。

> **费用**：Railway 以官网 [Pricing](https://railway.com/pricing) 为准；免费档通常只有少量试用额度，个人演示一般够用，超出需绑卡或升级。**SQLite** 默认在容器磁盘上，**重部署会丢库**；要长期保留会话/RAG，请在 Railway 里挂 **Volume** 并设置环境变量 `DATABASE_PATH`（见下）。

## 1. 准备代码

把本仓库推到 **GitHub**（或 Railway 支持的 Git 源）。

## 2. 在 Railway 创建服务

1. 打开 [railway.app](https://railway.com) 登录。
2. **New Project** → **Deploy from GitHub repo** → 选本仓库。
3. Railway 会检测到根目录 `package.json`（Nixpacks 构建），执行：
   - **Build**：`npm run build`（构建 `web/dist` + 安装 `server` 依赖）
   - **Start**：`npm start`（`node server/index.js`，同域托管前端）

## 3. 环境变量（必配）

在项目的 **Variables** 里添加：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | **必填**，你的大模型 API Key |
| `OPENAI_BASE_URL` | 可选，默认 OpenAI 兼容地址 |
| `DEFAULT_MODEL` | 可选，默认模型名 |
| `PORT` | **不要手动设**（Railway 自动注入） |

保存后会自动重新部署。

## 4. 域名

在 **Settings → Networking → Generate Domain**，得到 `https://xxx.up.railway.app`，发给别人即可。

## 5. （可选）持久化 SQLite

默认数据库在 `server/data/copilot.db`，容器重建会清空。

1. 在 Railway 服务里 **Add Volume**，挂载路径例如 `/data`。
2. 在 Variables 增加：`DATABASE_PATH=/data/copilot.db`。
3. 重新部署。

## 6. 故障排查

- **构建失败**：看 **Deployments → Build logs**，常见是 `npm ci` 需提交 `web/package-lock.json` 与 `server/package-lock.json`。
- **运行崩溃**：看 **Deploy logs**；确认 `OPENAI_API_KEY` 已设。
- **健康检查**：`GET /api/health`（已在 `railway.toml` 配置）。
