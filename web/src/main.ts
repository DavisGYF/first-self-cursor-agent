import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

// Element Plus 样式由 unplugin-vue-components + ElementPlusResolver 按组件注入；
// 此处仅补充 Message / MessageBox 等指令式 API 的全局样式（若使用）
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";

createApp(App).mount("#app");
