import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

// 开发代理：前端请求 /api 转发到 Express；Element Plus 按需引入 + API 自动导入 + TS 声明
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue"],
      resolvers: [ElementPlusResolver()],
      dts: "src/auto-imports.d.ts"
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: "src/components.d.ts"
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
});
