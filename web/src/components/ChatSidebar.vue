<template>
  <!-- 左侧栏：历史会话 + 知识库文件（业务状态与请求仍在父组件 App.vue） -->
  <aside class="session-sidebar chat-app-sidebar">
    <section class="sidebar-section" aria-label="历史会话">
      <h2>历史会话</h2>
      <el-text v-if="serverSyncHint" size="small" type="info" class="sidebar-server-sync" tag="p">
        {{ serverSyncHint }}
      </el-text>
      <div class="sidebar-backup-row">
        <el-button size="small" class="sidebar-backup-btn" @click="emit('export-backup')">导出备份</el-button>
        <el-button size="small" class="sidebar-backup-btn" @click="triggerImport">导入备份</el-button>
      </div>
      <input
        ref="importInputRef"
        type="file"
        accept="application/json,.json"
        class="sidebar-hidden-input"
        @change="onImportFile"
      />
      <el-button
        type="primary"
        class="sidebar-btn-block"
        :disabled="isGenerating"
        @click="emit('create-session')"
      >
        ＋ 新建会话
      </el-button>
      <p class="sidebar-hint sidebar-hint-tight">
        拖动左侧 ⋮⋮ 排序；双击标题或点铅笔进入重命名，再点 ✓ 确认。
      </p>
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
            <el-input
              ref="renameInputRef"
              v-model="editingTitle"
              class="session-rename-input"
              maxlength="60"
              size="small"
              @click.stop
              @blur="commitRename(s)"
              @keydown.enter.prevent="commitRename(s)"
              @keydown.esc.prevent="cancelRename"
            />
          </template>
          <span v-else class="session-title" :title="s.title" @dblclick.stop="startRename(s)">{{ s.title }}</span>
        </div>
        <div class="session-actions" @click.stop>
          <el-tooltip v-if="editingId !== s.id" content="重命名" placement="top">
            <el-button
              class="session-icon-btn"
              type="primary"
              :icon="EditPen"
              circle
              size="small"
              plain
              @click="startRename(s)"
            />
          </el-tooltip>
          <el-tooltip v-else content="确认名称" placement="top">
            <el-button
              class="session-icon-btn"
              type="success"
              :icon="Check"
              circle
              size="small"
              @mousedown.prevent
              @click="commitRename(s)"
            />
          </el-tooltip>
          <el-tooltip v-if="editingId !== s.id" content="删除会话" placement="top">
            <el-button
              class="session-icon-btn"
              type="danger"
              :icon="Delete"
              circle
              size="small"
              plain
              @click="emit('delete-session', s.id)"
            />
          </el-tooltip>
        </div>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";
import type { InputInstance } from "element-plus";
import type { SessionRecord } from "../types";
import { EditPen, Check, Delete } from "@element-plus/icons-vue";

const props = withDefaults(
  defineProps<{
    /** 父组件已按侧栏顺序排好的会话列表 */
    sessions: SessionRecord[];
    activeSessionId: string;
    isGenerating: boolean;
    /** P1：服务端 SQLite 同步状态文案（由 App.vue 传入） */
    serverSyncHint: string;
  }>(),
  {
    sessions: () => [],
    activeSessionId: "",
    isGenerating: false,
    serverSyncHint: ""
  }
);

const emit = defineEmits<{
  "create-session": [];
  "switch-session": [id: string];
  "delete-session": [id: string];
  "rename-session": [payload: { id: string; title: string }];
  "reorder-sessions": [ids: string[]];
  "export-backup": [];
  "import-backup": [file: File];
}>();

const importInputRef = ref<HTMLInputElement | null>(null);
const renameInputRef = ref<InputInstance | null>(null);
const editingId = ref<string | null>(null);
const editingTitle = ref("");
const dragFromIndex = ref<number | null>(null);

function triggerImport() {
  importInputRef.value?.click();
}

function onImportFile(event: Event) {
  const t = event.target as HTMLInputElement;
  const file = t.files?.[0] ?? null;
  if (file) emit("import-backup", file);
  t.value = "";
}

function onRowClick(id: string) {
  if (editingId.value) return;
  emit("switch-session", id);
}

async function startRename(s: SessionRecord) {
  editingId.value = s.id;
  editingTitle.value = s.title || "";
  await nextTick();
  const inst = renameInputRef.value;
  if (inst && typeof inst.focus === "function") {
    inst.focus();
    inst.select?.();
  }
}

function cancelRename() {
  editingId.value = null;
}

function commitRename(s: SessionRecord) {
  if (editingId.value !== s.id) return;
  emit("rename-session", { id: s.id, title: editingTitle.value });
  editingId.value = null;
}

function onDragStart(_event: DragEvent, index: number) {
  dragFromIndex.value = index;
}

function onDrop(toIndex: number) {
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
