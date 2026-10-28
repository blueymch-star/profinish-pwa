# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-10-28 13:42  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項 (v5.3)

1. **實裝「720p 自動解鎖 60 FPS 模式」**：
   - **實作原理**：
     - 在 iOS Safari（AVCaptureSession）與 Android Chrome 的 WebRTC 驅動中，1080p（Full HD）硬體管線被預設鎖定在 30 FPS；只有在解析度設定為 720p（`1280×720`）時，系統底層才會放行 60 FPS 高幀率相機預設設定。
   - **修正內容**：
     - 在 `startCameraStream()` 中，當目標幀率 $\ge 60$ FPS 時，自動將視訊解析度限制在 720p（`width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }`），並透過 `track.applyConstraints()` 主動向底層鏡頭請求 60 FPS 模式。
     - 720p 的垂直高度 720 像素完整對應終點線 6 個跑道（每道 120 像素高），在維持高清晰度的同時將資料頻寬減半，讓支援 60 FPS 的 iPhone 與 Android 在戶外陽光下順利解鎖 60 FPS。
     - 更新選單與左上角 HUD 狀態顯示：「720p 高速模式 / 60 FPS」。
2. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.3`，更新 `index.html` 腳本引用版本 `app.js?v=5.3`。

---

## 📋 前次完成事項 (v5.2)

1. **修復終點判讀沒有出現拍攝畫面問題 (`v5.1` 迴歸修復)**：
   - **問題根因**：
     1. `v5.1` 在 `startSlitScanLoop()` 內將 `const hasLiveVideo` 宣告在 `if (this.raceState === 'running')` 區塊內部，卻在區塊外部結尾處讀取 `if (hasLiveVideo && ...)`，導致網頁載入（`raceState === 'idle'`）執行第一幀時拋出 `ReferenceError: hasLiveVideo is not defined`，使狹縫掃描迴圈在啟動瞬間中斷！
     2. `startCameraStream()` 對 `getUserMedia` 傳入硬性 `max: targetFps, min: 30` 參數，在部分不支援強制幀率上下限的行動裝置鏡頭上會觸發 `OverconstrainedError`。
   - **修正措施**：
     - 重構 `startSlitScanLoop()` 為獨立的 `this._captureSliceFn()`，由永不中斷的 `requestAnimationFrame` 主迴圈搭配 `video.requestVideoFrameCallback` 雙軌驅動（並具備 5ms 防重覆取樣保護），即使相機重啟或切換鏡頭也絕不中斷。
     - `startCameraStream()` 改用軟性 `frameRate: { ideal: targetFps }` 並加上 `try / catch` 自動降級機制，確保所有手機鏡頭皆能順利開啟並錄製狹縫畫面。
2. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.2`，更新 `index.html` 腳本引用版本 `app.js?v=5.2`。

---

## 📋 前次完成事項 (v5.0)

1. **修復儲存壓線證明圖後，終點機與起點機 WebRTC 連線中斷問題**：
   - **問題根因**：
     1. PeerJS (`peerjs@1.5.4`) 內部預設在 `window` 註冊了 `beforeunload` / `unload` 事件監聽並直接呼叫 `peer.destroy()`；當點擊 `<a href="blob:..." download>` 觸發證明圖存檔時，行動與桌面瀏覽器會在下載管理器攔截前先觸發 `beforeunload` / `pagehide`，導致 PeerJS 主動摧毀雙機 WebRTC 連線！
     2. `exportPhotoFinishProof()` 在 GitHub Pages 純前端環境下仍同步執行 `expCanvas.toDataURL('image/jpeg', 0.80)`，造成主執行緒在存檔瞬間阻塞，使行動系統彈出存檔對話框時 WebRTC 心跳超時進入「假連線（Half-open Zombie DataChannel）」狀態。
   - **修正措施**：
     - 在 `bindPeerKeepAliveEvents()` 註冊 Capture 階段 (`useCapture = true`) 的 `beforeunload`、`unload`、`pagehide` 攔截器，當 `_isDownloadingBlob === true` 時執行 `e.stopImmediatePropagation()`，徹底阻止 PeerJS 在下載檔案時自我銷毀連線。
     - 於 `exportPhotoFinishProof()` 僅在有連接本地後台伺服器時才編碼 `proofDataUrl`，消除 GitHub Pages 下載時的同步阻塞。
     - 新增 `isDataChannelReady(conn)`、終點端 `ensureFinishHostPeerAlive()` 1.5 秒看門狗與起點端 `lastPongTime` (2.2 秒無 Pong 自動閃電重連)，即使系統原生存檔視窗短暫凍結背景分頁也能在數百毫秒內無縫自癒。
