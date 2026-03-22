# 流式输出演进：每一版「怎么想、怎么写、哪里不对」深度版

> 本文与 `streaming-output-debug-notes.md` 互补：那一篇偏结论，这一篇按**版本**把代码、对比、踩坑写细，方便你对照仓库自己推演。

---

## 总览：我们一共经历了哪几种「前端更新策略」

| 阶段 | 策略简述 | 结果 |
|------|----------|------|
| **初始** | 只改 `assistantMessage.content`，`fetch` 用 `/api` | 可能整段才到 / 或界面像一次性出来 |
| **v1** | 流式请求直连 `localhost:3000`（`getApiBase`） | 解决 **代理缓冲**，数据更早分段到达 |
| **v2** | 每个 token 后 `await nextTick()` | 仍可能「看起来像一次性」，因更新仍可能被合并 |
| **v3** | `splice` 替换整条消息，但用 `indexOf(msg)` 找下标 | **致命 bug**：第二个字起 `indexOf` 为 -1 |
| **v4** | 尝试 `flushSync` | **构建失败**：runtime-only 无此导出 |
| **v5（终版）** | 固定 `assistantIndex`，每次 `list[i]` 读再 `splice` | **成功** |

下面按版本展开：**当时怎么想 → 代码长什么样 → 哪几行有问题 → 和上一版差在哪 → 一句话总结**。

---

## 第 0 版：项目最初的流式读取（问题起点）

### 当时怎么想的

- SSE 就是 `fetch` + `ReadableStream`，`reader.read()` 循环里解析 `data:` 行，解析出 `token` 就拼到助手消息上。
- 助手消息用 `const assistantMessage = { role, content: '' }` 再 `push` 进 `messages`，后面一直改 `assistantMessage.content` 即可。

### 代码（典型写法）

```js
const assistantMessage = { role: "assistant", content: "" };
messages.value.push(assistantMessage);

const response = await fetch("/api/chat/stream", { ... }); // 开发时走 Vite 代理 /api -> 3000
const reader = response.body.getReader();
// ... 循环里：
assistantMessage.content += event.token;
```

### 哪里可能不对（两层）

1. **网络层**：`fetch("/api/...")` 经 Vite 代理时，部分环境下 **整段响应被缓冲**，浏览器侧 `read()` 很久才收到一大块 → 不是 Vue 的锅，是**数据到得晚**。
2. **视图层**：即便数据分段到了，在长 `while` 里连续改同一个对象的 `content`，Vue 3 也可能把 DOM 更新**合并**，体感仍是「最后一下全刷出来」。

### 和「下一版」对比

下一版（v1）先解决 **数据是否分段到达**（直连 3000），再谈 UI 更新策略。

---

## 第 1 版：开发环境直连后端 —— `getApiBase()`

### 当时怎么想的

- 怀疑 **http-proxy（Vite）缓冲了 SSE**，所以浏览器端 `read()` 次数很少、每次很大。
- 开发时让流式接口 **绕过代理**，直接请求 `http://localhost:3000`。

### 代码

```js
function getApiBase() {
  return import.meta.env.DEV ? "http://localhost:3000" : "";
}

// 流式必须用：
await fetch(`${getApiBase()}/api/chat/stream`, { ... });
// 流式测试：
await fetch(`${getApiBase()}/api/stream-demo`);
```

### 这一版哪里对、哪里仍不够

- **对的**：很多情况下能立刻看到 `read()` 次数变多、时间戳拉开，说明**字节流确实分段到了**。
- **不够的**：若你仍用「只改 `assistantMessage.content`」且不用 `splice`，**界面仍可能不逐字刷新**（Vue 更新合并问题），于是进入 v2、v3。

### 和上一版对比

| 对比项 | 第 0 版 | 第 1 版 |
|--------|---------|---------|
| 请求 URL | `/api/...`（经代理） | `http://localhost:3000/api/...`（DEV 直连） |
| 解决的问题 | — | 代理缓冲 SSE |

### 一句话总结

