# 阿里云 ECS 部署实录（从上线到跑通）

记录本次：**从买试用机、Docker 构建、安全组、到对话能用的全过程**，以及中间最费时间的坑，方便下次自己或同事扫一眼。

---

## 结果

- **最终状态**：浏览器访问 `http://公网IP:3000`，页面正常；配置 **DeepSeek 的 Key + OPENAI_BASE_URL** 后，对话流式正常。
- **仓库路径**：项目根目录 `docker compose up -d --build`，根目录 `.env` 供 compose 读入容器。

---

## 流程概览（做对了什么）

1. **阿里云 ECS 试用**（按量 + 额度）：选 **Ubuntu 22.04**、**内地地域**，实例 **运行中**。
2. **安全组入方向**：放行 **TCP 22**（SSH）、**TCP 3000**（Web）。  
   - 注意：若换实例 / 换安全组，**3000 要重新加**，只加在「当前实例绑定的安全组」上。
3. **远程连接**：Workbench 或本机 `ssh root@公网IP`；**公网**访问，不要选私网 IP。
4. **Docker**：`git clone` → 根目录 **`.env`**（至少 `OPENAI_API_KEY`）→ `docker compose up -d --build`。
5. **浏览器**：必须用 **`http://公网IP:3000`**（带 **`:3000`**），不要写默认 80 端口。
6. **DeepSeek**：除 Key 外，在 **`.env`** 增加 **`OPENAI_BASE_URL=https://api.deepseek.com/v1`**，改完后 **`docker compose up -d --force-recreate`** 让容器重新读环境变量。

---

## 最费时间的两件事（本次踩坑）

### 1. 第一次 Docker 构建特别慢（约 40～50 分钟量级）

**现象**：`docker compose up --build` 卡在拉 `node:20-bookworm-slim`、`apt-get` 走 `deb.debian.org`、`npm` 走境外源，进度上显示 `(12/18)` 之类，**没有总进度条**，单步 `apt` 能跑十几分钟。

**原因**（本质）：

- 构建在 **阿里云北京 ECS 上执行**，走的是 **Docker Hub + Debian 官方源 + npm 官方源**，国内直连经常慢，**和你本机开不开「科学上网」无关**（代理在你自己电脑上，**加速不了云服务器出网**）。

**后来仓库里已加的优化**（下次全量构建会舒服很多）：

- **`Dockerfile`**：`apt` 换 **阿里云 Debian 镜像**，`npm` 默认 **npmmirror**；可选 build-arg 关国内源（海外构建用）。
- **`docs/DEPLOY-ALIYUN-DOCKER.md`**：增加 **「第 0 步」**——在服务器上配 **Docker「镜像加速器」**（阿里云控制台 ACR 里复制地址，写 `/etc/docker/daemon.json`），拉基础镜像会快很多。
- **同一台机器、有缓存后**再构建：通常 **几分钟级**，不会每次都 40 分钟。

**建议**：新机器第一次构建前，**先配镜像加速器**，再 `docker compose up -d --build`。

---

### 2. 页面能开，对话报错：`TypeError: fetch failed` / 上游调不通

**现象**：`http://公网IP:3000` 静态页正常，一发消息就失败；Network 里请求已是 **公网** 的 `/api/chat/stream`，不是 localhost。

**原因**（本次）：

- 下拉选了 **DeepSeek 模型**（如 `deepseek-chat`），但 **`.env` 里只配了 `OPENAI_API_KEY`**，**没有配 `OPENAI_BASE_URL`**。
- 后端默认 **`OPENAI_BASE_URL=https://api.openai.com/v1`**，等于用 **OpenAI 的地址 + DeepSeek 的 Key**，对不上，上游请求会失败（表现因环境而异，常见为流式异常或错误信息）。

**正确配置示例**（服务器项目根目录 `.env`）：

```env
OPENAI_API_KEY=sk-你的DeepSeek密钥
OPENAI_BASE_URL=https://api.deepseek.com/v1
```

说明：服务端拼的是 **`OPENAI_BASE_URL` + `/chat/completions`**，所以 Base 必须带 **`/v1`**。

**改完后**需要让容器重新加载环境变量，例如：

```bash
cd ~/first-self-cursor-agent
docker compose up -d --force-recreate
```

若只用 **OpenAI 官方**，一般只配 Key 即可（可不写 Base，默认就是 OpenAI）。

---

## 和「前端页面配置」的关系（备忘）

- **Key、BaseURL 必须在服务端配置**，不要写进前端（会泄露）。
- 页面里**切换模型**只改请求里的 **model 名字**；**不会自动切换** BaseURL。换厂商（OpenAI ↔ DeepSeek）要改 **服务器 `.env`**，或以后在后端做「按模型路由」（后续再弄）。

---

## 相关文档索引

| 文档 | 内容 |
|------|------|
| [DEPLOY-ALIYUN-DOCKER.md](./DEPLOY-ALIYUN-DOCKER.md) | Docker 部署步骤 + **镜像加速器第 0 步** |
| [服务器部署指令DEPLOY-COMMANDS-EXPLAINED.md](./服务器部署指令DEPLOY-COMMANDS-EXPLAINED.md) | 命令含义备忘 |
| [.env.example](../.env.example) | 根目录环境变量示例（含 DeepSeek 注释） |

---

*本文档为本次部署过程总结，随项目迭代可继续补充。*
