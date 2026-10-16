// 刻意不快取：網站更新與行情都直接走網路。
// This worker exists only so phones can offer "add to home screen". It has no fetch handler,
// so every request goes to the network exactly as without it, and no market data is stored.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
