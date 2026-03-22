# 流式输出从「不生效」到「成功」——问题复盘

本文记录本项目里 **SSE 流式对话** 从出现问题到修好的过程：改了几次、为什么前面不行、最后怎么对的。方便你自学和面试时讲「踩坑与排查」。

---

## 一、问题现象（你最初遇到的）

1. **界面**：回答不是打字机效果，而是一下子整段出现（或只出第一个字就卡住）。
2. **对照**：后端终端里日志正常、按间隔打印 token，说明 **Node 端在持续写 SSE**。
3. **困惑**：「数据明明在流，为什么页面不对？」

---

## 二、中间一共动了几轮（按时间线）

| 轮次 | 做了什么 | 结果 / 原因 |
|------|----------|-------------|
| 1 | 怀疑 Vite 代理缓冲 SSE，前端开发环境 **直连** `http://localhost:3000` | 部分环境有效：代理确实会攒一整包再转发 |
| 2 | 每个 token 后 `await nextTick()` | **不够**：长 `while` 里 Vue 仍可能把更新合并到本轮宏任务结束 |
| 3 | 用 `splice` 替换整条消息对象，强制更新 DOM | **方向对**，但第一次实现有 **致命 bug**（见下文） |
| 4 | 尝试 `flushSync`（Vue）强制刷 DOM | **构建失败**：默认 `vue` 是 **runtime-only**，不导出 `flushSync` |
| 5 | 用 **固定数组下标 `assistantIndex`** + 每次从 `messages[i]` 读再 `splice` | **成功** |

所以：**不是「流式很难」**，而是 **代理 + Vue 更新策略 + 一次错误的对象引用** 叠在一起，看起来像「很难」。

---

## 三、为什么「直连后端」要改？

开发时前端在 `5173`，接口常配：

```js
// vite.config.js
proxy: { "/api": "http://localhost:3000" }
```

部分环境下，`http-proxy` 会对响应做缓冲，**SSE 本应逐段到达浏览器，却整段迟到**。  

**做法**：开发环境对流式接口不用相对路径 `/api`，而是：

```js
function getApiBase() {
  return import.meta.env.DEV ? "http://localhost:3000" : "";
}
// fetch(`${getApiBase()}/api/chat/stream`, ...)
```

生产环境同域部署时仍可用空字符串走相对路径。

---

## 四、为什么只加 `nextTick` 不够？

当时代码类似：

```js
if (event.type === "token" && event.token) {
  assistantMessage.content += event.token;
  await nextTick();
}
```

`nextTick` 只保证「在 DOM 更新队列里排队」，但在**同一个 async 函数里连续跑几百次**时，浏览器仍可能 **合并绘制**，体感仍像「最后一下全出来」。  
所以后来改为 **每次替换整条消息对象** 来「强迫」Vue 认为数据变了（见第六节）。

---

## 五、错误实现：为什么只显示第一个字？（核心坑）

当时为了触发更新，写了类似逻辑：

```js
// ❌ 错误写法（会导致第二个字开始全部丢失）
function appendStreamToken(msg, token) {
  msg.content += token;
  const idx = messages.value.indexOf(msg);
  if (idx >= 0) {
    messages.value.splice(idx, 1, { ...msg });
  }
}
```

**第一次**执行时：

1. `msg` 还在 `messages` 里，`indexOf(msg)` 有下标，`splice` 成功。
2. 数组里被换成 **新对象** `{ ...msg }`。

**从第二次开始**：

- 变量 `msg` 仍指向 **第一次 push 进去的旧对象**。
- 那个旧对象 **已经不在** `messages` 数组里了。
- `indexOf(msg)` 永远是 **`-1`**，`splice` 不执行。
- 界面只停留在第一次更新 → **你只看到第一个字**。

这不是 SSE 难，是 **引用失效** 的经典问题。

---

## 六、正确实现：用「固定下标」而不是「对象引用」

```js
// ✅ 正确：每次用下标在数组里取「当前」那条消息，再替换
function appendStreamToken(assistantIndex, token) {
  const list = messages.value;
  const msg = list[assistantIndex];
  if (!msg || msg.role !== "assistant") return;
  list.splice(assistantIndex, 1, {
    ...msg,
    content: (msg.content || "") + token
  });
}
```

调用处：

```js
messages.value.push({ role: "assistant", content: "", sources: [] });
const assistantIndex = messages.value.length - 1;

// 流式循环里
appendStreamToken(assistantIndex, event.token);
```

要点：

- `assistantIndex` 不变（助手消息在列表里的位置固定）。
- 每次 `splice` 后，**下标处**仍是那条助手消息，只是**新对象**。
- 下一轮 `list[assistantIndex]` 读到的是**新对象**，`content` 已包含上一字，继续追加即可。

`sources` 等字段同理，用 `setAssistantSources(assistantIndex, sources)` 做 `splice`，不要再去改第一次 `push` 时的旧引用。

---

## 七、`flushSync` 为什么没用上？

曾尝试：

```js
import { flushSync } from "vue";
```

构建报错：

> `flushSync` is not exported by `vue.runtime.esm-bundler.js`

当前项目用的是 **Vue 默认 runtime-only 包**，不包含 `flushSync`。要用要么换完整版构建，要么用 **下标 + splice** 的方案（我们最终方案）。

---

## 八、辅助手段：流式 Demo 与日志

为和「真实大模型」解耦，增加了 `GET /api/stream-demo`：用 `setInterval` 按间隔写 `data: {...}\n\n`，便于确认：

- 后端终端：是否按间隔打印。
- 前端：读 `ReadableStream` 的 `read()` 次数、字节数。

调试面板里「只打印前 8 次 read」是**日志策略**，不是只读了 8 次。

---

## 九、总结：难不难？

| 维度 | 结论 |
|------|------|
| SSE 协议本身 | 不复杂：一行行 `data:` 解析即可 |
| 工程环境 | 代理缓冲、直连 3000 这类问题要**对照网络** |
| Vue 更新 | 长循环里**引用**和**下标**要分清，**下标方案**更稳 |
| 难度 | 主要是 **排错经验**，不是算法难 |

---

## 十、相关文件（当前仓库）

- 前端：`web/src/App.vue` — `getApiBase`、`appendStreamToken`、`setAssistantSources`、流式读取循环  
- 后端：`server/index.js` — `/api/chat/stream`、`/api/stream-demo`、SSE 头、`X-Accel-Buffering: no`  
- 开发代理：`web/vite.config.js`

---

*文档随项目迭代可继续补充：例如生产环境 Nginx 对 SSE 的配置、或改用 `ReadableStream` 封装组件等。*
