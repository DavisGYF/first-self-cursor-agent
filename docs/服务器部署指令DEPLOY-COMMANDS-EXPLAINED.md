# 部署命令都在干什么？（给自己看的备忘）

面向：**阿里云 ECS + Docker 部署本项目**。不是「白痴问题」，第一次都这样。

---

## 1. 登录服务器（SSH / 阿里云 Workbench）

**干啥**：在你自己电脑上，远程操作云上的那台 Ubuntu（开终端、敲命令）。

**为啥**：网站跑在云上，你必须「上去」装环境、拉代码、起服务。

**常见坑**：终端连接要选 **公网 IP**；用密码就 **重置实例密码**；用密钥必须 **上传私钥**。

---

## 2. 安全组：放行 22 和 3000

| 端口 | 干啥用 |
|------|--------|
| **22** | SSH 远程登录。不放行，你连不上机器。 |
| **3000** | 本项目 Docker 映射出来的 Web 端口。不放行，浏览器打不开 `http://公网IP:3000`。 |

**为啥要配**：云厂商默认从外网「全关」，只开你需要的口，减少被乱扫的风险。

**怎么加**：入方向 → 自定义 TCP → 来源 `0.0.0.0/0`（演示够用）→ 端口 `3000/3000`（以及已有的 22）。

---

## 3. `docker version` / `docker compose version`

**干啥**：检查 Docker、Docker Compose 是否安装成功。

**为啥**：后面用**镜像**跑项目，不在系统里乱装一堆全局 Node，方便换版本、多项目隔离。

**若报错**：试试 `sudo docker ...`；或旧命令 `docker-compose`（中间有横杠）。

---

## 4. `apt update && apt install -y git`

- **apt update**：更新软件包列表。
- **apt install -y git**：安装 **Git**（`-y` 表示自动确认）。

**为啥**：服务器上默认可能没有 `git`，没有就无法 `git clone` 拉代码。

---

## 5. `git clone https://github.com/用户名/仓库名.git`

**干啥**：把远程仓库**下载**到当前目录下的一个文件夹里（例如 `first-self-cursor-agent`）。

**为啥**：运行的代码必须在服务器磁盘上；你本机改完要先 **push**，服务器 **clone/pull** 才是最新版。

---

## 6. `.env` 和 `OPENAI_API_KEY`

**干啥**：在项目根目录放一个 **环境变量文件**（和 `docker-compose.yml` 同级），里面写密钥等敏感信息。

**为啥**：后端调大模型 API 必须带 **API Key**；写进 `.env`，`docker compose` 会读入容器，程序才能正常对话。**不要把 `.env` 提交到 Git**（仓库里已 `.gitignore`）。

**若没有 `.env.example`**：

```bash
git pull   # 先更新仓库
# 仍没有就手写：
nano .env
# 只写一行：OPENAI_API_KEY=你的key
```

---

## 7. nano 怎么保存、退出（编辑器）

`nano` = 服务器上的简单文本编辑器。

| 操作 | 按键 |
|------|------|
| **保存** | `Ctrl + O`（字母 O），再按 **回车** 确认文件名 |
| **退出** | `Ctrl + X`；若提示保存，按 **Y** 再回车 |

屏幕最下方 **`^O`** = Ctrl+O，**`^X`** = Ctrl+X。

---

## 8. `docker compose up -d --build`

| 部分 | 含义 |
|------|------|
| **docker compose** | 读取 **`docker-compose.yml`**，按里面定义的服务来构建/启动容器。 |
| **--build** | 先根据 **`Dockerfile` 构建镜像**（装依赖、构建前端 `web/dist`、编译后端等）。改代码或首次部署通常需要。 |
| **up** | 创建并**启动**容器（已在跑则尽量复用）。 |
| **-d** | **后台**运行（detached），关掉 SSH 窗口容器也还在。 |

**整体效果**：在容器里跑 `node server/index.js`，把容器内 **3000** 映射到主机 **3000**；有 `web/dist` 则**同域**提供页面 + `/api`（与生产环境 `getApiBase()` 为空一致）。

**权限不够时**：前面加 `sudo`，或 `docker-compose up -d --build`（旧写法）。

---

## 9. 常用排查命令

```bash
docker ps              # 哪些容器在跑
docker ps -a           # 包含已退出的
docker logs ai-copilot # 看容器日志（容器名以 compose 为准）
```

---

## 10. 整条链路一句话

**登录云主机 → 安全组放行 22 / 3000 → 装 git → clone 仓库 → 写根目录 `.env`（OPENAI_API_KEY）→ `docker compose up -d --build` → 浏览器访问 `http://公网IP:3000`。**

---

## 11. 国内构建为什么慢？Dockerfile 做了啥

仓库 **`Dockerfile`** 默认：

- **Debian `apt`**：把 `deb.debian.org` / `security.debian.org` 换成 **阿里云镜像**（`USE_CN_APT=true`；海外可加 `--build-arg USE_CN_APT=false`）。
- **`npm`**：默认 **`https://registry.npmmirror.com`**（海外可加 `--build-arg NPM_REGISTRY=https://registry.npmjs.org`）。

**拉基础镜像**（`FROM node:20...`）仍走 Docker Hub，请在服务器配 **阿里云「镜像加速器」**（见 **[DEPLOY-ALIYUN-DOCKER.md](./DEPLOY-ALIYUN-DOCKER.md)** 第 0 步）。

---

## 相关文档

- Docker 一步步：**[DEPLOY-ALIYUN-DOCKER.md](./DEPLOY-ALIYUN-DOCKER.md)**
- 裸机 PM2：**[DEPLOY-ALIYUN.md](./DEPLOY-ALIYUN.md)**
- 国内总览：**[DEPLOY-CN.md](./DEPLOY-CN.md)**