**先保证「管道里真的是流」，再调「界面怎么跟着流变」。**

---

## 第 2 版：每个 token 后 `await nextTick()`

### 当时怎么想的

- 文档说 `nextTick` 会在 DOM 更新后执行，希望 **每来一个 token 就排队一次渲染**，用户能看见打字机。

### 代码

```js
if (event.type === "token" && event.token) {
  assistantMessage.content += event.token;
  await nextTick();
}
```

### 哪里不对 / 为何不够

- `nextTick` 等的是 **Vue 把本次响应式更新刷进虚拟 DOM 的时机**，不是「强制浏览器立刻重绘」。
- 在同一个 async 函数里 **极短时间内** 连续几百次 `content +=` + `nextTick`，浏览器仍可能 **合并绘制**，用户感觉还是「最后一起出来」。
- 所以：**单靠 nextTick 不能从根上保证「一字一帧」**。

### 和上一版对比

| 对比项 | 第 1 版 | 第 2 版 |
|--------|---------|---------|
| 数据到达 | 已优化（直连） | 同左 |
| UI 策略 | 改属性 | 改属性 + nextTick |
| 典型结果 | 仍可能整块显示 | 略好，但不稳定 |

### 一句话总结

**nextTick 适合「等一轮更新」，不适合当作「流式打字机」的硬保证。**

---

## 第 3 版：用 `splice` 替换整条消息 —— 但用错了查找方式（事故版）

### 当时怎么想的

- 既然改属性可能被合并，那就 **每次生成新对象** 塞进数组，强迫 Vue 认为引用变了：`splice(idx, 1, newMsg)`。
- 为了拿到 `idx`，用 **`indexOf(当初 push 的那个 msg)`**。

### 代码（错误）

```js
function appendStreamToken(msg, token) {
  msg.content += token; // 先改旧对象上的 content
  const idx = messages.value.indexOf(msg);
  if (idx >= 0) {
    messages.value.splice(idx, 1, { ...msg });
  }
}

// 调用：
appendStreamToken(assistantMessage, event.token);
```

### 代码里哪几行是「雷」

1. **`msg.content += token`**：你在**旧对象**上累加；同时下面要用这个旧对象去 `indexOf`。
2. **第一次 `splice` 之后**：数组里已经是 **`{ ...msg }` 新对象**，旧的 `assistantMessage` **不再等于数组里任何一个元素**。
3. **第二次调用**：`indexOf(assistantMessage)` → **`-1`**，`if (idx >= 0)` 不成立 → **后面所有字都不进界面**。
4. 表现就是：**只显示第一个字**（或第一次 splice 那一次），后面全丢；控制台里 `read` 仍在跑，因为 JS 逻辑没断，只是 **UI 没再更新**。

### 和上一版对比

| 对比项 | 第 2 版 | 第 3 版 |
|--------|---------|---------|
| 更新方式 | 原地改 `content` | splice 换新对象 |
| 预期 | 靠 nextTick | 靠引用变化 |
| 实际 | 可能仍合并 | **引用找错 → 第二个字起全废** |

### 一句话总结

**用「对象引用」当数组里的身份证，一旦 splice 换成新对象，旧引用就「失格」了——这是本案例里最隐蔽的 bug。**

---

## 第 4 版：尝试 `flushSync` —— 构建失败

### 当时怎么想的

- Vue 3 提供 `flushSync`，文档语义是 **同步刷新** 待处理的 DOM 更新，想用来强制「一字一屏」。

### 代码（意图）

```js
import { flushSync } from "vue";

function appendStreamToken(msg, token) {
  flushSync(() => {
    msg.content += token;
  });
}
```

### 哪里不行

- 当前项目 `package.json` 引的是 **Vue runtime-only**（`vue.runtime.esm-bundler.js`），**不导出 `flushSync`**。
- 构建报错：`flushSync is not exported by ...`

### 和上一版对比

| 对比项 | 第 3 版 | 第 4 版 |
|--------|---------|---------|
| 能否构建 | 能 | **不能**（缺导出） |
| 业务结果 | 错在逻辑 | 未运行到浏览器 |

