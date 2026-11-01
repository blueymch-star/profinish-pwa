# ProFinish 電子計時系統 · 交接工作日誌 (handoff.md)

**更新時間**：2026-11-01 22:30  
**專案網址**：[https://blueymch-star.github.io/profinish-pwa/](https://blueymch-star.github.io/profinish-pwa/)  
**後台管理**：[https://blueymch-star.github.io/profinish-pwa/admin.html](https://blueymch-star.github.io/profinish-pwa/admin.html)  
**線上報名對應系統**：[https://blueymch-star.github.io/DCPS-sports-registration/](https://blueymch-star.github.io/DCPS-sports-registration/)  

---

## 📋 本次完成事項 (v5.9 — 修正起點端 A 徽章凍結、發令瞬時發射防阻擋、終點握手時機與多 Broker 容錯)

1. **修正起點端「A: 未連線」徽章凍結問題**：
   - 起點發令端在連線成功（`setupDataChannel`）、收到 PTP Pong（`handleIncomingPeerData`）、路由偵測完成（`detectRouteType`）、切換角色（`switchRole`）與斷線重連時，全面補上 `this.updateDualPathBadges()` 呼叫。
   - 解決起點端底層已建立直連，但 UI 仍停留在靜態預設「A: 未連線」的介面不同步問題。
2. **解除 `flushPendingStartTrigger` 發射阻擋門檻**：
   - 移除 `if (sinceOpen < 2000 && this.pathBStatus !== 'ready') return false;` 之暫緩阻擋機制。
   - 若 PTP 尚未收斂（樣本 < 3），依然**立即透過 Path A 與 Path B 雙發**帶有動態 `transitDelay` 補償之起跑封包，確保發令槍按下瞬間訊號 0ms 立即上線，絕不因為校時等候而吞掉起跑訊號。
3. **終點主機 DataChannel `open` 握手時機修正**：
   - 在 `setupDataChannel(conn, 'host')` 中加入 `conn.open` 檢查與 `conn.on('open')` 監聽，確保 WebRTC SCTP 通道正式開啟後才發送初始 `arm_status` 與 `hostSession`，避免連線建立瞬間握手封包遺失導致起點機 `lastKnownHostSession` 為 null。
4. **起點發令按鈕 500ms 防抖動**：
   - 在 `senderSendTrigger` 加入 500ms 防抖機制，避免平板觸控時 `ontouchstart` 與 `onclick` 300ms 內連續兩次觸發導致封包重複與 ACK 覆蓋。
5. **Path B 雲端中繼多 Broker 自動輪替 (EMQX + HiveMQ)**：
   - `CloudRelayClient` 加入輪替伺服器清單（`broker.emqx.io:8084` 與 `broker.hivemq.com:8884`），若電信業者熱點阻擋或特定 Broker 離線，自動切換至備援 Broker 重連。
6. **版本升級與快取更新**：
   - 升級至 `profinish-v5.9`（`sw.js` 快取名稱 `profinish-v5.9`，`index.html` 引動 `app.js?v=5.9`）。

---

## 📋 前次完成事項 (v5.8 — 雙路徑備援 Path B、4G TURN 穿透與連線診斷面板)

1. **實裝第四項：雙路徑備援發射與去重 (Path A WebRTC + Path B Cloud/Server Relay)**：
   - 實作原生輕量化 `CloudRelayClient`（MQTT 3.1.1 over WSS），無需任何第三方套件，透過標準 WebSocket 安全通訊協定即時轉送。
   - 同時支援本機 `server.js` 之 `/api/relay-signal` POST 廣播端點，有筆電或伺服器時透過區網 SSE 進行本地中繼。
   - 發令鳴槍（`senderSendTrigger`）與歸零測試（`triggerZeroTest`）時，起點端**同時向路徑 A（WebRTC DataChannel 直連/穿透）與路徑 B（中繼備援通道）雙發封包**。
   - 終點端雙路徑同時監聽，以 `triggerId` 瞬時去重（先到的觸發計時並標註來源路徑，重複到的自動略過），並同步於兩條路徑回傳 `race_start_ack`。
2. **實裝第五項：4G TURN 穿透配置 (解決電信對稱型 NAT 連線失敗)**：
   - 在 WebRTC `getIceServersConfig()` 中整合 **Google STUN**、**Cloudflare STUN** 以及 **Metered OpenRelay 免費 TURN 伺服器**（UDP 80/443、TCP 443）。
   - 解決 iPhone 熱點或校園網路遇到對稱型 NAT（Symmetric CGNAT）無法 P2P 打洞的致命問題，自動退回 TURN 中繼，確保 100% 成功連線。
3. **實裝第五項：雙路徑即時狀態徽章與連線診斷面板 (Connection Diagnostics UI)**：
   - 終點主機與起點發令端介面同步新增雙路徑狀態藥丸徽章：
     - **路徑 A**：`[A: 區網直連]` (host) / `[A: 4G穿透]` (srflx) / `[A: TURN中繼]` (relay) / `[A: 未連線]`
     - **路徑 B**：`[B: 備援就緒]` / `[B: 連線中]` / `[B: 備援離線]`
   - 新增點擊式 **「🩺 連線診斷」** 彈出面板：
     - 即時顯示本機角色、房間配對碼、路徑 A ICE 狀態與選定路由、往返延遲 (RTT)、PTP 時鐘偏差 (ms) 與樣本數、路徑 B 狀態與中繼模式、最後一次送達路徑。
     - 具備 **「⚡ 測試訊號脈衝 (Test Pulse)」** 按鈕：起跑前裁判可一鍵發送非鳴槍雙路徑測試脈衝，對端發出蜂鳴與震動並回傳量測兩條路徑的即時 RTT。
     - 具備 **「🔄 重新整理連線」** 按鈕：一鍵重設雙路徑協商與 PTP 校時。
4. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.8`，更新 `index.html` 腳本引用版本 `app.js?v=5.8`。

---

## 📋 前次完成事項 (v5.7)

1. **角色隔離與防止搶占終點主機 ID (P1 修正)**：
   - 記憶並還原裝置上次使用的角色（`profinish_role`），只有「終點機 (`finish`)」角色才會註冊 `profinish-heat-XXXX` 房間 ID。
   - 切換為「起點發令端 (`start`)」時立即銷毀本機的終點主機 Peer，並關閉相機串流（`stopCameraStream()`），避免起點手機搶走終點 ID 或背景跑 60fps 攝影造成發熱降頻。
2. **專屬持久化配對碼 (P2 修正)**：
   - 移除全球共用的固定預設碼 `2026`，改為每台終點機首次啟動時自動產生專屬 4 位數配對碼並存入 `localStorage`（`profinish_room_code`）；起點機則自動帶入上次配對的目標代碼（`profinish_target_room`）。
3. **放寬看門狗與 ICE 斷線寬限期 (P4 修正)**：
   - PTP Pong 看門狗逾時門檻由 `2.2s` 放寬至 `6.0s`，避免終點機高負載或 iPhone 熱點省電抖動時誤判並自行切斷連線。
   - WebRTC ICE `disconnected` 狀態給予 `8.0s` 自癒寬限期，符合 WebRTC 暫時斷線自動恢復機制。
4. **重連邏輯修復與指數退避 (P5 修正)**：
   - 修正 `senderPeer.disconnected` 時先 `reconnect()` 又立刻被往下 `destroy()` 覆蓋的邏輯錯誤。
   - 加入 `_pendingConn` 5 秒握手鎖定與指數退避重連（`300ms → 600ms → 1.2s ... 上限 8s`），防止多條連線同時協商互相干擾或被公用信令伺服器限流。
5. **起跑訊號絕對時刻解耦 (`hostT0`) 與 15 秒可靠重送迴圈**：
   - 起點送出已換算為終點時鐘基準的鳴槍絕對時刻 `hostT0 = triggerPerfNow + clockOffset`（搭配 `clockEpochId` session 驗證），並每 250ms 自動重送直到收到 `race_start_ack`（最長 15 秒），即使封包在熱點抖動下晚到也完全不影響計時準確度。
   - 自動偵測並於連線徽章顯示實際傳輸路徑（`區網直連` / `經4G打洞` / `TURN中繼`）。
6. **電腦後台 SSE 自動重連與心跳 (P6 修正)**：
   - `server.js` 每 15 秒發送 SSE keep-alive 心跳註解；前端 `EventSource` 斷線後以指數退避自動重連並同步最新賽程。
7. **Service Worker 與版本升級**：
   - 升級至 `profinish-v5.7`，更新 `index.html` 腳本引用版本 `app.js?v=5.7`。

---

## 📋 前次完成事項 (v5.6)

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
