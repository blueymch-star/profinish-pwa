# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-10-22 23:58  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項

1. **修復 GitHub Pages 後台分組名冊載入問題**：
   - 原先 `admin.html` 僅向本地 Node.js (`/api/meet`) 請求資料，在靜態 GitHub Pages 上會回傳 404，導致分組名冊顯示為 0 組。
   - 重構資料載入邏輯：加入多層級自動備援（自訂司令台 IP ➜ 本機伺服器 ➜ 本機 LocalStorage 快取 ➜ 內建靜態 `meet_data.json`）。
   - 現在於純靜態網頁與離線環境下，皆能完整加載並操作 48 組出賽名冊。

2. **新增「🔄 同步報名名冊」功能**：
   - 後台頂部新增一鍵同步按鈕，直接連接大成國小線上報名系統 Google Apps Script 端點 (`action=getSeeding`)。
   - 自動將 240 筆選手報名資料與道次指派寫入目前賽程，並提供「重設為預設 48 組」按鈕。

3. **新增「⚙️ 連線設定」介面**：
   - 頂部連線狀態燈可點擊開啟設定視窗，支援隨時填寫司令台電腦 IP（如 `http://192.168.1.100:8080` 或 Cloudflare Tunnel 網址），實現終點端與後台毫秒級 SSE 即時同步。

4. **修復頁面相對路徑**：
   - 修正頂部「📱 開啟計時畫面」超連結由 `/index.html` 改為相對路徑 `./index.html`，防止在 GitHub Pages 子路徑下出現 404。

5. **決賽名冊同步機制設計與說明**：
   - 確立兩種決賽編排機制：
     - **方案 A（線上同步）**：預賽結束後，報名系統依成績自動篩選前 6 強並依 `4 ➜ 5 ➜ 6 ➜ 3 ➜ 2 ➜ 1` 排定決賽道次，計時系統一鍵抓取。
     - **方案 B（本機離線結算）**：操場斷網時，由計時系統直接依預賽已測成績自動產生決賽第 1 組。

---

## ⚠️ 踩坑與注意事項 (Gotchas)

1. **GitHub Pages 靜態環境無後端 API**：
   - GitHub Pages 無法執行 Node.js API（如 `/api/meet`、`/api/heat-result`）。在純 GitHub Pages 模式下，所有儲存與名冊變更均依賴瀏覽器的 `localStorage`；若需手機與電腦跨裝置即時通訊，請透過區域網路 IP 或 Cloudflare Tunnel 連接本地 `node server.js`。
2. **道次排列方向**：
   - 鏡頭畫面下方固定為第 1 道（內道），上方為第 6 道（外道），與操場視野一致，切勿倒置。
3. **瀏覽器強制快取**：
   - GitHub Pages 更新推送後，若瀏覽器曾載入舊版，需使用 `Ctrl + F5` 或清除 PWA 快取才能載入最新檔案。

---

## 🚀 目前 Git 狀態

- **分支**：`main`
- **最新 Commit**：`051633c` (`fix(admin): enable offline static meet data loading on GitHub Pages and add DCPS registration sync button`)
- **遠端倉庫**：`https://github.com/blueymch-star/profinish-pwa`（已完全同步）
- **資安檢查**：無憑證、金鑰或敏感個資外洩，`.gitignore` 運作正常。

---

## 📌 下一步待辦事項

- [ ] 實裝預賽成績結束後一鍵「依成績產生決賽組別」的自動編組演算法按鈕。
- [ ] 實地到操場進行長距離 Wi-Fi 熱點與終點計時訊號測試。
- [ ] 匯出決賽名冊列印格式（對照大成國小秩序冊格式）。
