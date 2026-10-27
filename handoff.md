# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-10-27 18:18  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項

1. **修復「終點畫卷判讀」黑畫面問題**：
   - **問題根因**：
     1. 原先 `cameraVideo.onloadedmetadata` 於 `await video.play()` 之後才綁定，導致相機啟動時未執行 `initSlitCanvasDimensions()`，`<canvas id="slitCanvas">` 在比賽期間維持預設 `300×150`。當比賽停止彈出判讀抽屜 (`toggleReviewDrawer()`) 時才重設 `canvas.width = 1600+`，觸發 HTML5 Canvas 尺寸變更自動清空像素機制，將已錄製的壓線畫面洗成全黑。
     2. 掃描期間執行 `canvasViewport.scrollLeft = canvas.width` 將捲軸推至最右側未繪製的黑底空白區，而非跟隨實際寫入位置 `this.slitCurrentX`。
   - **修正措施**：
     - 於 `init()` 與相機啟動時立即初始化畫布尺寸，並在 `index.html` 預設 `width="1600" height="720"`。
     - 在 `initSlitCanvasDimensions()` 與 `startSlitScanLoop()` 中加入像素保護機制：若已有錄製切片 (`this.sliceIndex.length > 0`) 而需調整畫布尺寸時，先備份至暫存 Canvas 再還原，絕不抹除已錄製影像。
     - 掃描時捲軸改為跟隨當前寫入位置 `this.slitCurrentX`；停止計時展開判讀抽屜時，自動於左側疊加 1～6 道彩色道次名牌 (`drawLaneBadgesOverlay()`) 並將游標與視角自動定位至已錄製區間。
     - 加入無相機環境模擬切片備援，確保在任何裝置預覽測試時畫卷皆清晰可見。

2. **修復儲存壓線證明圖時雙機 WebRTC 斷線問題**：
   - **重構非阻塞圖檔匯出**：改用非同步單次 `expCanvas.toBlob()`，並透過 `triggerSafeBlobDownload` 延遲 15 秒釋放 ObjectURL，防止瀏覽器中斷下載或誤觸頁面導航。
   - **全面移除阻塞式對話框**：將阻斷主執行緒的 `alert()` 替換為懸浮非同步 `showToast()`，不再凍結 JavaScript 事件迴圈與 PTP 校時心跳。
   - **輕量化後台傳輸**：回傳電腦後台的證明圖改為非同步輕量化 JPEG（品質 0.82），且不再將 Base64 巨幅圖檔存入 LocalStorage。
   - **雙機連線自癒與自動重連**：終點端新增 `peer.on('disconnected')` 自動重連；起跑端新增斷線自動重連排程 (`scheduleSenderReconnect`)；全域監聽 `visibilitychange`、`focus` 與 `online` 事件。
   - **Service Worker 快取升級**：升級至 `profinish-v4.7`（`index.html` 腳本同步加上 `?v=4.7`），並自動略過跨網域（PeerJS 信令）與非同源請求。

---

## ⚠️ 踩坑與注意事項 (Gotchas)

1. **HTML5 Canvas 尺寸重設會清空畫面**：
   - 任何時候只要對 `<canvas>` 重新賦值 `canvas.width` 或 `canvas.height`，瀏覽器會立即清空畫布上所有像素。若畫布已有錄製切片，務必先透過暫存 Canvas 備份影像再還原。
2. **行動裝置存檔視窗行為 (Mobile Download / Share Sheet)**：
   - 在 iOS / Android 上觸發檔案下載時，系統對話框會讓網頁短暫進入背景狀態。必須透過 `visibilitychange` 與背景自動重連機制維持 WebRTC 連線，切勿在下載時呼叫同步阻塞式 `alert()`。
3. **GitHub Pages 靜態環境無後端 API**：
   - GitHub Pages 無法執行 Node.js API（如 `/api/meet`、`/api/heat-result`）。在純 GitHub Pages 模式下，所有儲存與名冊變更均依賴瀏覽器的 `localStorage`；若需手機與電腦跨裝置即時通訊，請透過區域網路 IP 或 Cloudflare Tunnel 連接本地 `node server.js`。
4. **道次排列方向**：
   - 鏡頭畫面下方固定為第 1 道（內道），上方為第 6 道（外道），與操場視野一致，切勿倒置。
5. **瀏覽器強制快取**：
   - GitHub Pages 更新推送後，若瀏覽器曾載入舊版，需重新整理或清除 PWA 快取以載入最新 `v4.7` 版本。

---

## 🚀 目前 Git 狀態

- **分支**：`main`
- **遠端倉庫**：`https://github.com/blueymch-star/profinish-pwa`（已完全同步）
- **資安檢查**：無憑證、金鑰或敏感個資外洩，`.gitignore` 運作正常。

---

## 📌 下一步待辦事項

- [ ] 實裝預賽成績結束後一鍵「依成績產生決賽組別」的自動編組演算法按鈕。
- [ ] 實地到操場進行長距離 Wi-Fi 熱點與終點計時訊號測試。
- [ ] 匯出決賽名冊列印格式（對照大成國小秩序冊格式）。