2. **修復起點端按下手動計時後，終點端碼表無法馬上開始計時問題**：
   - **問題根因**：
     1. 終點機儲存完上一組證明圖後若仍停留在 `#reviewDrawer`（判讀與檢錄抽屜），下一組起點鳴槍時抽屜遮住了主畫面碼表，且 `handleStartTrigger()` 先同步重繪整張畫布網格才設定 `this.raceState = 'running'`。
     2. 若先前誤按過「一鍵將目前紅線設為 00:00.000」導致 `localStorage` 中的 `profinish_zero_offset` 存有大額正偏移（例如數秒），會使 `effectiveStartTime` 被推向未來時間（`effectiveStartTime > performance.now()`），導致碼表在起跑後數秒內一直卡在 `00:00.00`！
     3. 起點端原本只發送單一 `race_start` 封包，若逢存檔後瞬間網路抖動或重連中則訊號遺失。
   - **修正措施**：
     - `handleStartTrigger()` 收到起跑訊號瞬間自動收合 `#reviewDrawer` / `#toolsDrawer`，優先將 `this.raceState = 'running'` 與 `#liveClockDisplay` 立即跳轉為 `00:00.01`，並強制限制 `effectiveStartTime <= performance.now() - 2` 與 `zeroOffsetMs` 安全範圍 `[-150ms, +150ms]`。
     - `senderSendTrigger()` 實裝 3 連發叢發傳送（`0ms`、`35ms`、`100ms`）搭配 `race_start_ack` 確認與動態 `transitDelay` 經過時間補償；若重連中按下鳴槍則自動排入 `pendingStartTrigger`，於連線接通瞬間自動補發並扣除延遲。
3. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.0`，更新 `index.html` 腳本引用版本 `app.js?v=5.0`。

---

## ⚠️ 踩坑與注意事項 (Gotchas)

1. **狹縫掃描放大倍率與字體分離**：
   - 繪製判定線與時間字體切勿直接寫入底層狹縫切片畫布，必須維持 `rawSlitCanvas` 與疊加層分離，才能在縮放或匯出時保持字體與髮絲線 1:1 清晰不變形。
2. **右側邊界標籤翻轉**：
   - 最後一位選手若接近畫布右緣，名牌標籤必須根據 `pinX + badgeW > expCanvas.width` 自動往左側翻轉，避免右側文字被裁切。
3. **HTML5 Canvas 尺寸重設會清空畫面**：
   - 任何時候只要對 `<canvas>` 重新賦值 `canvas.width` 或 `canvas.height`，瀏覽器會立即清空畫布上所有像素。若畫布已有錄製切片，務必先透過暫存 Canvas 備份影像再還原。
4. **行動裝置存檔視窗行為 (Mobile Download / Share Sheet)**：
   - 在 iOS / Android 上觸發檔案下載時，系統對話框會讓網頁短暫進入背景狀態。必須透過 `visibilitychange` 與背景自動重連機制維持 WebRTC 連線，切勿在下載時呼叫同步阻塞式 `alert()`。
5. **道次排列方向**：
   - 鏡頭畫面下方固定為第 1 道（內道），上方為第 6 道（外道），與操場視野一致，切勿倒置。

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