### 一句话总结

**不是思路一定错，是打包形态不支持；要么换 Vue 构建，要么换实现（下标 + splice）。**

---

## 第 5 版（终版）：固定下标 `assistantIndex` + 每次读 `messages[i]`

### 当时怎么想的

- **永远不要用「第一次 push 的引用」当数组里的身份**，改用 **固定整数下标** `assistantIndex`。
- 每次追加：`const msg = messages.value[assistantIndex]`，拿 **当前** 在槽位里的对象，再 `splice(assistantIndex, 1, { ...msg, content: 新内容 })`。

### 代码（正确）

```js
messages.value.push({ role: "assistant", content: "", sources: [] });
const assistantIndex = messages.value.length - 1;

function appendStreamToken(assistantIndex, token) {
  const list = messages.value;
  const msg = list[assistantIndex];
  if (!msg || msg.role !== "assistant") return;
  list.splice(assistantIndex, 1, {
    ...msg,
    content: (msg.content || "") + token
  });
}

// 循环里：
appendStreamToken(assistantIndex, event.token);
```

### 为什么这就对了

1. `assistantIndex` **不变**（助手消息占住的那一个坑位不变）。
2. 每次 `list[assistantIndex]` 取到的是 **当前槽位上的对象**（第一次是初始空消息，之后是每次 splice 换进去的新对象）。
3. `content` 在 **新对象** 上累加，**不依赖** 函数外的旧变量引用。
4. `sources` 同理，用 `setAssistantSources(assistantIndex, sources)` 做 splice，不要写 `assistantMessage.sources = ...`（旧引用同样会失效）。

### 和第 3 版（错误 splice）对比

| 对比项 | 第 3 版（错） | 第 5 版（对） |
|--------|----------------|----------------|
| 定位行 | `indexOf(msg)` | **固定 `assistantIndex`** |
| 依赖 | 第一次 push 的 **对象引用** | **数组下标** |
| splice 后 | 旧 `msg` 不在数组里 | 下标仍在，下一帧读新对象 |

### 一句话总结

**数组里「第几条」比「当初那个对象是谁」更可靠；流式要持续更新同一条 UI，用下标当锚点。**

---

## 深度总结（面试可讲）

### 1. 这个问题「难」在哪？

- **不难在 SSE 协议**（按行解析 `data:` 即可）。
- **难在**：开发环境代理、Vue 批量更新、**引用与数组槽位** 三件事叠在一起，现象像「玄学」。

### 2. 排查顺序建议（可写进简历「方法论」）

1. **先确认字节是否分段到达**：Network / 自定义 `read` 次数日志 / 直连后端。
2. **再确认 UI 是否跟着变**：同一套数据，用「下标 + 不可变替换」比「长期持有对象引用」更稳。
3. **最后**再考虑 `flushSync`、rAF、分片渲染等优化。

### 3. 一句教训

> **在会 `splice` 替换元素的数组里，不要用外面的旧引用当「当前项」；用索引。**

---

## 附录：后端与辅助手段（简要）

- **`/api/stream-demo`**：`setInterval` 按间隔写 SSE，与真实模型解耦，专测管道与前端。
- **`X-Accel-Buffering: no`**：提示 Nginx 等勿缓冲 SSE（若前面还有反向代理）。
- **调试面板只打印前 N 次 read**：是日志裁剪，不是只读了 N 次。

---

## 相关文件

| 文件 | 内容 |
|------|------|
| `web/src/App.vue` | `getApiBase`、`appendStreamToken`、`setAssistantSources`、流式循环 |
| `web/vite.config.js` | `/api` 代理 |
| `server/index.js` | `/api/chat/stream`、`/api/stream-demo` |
| `docs/streaming-output-debug-notes.md` | 精简版复盘 |

---

*若你愿意把「第 3 版错误代码」故意保留在 git 历史里，面试时可以展示：如何从 `indexOf` 失败定位到 `assistantIndex` 修复——这是很好的工程故事。*
