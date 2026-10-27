# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-10-27 18:56  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項 (v4.8)

1. **實裝「自動截取第一位選手前 1 秒 ～ 最後一位選手後 0.5 秒」與「8 倍水平放大特寫」**：
   - **問題根因**：
     狹縫攝影時間軸在 1x 匯出時，選手壓線過程約 0.08~0.15 秒僅佔少數像素，導致整張匯出圖人物過扁成細線無法辨識軀幹胸部壓線位置；且若直接對帶有文字標記的 Canvas 放大，會導致文字與判定線被拉寬 8 倍模糊變形。
   - **修正措施**：
     - **純影像雙緩衝機制 (`rawSlitCanvas`)**：新增離屏畫布記錄純淨無字體之狹縫相機切片，確保 8 倍放大時僅拉伸跑道與選手影像。
     - **自動計算時間裁切區間**：判讀完畢後，自動找出當前組別已判定成績的最早時間 `firstRunnerTime` 與最晚時間 `lastRunnerTime`，截取範圍固定為 `[Math.max(0, firstRunnerTime - 1.0), lastRunnerTime + 0.5]`，自動排除起跑前冗長空白區。
     - **水平放大 8 倍 (`TARGET_ZOOM_X = 8.0`)**：開啟雙線性平滑濾鏡（`imageSmoothingQuality = 'high'`），人物寬度放大 8 倍，胸口壓線與號碼衣清晰可辨。
     - **iOS Safari 16MP 畫布安全防護**：自動防護寬度上限（最高 14,000px / 15.5 MP），防止行動裝置瀏覽器記憶體崩潰。
     - **1:1 原生清晰文字與標記層疊**：放大底圖後，以 1:1 比例疊加頂部 0.1s 精密時間尺、左緣 1~6 道次名牌、2px 垂直判定線與名次標籤（靠右邊界時自動向左翻轉不被切除），以及底部 2 列×3 欄名次總覽。
     - **判讀殘影重繪防護**：修正 `redrawSlitCanvasWithOverlays()`，裁判重選道次或按「清除」時舊線條立即消失，不再留下重疊殘影。
2. **Service Worker 與版本升級**：
   - 升級至 `profinish-v4.8`，更新 `index.html` 腳本引用版本 `app.js?v=4.8`。

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
