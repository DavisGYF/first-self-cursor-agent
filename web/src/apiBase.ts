// 与 App.vue 原逻辑一致：开发直连 3000，生产同域
export function getApiBase(): string {
  return import.meta.env.DEV ? "http://localhost:3000" : "";
}
