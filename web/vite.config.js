import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 这里配置了开发代理，前端请求 /api 会自动转发到 Express
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
});
