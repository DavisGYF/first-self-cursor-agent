<template>
  <!-- 左侧栏：历史会话 + 知识库文件（业务状态与请求仍在父组件 App.vue） -->
  <aside class="session-sidebar chat-app-sidebar">
    <section class="sidebar-section" aria-label="历史会话">
      <h2>历史会话</h2>
      <div class="sidebar-backup-row">
        <button type="button" class="sidebar-secondary-btn" @click="emit('export-backup')">导出备份</button>
        <button type="button" class="sidebar-secondary-btn" @click="triggerImport">导入备份</button>
      </div>
      <input
        ref="importInputRef"
        type="file"
        accept="application/json,.json"
        class="sidebar-hidden-input"
        @change="onImportFile"
      />
      <button
        type="button"
        class="sidebar-btn-block"
        :disabled="isGenerating"
        @click="emit('create-session')"
      >
        ＋ 新建会话
      </button>
      <p class="sidebar-hint sidebar-hint-tight">拖动左侧 ⋮⋮ 排序；双击标题或点「名」重命名。</p>
      <div
        v-for="(s, index) in sessions"
        :key="s.id"
        class="session-item"
        :class="{ active: s.id === activeSessionId, 'is-dragging': dragFromIndex === index }"
        @dragover.prevent
        @drop.prevent="onDrop(index)"
      >
        <span
          class="session-drag-handle"
          title="拖动排序"
          draggable="true"
          @dragstart.stop="onDragStart($event, index)"
          @dragend="onDragEnd"
          @click.stop
          >⋮⋮</span
        >
        <div class="session-main" @click="onRowClick(s.id)">
          <template v-if="editingId === s.id">
            <input
              ref="renameInputRef"
              v-model="editingTitle"
              class="session-rename-input"
              maxlength="60"
              @click.stop
              @blur="commitRename(s)"
              @keydown.enter.prevent="commitRename(s)"
              @keydown.esc.prevent="cancelRename"
            />
          </template>
          <span v-else class="session-title" :title="s.title" @dblclick.stop="startRename(s)">{{ s.title }}</span>
        </div>
        <div class="session-actions" @click.stop>
          <button type="button" class="session-rename-btn" title="重命名" @click="startRename(s)">名</button>
          <button type="button" class="session-del" @click="emit('delete-session', s.id)">删</button>
        </div>
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
import { ref, computed, nextTick } from "vue";

const props = defineProps({
  /** 父组件已按侧栏顺序排好的会话列表 */
  sessions: {
    type: Array,
    default: () => []
  },
  activeSessionId: {
    type: String,
    default: ""
  },
  isGenerating: {
    type: Boolean,
    default: false
  },
  uploadingFile: {
    type: Boolean,
    default: false
  },
  selectedFileName: {
    type: String,
    default: ""
  },
  ragStatusText: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "create-session",
  "switch-session",
  "delete-session",
  "rename-session",
  "reorder-sessions",
  "export-backup",
  "import-backup",
  "file-change",
  "upload-click"
]);

const hasSelectedFile = computed(() => !!props.selectedFileName?.trim());

const importInputRef = ref(null);
const renameInputRef = ref(null);
const editingId = ref(null);
const editingTitle = ref("");
const dragFromIndex = ref(null);

function triggerImport() {
  importInputRef.value?.click?.();
}

function onImportFile(event) {
  const file = event?.target?.files?.[0] || null;
  if (file) emit("import-backup", file);
  event.target.value = "";
}

function onFileInput(event) {
  emit("file-change", event);
}

function onRowClick(id) {
  if (editingId.value) return;
  emit("switch-session", id);
}

async function startRename(s) {
  editingId.value = s.id;
  editingTitle.value = s.title || "";
  await nextTick();
  renameInputRef.value?.focus?.();
  renameInputRef.value?.select?.();
}

function cancelRename() {
  editingId.value = null;
}

function commitRename(s) {
  if (editingId.value !== s.id) return;
  emit("rename-session", { id: s.id, title: editingTitle.value });
  editingId.value = null;
}

function onDragStart(_event, index) {
  dragFromIndex.value = index;
}

function onDrop(toIndex) {
  const from = dragFromIndex.value;
  dragFromIndex.value = null;
  if (from == null || from === toIndex) return;
  const ids = props.sessions.map((x) => x.id);
  const next = [...ids];
  const [removed] = next.splice(from, 1);
  next.splice(toIndex, 0, removed);
  emit("reorder-sessions", next);
}

function onDragEnd() {
  dragFromIndex.value = null;
}
</script>
