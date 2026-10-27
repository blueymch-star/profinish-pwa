# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-10-27 09:38  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項

1. **修復儲存壓線證明圖時雙機 WebRTC 斷線問題**：
   - **問題根因**：原先儲存證明圖時，在主執行緒連續同步編碼巨幅 PNG、呼叫阻塞式 `alert()`、上傳龐大 Base64 塞爆熱點頻寬，且 `a.click()` 後立即釋放 ObjectURL，導致手機彈出系統下載視窗時主執行緒與 WebRTC/PeerJS 心跳凍結而中斷連線。
   - **重構非阻塞圖檔匯出**：改用非同步單次 `expCanvas.toBlob()`，並透過 `triggerSafeBlobDownload` 安全延遲 15 秒釋放 ObjectURL，防止瀏覽器誤判導航中斷。
   - **全面移除阻塞式對話框**：將所有 `alert()` 替換為懸浮非同步 `showToast()`，不再凍結 JavaScript 事件迴圈與 PTP 校時心跳。
   - **輕量化後台傳輸**：回傳電腦後台的證明圖改為非同步輕量化 JPEG（品質 0.82），且不再存入 LocalStorage，避免配額耗盡與頻寬塞車。
   - **雙機連線自癒與自動重連**：
     - 終點端：新增 `peer.on('disconnected')` 自動重連，且在 P2P 通道保持開啟時不受信令伺服器波動影響。
     - 起跑端：連線中斷時自動顯示「🔄 訊號保持/重連中...」並每 1.5 秒自動重連回終點機。
     - 全域監聽 `visibilitychange`、`focus` 與 `online` 事件，當手機關閉存檔視窗回到頁面時秒級恢復通訊。
   - **Service Worker 快取升級**：升級至 `profinish-v4.6`，並自動略過跨網域（PeerJS 信令）與非同源請求。

2. **前期重要架構維持與相容**：
   - GitHub Pages 靜態環境多層級備援載入與 48 組出賽名冊支援。
   - 大成國小線上報名名冊同步功能（GAS 端點）與道次設定維持相容。

---

## ⚠️ 踩坑與注意事項 (Gotchas)

1. **行動裝置存檔視窗行為 (Mobile Download / Share Sheet)**：
   - 在 iOS / Android 上觸發檔案下載時，系統對話框會讓網頁短暫進入非使用中狀態。必須透過 `visibilitychange` 與背景自動重連機制維持 WebRTC 連線，切勿在下載時呼叫任何同步阻塞式 `alert()`。
2. **GitHub Pages 靜態環境無後端 API**：
   - GitHub Pages 無法執行 Node.js API（如 `/api/meet`、`/api/heat-result`）。在純 GitHub Pages 模式下，所有儲存與名冊變更均依賴瀏覽器的 `localStorage`；若需手機與電腦跨裝置即時通訊，請透過區域網路 IP 或 Cloudflare Tunnel 連接本地 `node server.js`。
3. **道次排列方向**：
   - 鏡頭畫面下方固定為第 1 道（內道），上方為第 6 道（外道），與操場視野一致，切勿倒置。
4. **瀏覽器強制快取**：
   - GitHub Pages 更新推送後，若瀏覽器曾載入舊版，需使用 `Ctrl + F5` 或清除 PWA 快取才能載入最新檔案。

---

## 🚀 目前 Git 狀態

- **分支**：`main`
- **遠端倉庫**：`https://github.com/blueymch-star/profinish-pwa`
- **資安檢查**：無憑證、金鑰或敏感個資外洩，`.gitignore` 運作正常。

---

## 📌 下一步待辦事項

- [ ] 實裝預賽成績結束後一鍵「依成績產生決賽組別」的自動編組演算法按鈕。
- [ ] 實地到操場進行長距離 Wi-Fi 熱點與終點計時訊號測試。
- [ ] 匯出決賽名冊列印格式（對照大成國小秩序冊格式）。
