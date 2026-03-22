# 阿里云轻量（Docker 镜像）：第一次部署 — 手把手版

你已经选了 **应用镜像 → Docker**，下面按顺序做即可。  
（若你还没买机器，镜像请选 **Docker**；规格建议 **2核2G** 及以上。）

---

## 你在阿里云上必须先完成的（网页上点）

### 1. 买好机器

- 轻量应用服务器 → **镜像**：**Docker 应用镜像**（或名称里带 Docker 的）。
- 记下 **root 密码**（或配置好 SSH 密钥）。
- 实例状态为 **运行中**。

### 2. 放行端口（否则浏览器打不开）

在**该实例** → **防火墙** / **安全** / **规则**：

- 增加一条：**TCP**、端口 **3000**、来源 **0.0.0.0/0**（允许所有人访问；以后若要安全可再收紧）。

### 3. 记下公网 IP

在实例详情里看到 **公网 IP**，形如 `47.xxx.xxx.xxx`。

---

## 在你 Mac 上：用终端连上服务器

打开 **终端**（Terminal），执行（把 IP 换成你的）：

```bash
ssh root@你的公网IP
```

第一次会问 `yes/no`，输入 `yes`；再输入 **root 密码**（输入时**不显示字符**，正常）。

看到 `root@xxx:~#` 这类提示符，说明已经登录到云服务器。

---

## 在服务器上：一步一步执行（复制粘贴）

下面**整段都在服务器里执行**（你已经 SSH 进去之后）。

### 第 1 步：确认 Docker 能用

```bash
docker --version
```

能看到类似 `Docker version 24.x` 即可。

再试：

```bash
docker compose version
```

- **若能看到版本号**（推荐）：后面用 **`docker compose`**（中间有空格）。
- **若提示 `command not found`**：试 `docker-compose version`（中间是 `-`）。
  - 若旧版也没有，可先装插件（Ubuntu/Debian 常见）：

```bash
apt update && apt install -y docker-compose-plugin
```
然后再次执行 `docker compose version`。

### 第 2 步：装 git（用来拉代码）

```bash
apt update && apt install -y git
```

### 第 3 步：把代码拉下来

把下面地址换成**你自己的仓库**（GitHub / Gitee 均可）：

```bash
cd /root
git clone https://github.com/你的用户名/你的仓库名.git
cd 你的仓库名
```

若是 **Gitee**，把 `https://gitee.com/...` 换成你的地址。

**私有仓库**：需要在服务器上配 SSH 或 HTTPS Token，第一次建议用**公开仓库**。

### 第 4 步：准备环境变量文件

仓库里已有 **`.env.example`**（在仓库根目录，和 `docker-compose.yml` 同级）。

```bash
cp .env.example .env
nano .env
```

把 `OPENAI_API_KEY=` 后面改成你的 **真实 Key**（不要有空格、不要加引号）。  
保存：`Ctrl+O` 回车，`Ctrl+X` 退出。

> 说明：`.env` 不要提交到 Git；只在服务器上存在即可。

### 第 5 步：构建并启动（第一次会较久，约 5～15 分钟）

**若 `docker compose version` 可用**（推荐）：

```bash
docker compose up -d --build
```

**若只有旧命令 `docker-compose`**：

```bash
docker-compose up -d --build
```

含义：根据仓库里的 **`Dockerfile`** 构建镜像，再按 **`docker-compose.yml`** 起容器，映射 **3000** 端口，并把 SQLite 数据放在 Docker 卷里（重启不丢会话/RAG）。

### 第 6 步：看是否跑起来

```bash
docker ps
```

应能看到名为 **`ai-copilot`** 的容器，状态 **Up**。

看日志（无报错、最后有 `AI server running` 之类）：

```bash
docker logs -f ai-copilot
```

按 **`Ctrl+C`** 退出日志（不会停服务）。

---

## 在你本机浏览器里访问

地址：

```text
http://你的公网IP:3000
```

若打不开，检查：

1. 阿里云防火墙是否放行 **3000**；
2. `docker ps` 里容器是否在跑；
3. `docker logs ai-copilot` 里是否有报错（缺 Key、端口占用等）。

---

## 以后改代码怎么更新

在你**电脑**上 `git push` 之后，在服务器**项目根目录**执行：

```bash
cd /root/你的仓库名
git pull
docker compose up -d --build
```

（若你用的是 `docker-compose`，把上面命令里的 `docker compose` 换成 `docker-compose`。）

---

## 常用命令（备忘）

| 操作 | 命令 |
|------|------|
| 看容器是否在跑 | `docker ps` |
| 看日志 | `docker logs -f ai-copilot` |
| 停掉服务 | `docker compose down`（在仓库根目录） |
| 再起服务 | `docker compose up -d` |

---

## 和「不用 Docker、直接 npm」那套的区别

- **本页**：**Docker 镜像** + 仓库 **`docker-compose.yml`** 一键起服务，适合多项目、以后要隔离环境。
- 若你想用 **裸机 Node + PM2**，见 **[DEPLOY-ALIYUN.md](./DEPLOY-ALIYUN.md)**（不要两套同时占 3000 端口，二选一）。

---

## 出问题把什么发给我

把下面两段**完整复制**发出来（可打码 Key）：

```bash
docker ps -a
docker logs --tail 80 ai-copilot
```

---

到这里：**Docker 路径下**你只要在阿里云放行端口、SSH 登录、按上面从「第 1 步」做到「第 6 步」，浏览器用 `http://公网IP:3000` 访问即可。
