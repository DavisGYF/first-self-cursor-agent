<template>
  <!-- 左侧栏：历史会话 + 知识库文件选择（业务状态与请求仍在父组件 App.vue） -->
  <aside class="session-sidebar chat-app-sidebar">
    <section class="sidebar-section" aria-label="历史会话">
      <h2>历史会话</h2>
      <button
        type="button"
        class="sidebar-btn-block"
        :disabled="isGenerating"
        @click="emit('create-session')"
      >
        ＋ 新建会话
      </button>
      <div
        v-for="s in sessions"
        :key="s.id"
        class="session-item"
        :class="{ active: s.id === activeSessionId }"
        @click="emit('switch-session', s.id)"
      >
        <span class="session-title" :title="s.title">{{ s.title }}</span>
        <button type="button" class="session-del" @click.stop="emit('delete-session', s.id)">
          删
        </button>
      </div>
    </section>

    <div class="sidebar-divider" role="separator" />

    <section class="sidebar-section" aria-label="知识库文件">
      <h2>知识库文件</h2>
      <p class="sidebar-hint">上传 .txt / .md 到后端内存 RAG，对话区勾选「启用 RAG」后生效。</p>
      <div class="sidebar-file-stack">
        <input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          class="sidebar-file-input"
          @change="onFileInput"
        />
        <button type="button" :disabled="!hasSelectedFile || uploadingFile" @click="emit('upload-click')">
          {{ uploadingFile ? "上传中..." : "上传知识库文件" }}
        </button>
      </div>
      <p v-if="selectedFileName" class="sidebar-file-name" :title="selectedFileName">
        已选：{{ selectedFileName }}
      </p>
      <p v-if="ragStatusText" class="sidebar-rag-status">{{ ragStatusText }}</p>
    </section>
  </aside>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  /** 已按更新时间排序的会话列表（由父组件计算后传入） */
  sessions: {
    type: Array,
    default: () => []
  },
  activeSessionId: {
    type: String,
    default: ""
  },
  /** 生成中时不允许新建会话，避免状态错乱 */
  isGenerating: {
    type: Boolean,
    default: false
  },
  uploadingFile: {
    type: Boolean,
    default: false
  },
  /** 当前选中的本地文件名（仅展示） */
  selectedFileName: {
    type: String,
    default: ""
  },
  /** 上传结果或错误文案（由父组件写入） */
  ragStatusText: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "create-session",
  "switch-session",
  "delete-session",
  "file-change",
  "upload-click"
]);

const hasSelectedFile = computed(() => !!props.selectedFileName?.trim());

function onFileInput(event) {
  emit("file-change", event);
}
</script>
