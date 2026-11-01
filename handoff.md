# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-11-01 20:38  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項 (v5.6)

1. **實裝「手動自由移動組別排序」功能 (微調按鈕 ⬆️ / ⬇️ ＋ 拖曳排序 Drag-and-Drop)**：
   - 後台左側賽事組別卡片新增：
     - `⬆️`（往上移一組）與 `⬇️`（往下移一組）微調按鈕。
     - 拖曳握把 `⠿`，支援原生 HTML5 拖曳換位（Drag and Drop），可隨意自訂出賽流程順序。
   - 手動調整順序時，系統自動將組別由上而下重新依序編號為第 1 組至第 N 組（`id: 1..N`），並同步更新後端與 LocalStorage 快取。
   - 移除列表渲染時的強制預設覆蓋排序，完整保留使用者的手動調動成果；並保留「⚡ 依賽程標準排序」按鈕供一鍵重設。
2. **實裝「自動辨識今日比賽日期，預設切換出賽組別」功能**：
   - 系統開啟時會自動讀取當天日期（`YYYY-MM-DD` 與 `MM-DD`）：
     - 若當天為賽程日（如 `11/13`），後台日期篩選選單自動鎖定為當天，並自動跳至當天第 1 組（如五年級女生組 100 公尺決賽），同時顯示「📅 今日賽事」提示列。
     - 手機計時前端（`app.js`）亦會自動偵測並切換至當日第 1 組，彈出 Toast 提示「`📅 系統已自動定位今日賽程 (11/13)：第 X 組`」，省去裁判逐一搜尋查找當天賽程的步驟。
     - 支援 `?testDate=2026-11-13` 參數，方便在操場進行離線或事前演練測試。
3. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.6`，更新 `index.html` 腳本引用版本 `app.js?v=5.6`。

---

## 📋 前次完成事項 (v5.5)

1. **實裝「全景時間軸快滑條（Timeline Overview Scrubber）」**：
   - 在終點畫卷判讀工作台加入全局時間軸滑動軌道（`#timelineOverviewBar`），顯示目前起跑時間點、游標時間與最後一位選手完賽時間。
   - 支援「滑桿即時快速導航」、「`⏮ 0s`（跳至起跑）」與「`末位 ⏭`（一鍵跳至最後一位選手）」，裁判可於 1 秒內在 20～40 秒長畫卷中任意穿梭。
   - 微調工具列新增 `[-1s]` 與 `[+1s]` 大步進按鈕，跨越選手間空白秒數更省力。
2. **實裝「拖曳碰壁自動滾動（Edge Auto-Scroll）」**：
   - 當裁判在畫布上拖曳黃色判定游標靠近手機螢幕左/右邊界（50px 臨界區）時，觸發平滑 `requestAnimationFrame` 邊緣自動加速捲動，跟隨手指連續滾動整場畫卷，徹底解決長畫卷卡在螢幕邊界的問題。
3. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.5`，更新 `index.html` 腳本引用版本 `app.js?v=5.5`。

---

## 📋 前次完成事項 (v5.4)

1. **實裝「自動防止螢幕休眠（Screen Wake Lock API）」功能**：
   - **實作原理**：
     - 比賽期間若手機長時間未被碰觸（1～3 分鐘），行動作業系統會自動休眠關閉螢幕，並凍結 JavaScript 執行緒與 Wi-Fi 連線，導致雙機中斷。
     - 透過現代瀏覽器標準 `navigator.wakeLock.request('screen')`（支援 iOS 16.4+ 與 Android Chrome），在進入網頁及使用者第一次點擊時自動向系統申請「螢幕常亮鎖定」，徹底防止螢幕自動變暗或進入休眠。
   - **自動重連與狀態自癒**：
     - 綁定 `visibilitychange` 事件：若使用者切換應用程式或被電話打斷後返回，系統會自動重新取得 WakeLock 螢幕鎖定。
     - 終點選單與起點發令端同步加入「🔆 螢幕防休眠: 🟢 螢幕保持常亮」即時狀態徽章。
2. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.4`，更新 `index.html` 腳本引用版本 `app.js?v=5.4`。

---

## 🚀 目前 Git 狀態

- **分支**：`main`
- **遠端倉庫**：`https://github.com/blueymch-star/profinish-pwa`
- **資安檢查**：無憑證、金鑰或敏感個資外洩，`.gitignore` 運作正常。
