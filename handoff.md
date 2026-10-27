# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-10-27 19:49  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項 (v4.9)

1. **修復儲存壓線證明圖後返回「攝影計時」畫面全黑問題**：
   - **問題根因**：
     1. 行動裝置（iOS Safari / Android Chrome）觸發圖檔下載（`<a download>`）或跳出系統存檔預覽時，會自動暫停 `<video id="cameraVideo">` 播放或中斷/靜音相機 `MediaStreamTrack`（`readyState === 'ended'` 或 `muted`）。
     2. 原先 `rawSlitCanvas` 雙緩衝加上巨幅 `expCanvas`（最高達 14000px 寬）未於匯出後立即釋放 GPU 記憶體，且 `#reviewDrawer` 使用全畫面 `backdrop-blur-2xl`，觸發行動版 WebKit GPU 貼圖記憶體上限（Total canvas memory limit），導致硬體相機解碼畫面被系統強制卸載變黑。
   - **修正措施**：
     - **移除雙倍 Canvas 記憶體開銷**：改以輕量 DOM 疊加層（`#laneMarkersOverlay`）呈現判讀畫卷上的道次壓線標記，不再建立第二張全尺寸 `rawSlitCanvas`，使 `slitCanvas` 本身保持純淨且記憶體減半。
     - **匯出後立即釋放 GPU 畫布記憶體**：將證明圖匯出畫布上限控制在安全的 `4096×720` 內，並在 `toBlob()` 完成瞬間執行 `expCanvas.width = 1; expCanvas.height = 1;` 立即歸還 GPU 記憶體；同時移除 `#reviewDrawer` 的 `backdrop-blur-2xl`。
     - **實裝相機自動喚醒與凍結看門狗 (`ensureCameraAlive()`)**：於點擊「⬇ 回攝影」收合抽屜、觸發檔案下載後、以及 `visibilitychange` / `focus` / `pageshow` 時自動檢查相機狀態；若偵測到 `<video>` 暫停、軌道中斷或畫面時間軸 `video.currentTime` 凍結未推進，立即自動重啟相機串流。
2. **實裝「自動截取第一位選手前 1 秒 ～ 最後一位選手後 0.5 秒」與「8 倍水平放大特寫」**：
   - 自動找出當前組別已判定成績的最早時間 `firstRunnerTime` 與最晚時間 `lastRunnerTime`，截取範圍固定為 `[Math.max(0, firstRunnerTime - 1.0), lastRunnerTime + 0.5]`，並水平放大 8 倍繪製，搭配 1:1 原生清晰時間尺與道次名次旗標。
3. **Service Worker 與版本升級**：
   - 升級至 `profinish-v4.9`，更新 `index.html` 腳本引用版本 `app.js?v=4.9`。

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
