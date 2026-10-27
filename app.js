/**
 * ProFinish PWA - iPhone 16 Pro 校園田徑終點攝影電子計時系統 (v2.0)
 * 核心引擎整合：
 * 1. SlitScanCameraEngine (iOS requestVideoFrameCallback 高精準狹縫掃描與時間畫卷)
 * 2. PeerSyncEngine (4 位數代碼 WebRTC P2P + PTP-Lite 雙向晶振微秒校準)
 * 3. AudioTriggerEngine (Web Audio 槍聲/哨音瞬態偵測、自動發令員與 IAAF 歸零測試)
 * 4. SchoolMeetStore (60m/100m/200m 賽事管理、一鍵道次判讀、官方證明圖與 CSV 匯出)
 */

class ProFinishApp {
  constructor() {
    // Current role: 'finish' (終點攝影主機) or 'start' (起跑發送器)
    this.role = 'finish';

    // Race & Meet Store State
    this.currentDistance = 100; // 60, 100, 200
    this.currentHeat = 1;
    this.isArmed = true; // Ready for start trigger
    this.raceState = 'idle'; // 'idle', 'running', 'finished'
    this.raceStartTime = 0; // Monotonic performance.now() or synchronized epoch
    this.heatData = {}; // Store results by heat: { [heatId]: { lanes: [...], slices: [...] } }
    
    // Single-phone acoustic delay compensation settings
    this.enableSoundComp = true;
    this.temperature = 25; // Celsius

    // Slit-scan camera configuration
    this.slitXRatio = 0.5; // Default 50% (screen center)
    this.sliceWidth = 2; // px per slice (fine, crisp temporal resolution)
    this.autoDelaySeconds = 0; // Delay before starting slice writes
    this.canvasZoom = 1.0;
    this.currentCursorPixelX = 0;
    this.cameraStream = null;
    this.selectedCameraId = '';
    this.torchEnabled = false;
    this.zeroOffsetMs = parseFloat(localStorage.getItem('profinish_zero_offset') || '0');

    // Time Slice Data for current heat
    // Array of: { x: pixelOffset, timeSec: relativeSeconds }
    this.sliceIndex = [];
    this.currentCursorTimeSec = 0;

    // PeerJS & PTP-Lite Sync State
    this.roomCode = '2026';
    this.peer = null;
    this.senderPeer = null;
    this.peerConnection = null;
    this.shouldStayConnected = false;
    this.targetRoomCode = '';
    this.reconnectTimer = null;
    this.ptpSamples = []; // Array of { rtt, offset }
    this.clockOffset = 0; // StartSender time + clockOffset = FinishHost time
    this.meanRtt = 0;
    this.ptpTimer = null;

    // Web Audio State
    this.audioCtx = null;
    this.audioAnalyser = null;
    this.audioStream = null;
    this.isAudioListening = false;
    this.audioThreshold = 75; // percentage
    this.audioAnimFrame = null;
    this.lastAudioTriggerTime = 0;
    this.starterSoundType = 'gunshot'; // 'gunshot' | 'beep'
    this.orderedHeatKeys = [];

    // DOM Element References
    this.dom = {};
  }

  /* ========================================================================== */
  /* INITIALIZATION                                                             */
  /* ========================================================================== */

  init() {
    this.cacheDom();
    this.initDefaultHeatData(this.currentHeat);
    this.setDistance(this.currentDistance);
    this.renderLanesTable();
    this.updateZeroOffsetDisplay();

    // Start Live Clock Ticker
    this.startClockTicker();

    // Initialize Slit-Scan Canvas Dimensions & Capture Loop immediately
    this.initSlitCanvasDimensions();
    this.startSlitScanLoop();

    // Initialize Camera for Finish Host
    this.initCamera();

    // Initialize PeerJS for P2P Wireless Sync
    this.initFinishHostPeer();
    this.bindPeerKeepAliveEvents();

    // Attach Event Listeners for Touch/Scrubbing
    this.bindCanvasScrubberEvents();

    // Connect to PC Backend Admin Server for Roster & Results Sync
    this.initBackendSync();

    // Register Service Worker for Offline PWA execution
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });
    }

    // iOS Safari Web Audio Unlock on first interaction
    const unlockAudio = () => {
      this.initAudioContext();
    };
    ['touchstart', 'touchend', 'click'].forEach(evt => {
      document.addEventListener(evt, unlockAudio, { once: true, passive: true });
    });

    console.log('ProFinish PWA v2.0 Initialized successfully.');
  }

  cacheDom() {
    this.dom = {
      btnModeFinish: document.getElementById('btnModeFinish'),
      btnModeStart: document.getElementById('btnModeStart'),
      finishHostView: document.getElementById('finishHostView'),
      startSenderView: document.getElementById('startSenderView'),
      syncBadge: document.getElementById('syncBadge'),
      syncDot: document.getElementById('syncDot'),
      syncText: document.getElementById('syncText'),
      senderSyncBadge: document.getElementById('senderSyncBadge'),
      senderHostArmBadge: document.getElementById('senderHostArmBadge'),
      liveClockDisplay: document.getElementById('liveClockDisplay'),
      armBtnText: document.getElementById('armBtnText'),
      btnArmSystem: document.getElementById('btnArmSystem'),
      btnManualTrigger: document.getElementById('btnManualTrigger'),
      cameraVideo: document.getElementById('cameraVideo'),
      cameraSelect: document.getElementById('cameraSelect'),
      slitGuideLine: document.getElementById('slitGuideLine'),
      slitRange: document.getElementById('slitRange'),
      slitPosLabel: document.getElementById('slitPosLabel'),
      slitCanvas: document.getElementById('slitCanvas'),
      canvasViewport: document.getElementById('canvasViewport'),
      canvasEmptyPrompt: document.getElementById('canvasEmptyPrompt'),
      scrubberCursor: document.getElementById('scrubberCursor'),
      cursorTimeDisplay: document.getElementById('cursorTimeDisplay'),
      officialRoundedTime: document.getElementById('officialRoundedTime'),
      scanStatusBadge: document.getElementById('scanStatusBadge'),
      zoomLevelDisplay: document.getElementById('zoomLevelDisplay'),
      lanesTableBody: document.getElementById('lanesTableBody'),
      assignedCountBadge: document.getElementById('assignedCountBadge'),
      selectHeat: document.getElementById('selectHeat'),
      heatSelect: document.getElementById('selectHeat'),
      reviewSelectHeat: document.getElementById('reviewSelectHeat'),
      senderSelectHeat: document.getElementById('senderSelectHeat'),
      drawerRosterList: document.getElementById('drawerRosterList'),
      senderRosterList: document.getElementById('senderRosterList'),
      myRoomCodeDisplay: document.getElementById('myRoomCodeDisplay'),
      inputRoomCode: document.getElementById('inputRoomCode'),
      ptpRttVal: document.getElementById('ptpRttVal'),
      ptpOffsetVal: document.getElementById('ptpOffsetVal'),
      ptpSyncRating: document.getElementById('ptpSyncRating'),
      btnConnectHost: document.getElementById('btnConnectHost'),
      audioLevelBar: document.getElementById('audioLevelBar'),
      audioLevelLabel: document.getElementById('audioLevelLabel'),
      audioThresholdMarker: document.getElementById('audioThresholdMarker'),
      audioThresholdRange: document.getElementById('audioThresholdRange'),
      audioThresholdVal: document.getElementById('audioThresholdVal'),
      btnToggleAudioListen: document.getElementById('btnToggleAudioListen'),
      zeroTestFlashOverlay: document.getElementById('zeroTestFlashOverlay'),
      zeroOffsetDisplay: document.getElementById('zeroOffsetDisplay'),
      settingsModal: document.getElementById('settingsModal'),
      csvImportModal: document.getElementById('csvImportModal'),
      soundSpeedVal: document.getElementById('soundSpeedVal'),
      soundDelayDeductVal: document.getElementById('soundDelayDeductVal'),
      checkSoundComp: document.getElementById('checkSoundComp'),
      inputTemperature: document.getElementById('inputTemperature'),
      selectSlitWidth: document.getElementById('selectSlitWidth'),
      inputAutoDelay: document.getElementById('inputAutoDelay'),
      camFpsBadge: document.getElementById('camFpsBadge'),
      camLensBadge: document.getElementById('camLensBadge'),
      toolsDrawer: document.getElementById('toolsDrawer'),
      reviewDrawer: document.getElementById('reviewDrawer'),
      floatingSlitSlider: document.getElementById('floatingSlitSlider'),
      hudEventBadge: document.getElementById('hudEventBadge'),
      reviewHeatSubtitle: document.getElementById('reviewHeatSubtitle'),
      btnDist60: document.getElementById('btnDist60'),
      btnDist100: document.getElementById('btnDist100'),
      btnDist200: document.getElementById('btnDist200')
    };
  }

  toggleToolsDrawer() {
    if (!this.dom.toolsDrawer) return;
    this.dom.toolsDrawer.classList.toggle('translate-x-full');
  }

  toggleReviewDrawer() {
    if (!this.dom.reviewDrawer) return;
    this.dom.reviewDrawer.classList.toggle('translate-y-full');
    if (!this.dom.reviewDrawer.classList.contains('translate-y-full')) {
      this.updateHudBadge();
      if (this.dom.scrubberCursor) {
        this.dom.scrubberCursor.classList.remove('hidden');
      }
      // Ensure canvas dimensions and grid are initialized without wiping recorded slices
      this.initSlitCanvasDimensions();
      this.applyCanvasZoom();

      // Position cursor on recorded slices (or default 150px) and scroll into view
      let targetX = this.currentCursorPixelX;
      if (this.sliceIndex.length > 0 && (targetX <= 0 || targetX > this.slitCurrentX)) {
        const midIdx = Math.floor(this.sliceIndex.length * 0.5);
        targetX = this.sliceIndex[midIdx] ? this.sliceIndex[midIdx].x : Math.max(80, Math.floor(this.slitCurrentX * 0.5));
      } else if (targetX <= 0) {
        targetX = 150;
      }
      this.updateCursorPosition(targetX, true);
      requestAnimationFrame(() => {
        this.updateCursorPosition(this.currentCursorPixelX || targetX, true);
      });
    }
  }

  toggleSlitSlider() {
    if (!this.dom.floatingSlitSlider) return;
    this.dom.floatingSlitSlider.classList.toggle('hidden');
  }

  updateHudBadge() {
    const heat = this.heatData[this.currentHeat];
    const heatId = (heat && heat.id) ? heat.id : this.currentHeat;
    const title = (heat && heat.eventTitle) ? heat.eventTitle : `${this.currentDistance}m`;
    const round = (heat && heat.roundName) ? ` (${heat.roundName})` : '';
    const dateTag = (heat && heat.raceDate) ? `[${heat.raceDate.slice(5)}] ` : '';
    if (this.dom.hudEventBadge) {
      this.dom.hudEventBadge.textContent = `${dateTag}第 ${heatId} 組 · ${title}${round}`;
    }
    if (this.dom.reviewHeatSubtitle) {
      this.dom.reviewHeatSubtitle.textContent = `${dateTag}第 ${heatId} 組 · ${title}${round} (${this.currentDistance} 公尺)`;
    }
  }

  initDefaultHeatData(heatNum) {
    if (!this.heatData[heatNum]) {
      this.heatData[heatNum] = {
        distance: this.currentDistance,
        status: 'idle',
        startTime: 0,
        lanes: [
          { lane: 1, grade: '五年一班', name: '選手 1', bib: '紅', rawTime: null, officialTime: '', rank: '-' },
          { lane: 2, grade: '五年二班', name: '選手 2', bib: '藍', rawTime: null, officialTime: '', rank: '-' },
          { lane: 3, grade: '五年三班', name: '選手 3', bib: '黃', rawTime: null, officialTime: '', rank: '-' },
          { lane: 4, grade: '五年四班', name: '選手 4', bib: '紫', rawTime: null, officialTime: '', rank: '-' },
          { lane: 5, grade: '五年五班', name: '選手 5', bib: '橘', rawTime: null, officialTime: '', rank: '-' },
          { lane: 6, grade: '五年六班', name: '選手 6', bib: '綠', rawTime: null, officialTime: '', rank: '-' }
        ],
        sliceCount: 0
      };
    }
  }

  /* ========================================================================== */
  /* ROLE SWITCHING (終點攝影主機 vs 起跑發送器)                                  */
  /* ========================================================================== */

  switchRole(targetRole) {
    this.role = targetRole;

    if (this.dom.toolsDrawer) {
      this.dom.toolsDrawer.classList.add('translate-x-full');
    }

    if (targetRole === 'finish') {
      if (this.dom.btnModeFinish) {
        this.dom.btnModeFinish.className = "py-2 rounded-lg text-white bg-slate-800 font-bold flex items-center justify-center gap-1.5";
      }
      if (this.dom.btnModeStart) {
        this.dom.btnModeStart.className = "py-2 rounded-lg text-slate-400 hover:text-white flex items-center justify-center gap-1.5";
      }
      this.dom.finishHostView.classList.remove('hidden');
      this.dom.startSenderView.classList.add('hidden');
      
      // Stop audio detection on sender if active
      this.stopAudioDetection();
      // Ensure finish camera is running
      if (!this.cameraStream) this.initCamera();
    } else {
      if (this.dom.btnModeStart) {
        this.dom.btnModeStart.className = "py-2 rounded-lg text-white bg-slate-800 font-bold flex items-center justify-center gap-1.5";
      }
      if (this.dom.btnModeFinish) {
        this.dom.btnModeFinish.className = "py-2 rounded-lg text-slate-400 hover:text-white flex items-center justify-center gap-1.5";
      }
      this.dom.startSenderView.classList.remove('hidden');
      this.dom.finishHostView.classList.add('hidden');

      // Fill in room code if empty
      if (!this.dom.inputRoomCode.value) {
        this.dom.inputRoomCode.value = this.roomCode;
      }
    }
  }

  /* ========================================================================== */
  /* SLIT SCAN CAMERA ENGINE (iOS 18 requestVideoFrameCallback)                 */
  /* ========================================================================== */

  async initCamera() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      
      this.dom.cameraSelect.innerHTML = '';
      videoDevices.forEach((dev, idx) => {
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.text = dev.label || `相機 ${idx + 1} (${dev.deviceId.slice(0, 5)})`;
        if (dev.label.toLowerCase().includes('back') || dev.label.includes('後置') || idx === videoDevices.length - 1) {
          opt.selected = true;
          this.selectedCameraId = dev.deviceId;
        }
        this.dom.cameraSelect.appendChild(opt);
      });

      await this.startCameraStream(this.selectedCameraId);
    } catch (err) {
      console.warn('Camera enumeration error or permission pending:', err);
      // Fallback try standard environment camera
      await this.startCameraStream(null);
    }
  }

  async startCameraStream(deviceId) {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }

    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        facingMode: deviceId ? undefined : { ideal: 'environment' },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 60, min: 30 }
      },
      audio: false
    };

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.dom.cameraVideo.srcObject = this.cameraStream;
      this.dom.cameraVideo.onloadedmetadata = () => {
        this.initSlitCanvasDimensions();
      };
      await this.dom.cameraVideo.play();

      // Read track capabilities (e.g. zoom, fps)
      const track = this.cameraStream.getVideoTracks()[0];
      const settings = track.getSettings();
      if (settings.frameRate) {
        this.dom.camFpsBadge.textContent = `${Math.round(settings.frameRate)} FPS`;
      }

      // Immediately initialize canvas dimensions now that video is playing
      this.initSlitCanvasDimensions();

      // Ensure Slit-Scan Video Capture Loop is running
      this.startSlitScanLoop();
    } catch (err) {
      console.error('Camera stream access failed:', err);
      this.dom.camLensBadge.textContent = '相機未授權';
      this.dom.camLensBadge.classList.add('text-red-400');
      this.initSlitCanvasDimensions();
      this.startSlitScanLoop();
    }
  }

  switchCamera(deviceId) {
    this.selectedCameraId = deviceId;
    this.startCameraStream(deviceId);
  }

  async toggleCameraTorch() {
    if (!this.cameraStream) return;
    const track = this.cameraStream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.torch) {
      this.torchEnabled = !this.torchEnabled;
      await track.applyConstraints({ advanced: [{ torch: this.torchEnabled }] });
      this.dom.btnTorch.classList.toggle('bg-amber-600', this.torchEnabled);
    } else {
      this.showToast('您的裝置或相機鏡頭不支援補光燈控制', 'warn');
    }
  }

  updateSlitPosition(val) {
    this.slitXRatio = parseFloat(val) / 100.0;
    this.dom.slitGuideLine.style.left = `${val}%`;
    this.dom.slitPosLabel.textContent = `${val}%`;
  }

  initSlitCanvasDimensions() {
    const video = this.dom.cameraVideo;
    const h = (video && video.videoHeight) || 720;
    const canvas = this.dom.slitCanvas;
    if (!canvas) return;

    const targetWidth = Math.max(1600, window.innerWidth * 3);
    const hasRecordedSlices = (this.sliceIndex && this.sliceIndex.length > 0) || (this.slitCurrentX > 0);

    if (canvas.height !== h || canvas.width < 1200) {
      if (hasRecordedSlices && canvas.width > 0 && canvas.height > 0) {
        // Preserve already recorded race imagery when adjusting canvas buffer size
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

        canvas.height = h;
        canvas.width = Math.max(canvas.width, targetWidth);
        this.drawDemoCanvasGrid();
        canvas.getContext('2d').drawImage(tempCanvas, 0, 0, tempCanvas.width, canvas.height);
        this.drawLaneBadgesOverlay();
      } else {
        canvas.height = h;
        canvas.width = targetWidth;
        this.drawDemoCanvasGrid();
      }
    } else if (!hasRecordedSlices) {
      this.drawDemoCanvasGrid();
    }
  }

  drawLaneBadgesOverlay() {
    const canvas = this.dom.slitCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const laneHeight = canvas.height / 6;
    const laneColors = ['#16a34a', '#f97316', '#9333ea', '#eab308', '#2563eb', '#dc2626'];
    const laneNames = ['第 6 道 (綠) ⬆頂', '第 5 道 (橘)', '第 4 道 (紫)', '第 3 道 (黃)', '第 2 道 (藍)', '第 1 道 (紅) ⬇底'];
    const heat = this.heatData[this.currentHeat];

    ctx.save();
    for (let i = 1; i <= 6; i++) {
      const y = i * laneHeight;
      const laneNum = 7 - i; // Row 1 (top) = 6道, Row 6 (bottom) = 1道
      const centerY = y - laneHeight / 2;
      const laneInfo = heat && heat.lanes ? heat.lanes.find(l => l.lane === laneNum) : null;
      const runnerText = (laneInfo && (laneInfo.grade || laneInfo.name)) ? ` · ${laneInfo.grade || ''} ${laneInfo.name || ''}`.trim() : '';
      const fullLabel = `${laneNames[i - 1]}${runnerText}`;

      ctx.font = 'bold 11px sans-serif';
      const badgeW = Math.max(96, Math.ceil(ctx.measureText(fullLabel).width) + 14);
      ctx.fillStyle = laneColors[i - 1];
      ctx.fillRect(8, centerY - 10, badgeW, 20);

      ctx.fillStyle = (laneNum === 3) ? '#000000' : '#ffffff';
      ctx.fillText(fullLabel, 13, centerY + 4);
    }
    ctx.restore();
  }

  drawDemoCanvasGrid() {
    const canvas = this.dom.slitCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw alternating subtle lane bands and horizontal dashed lane guides (6 Lanes)
    // 螢幕最下方為第 1 道依序往上至第 6 道 (最下方 = 第 1 道, 最上方 = 第 6 道)
    const laneHeight = canvas.height / 6;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = (i % 2 === 0) ? 'rgba(30, 41, 59, 0.55)' : 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(0, i * laneHeight, canvas.width, laneHeight);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 6; i++) {
      const y = i * laneHeight;
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw time ticks at the top
    for (let x = 0; x < canvas.width; x += 100) {
      const sec = (x / 100).toFixed(1);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 16);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '10px monospace';
      ctx.fillText(`${sec}s`, x + 3, 24);
    }

    this.drawLaneBadgesOverlay();
  }

  startSlitScanLoop() {
    if (this._slitLoopRunning) return;
    this._slitLoopRunning = true;
    if (typeof this.slitCurrentX !== 'number') {
      this.slitCurrentX = 0;
    }

    const onFrame = () => {
      const video = this.dom.cameraVideo;
      const canvas = this.dom.slitCanvas;

      // Check if race is running and slit scanning is active
      if (this.raceState === 'running' && canvas) {
        const elapsedSec = (performance.now() - this.raceStartTime) / 1000;

        // Check if auto delay seconds have passed
        if (elapsedSec >= this.autoDelaySeconds) {
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          const hasLiveVideo = Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
          const vw = hasLiveVideo ? video.videoWidth : 1280;
          const vh = hasLiveVideo ? video.videoHeight : (canvas.height || 720);

          if (canvas.height !== vh) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            tempCanvas.getContext('2d').drawImage(canvas, 0, 0);
            canvas.height = vh;
            this.drawDemoCanvasGrid();
            ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, canvas.height);
          }

          // Calculate slit source column
          const sliceW = this.sliceWidth;
          const sourceX = Math.max(0, Math.floor(vw * this.slitXRatio) - Math.floor(sliceW / 2));

          // If canvas buffer runs out of width, extend width dynamically while preserving image
          if (this.slitCurrentX + sliceW >= canvas.width) {
            const oldWidth = canvas.width;
            const newWidth = oldWidth + 1200;
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = oldWidth;
            tempCanvas.height = canvas.height;
            tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

            canvas.width = newWidth;
            canvas.style.width = `${Math.round(newWidth * this.canvasZoom)}px`;
            this.drawDemoCanvasGrid();
            ctx.drawImage(tempCanvas, 0, 0);
          }

          if (hasLiveVideo) {
            // Render vertical slit slice from live camera to canvas
            ctx.drawImage(
              video,
              sourceX, 0, sliceW, vh,
              this.slitCurrentX, 0, sliceW, canvas.height
            );
          } else {
            // Fallback synthetic track slice when testing without camera hardware
            const laneH = canvas.height / 6;
            const vestColors = ['#16a34a', '#f97316', '#9333ea', '#eab308', '#2563eb', '#dc2626'];
            for (let i = 0; i < 6; i++) {
              ctx.fillStyle = (i % 2 === 0) ? '#1e293b' : '#0f172a';
              ctx.fillRect(this.slitCurrentX, i * laneH, sliceW, laneH);
              // Draw lane divider dot
              if (this.slitCurrentX % 8 < sliceW) {
                ctx.fillStyle = 'rgba(255,255,255,0.22)';
                ctx.fillRect(this.slitCurrentX, (i + 1) * laneH - 1, sliceW, 1);
              }
              // Draw simulated runner torso crossing around 1.2s ~ 3.2s for camera-less testing
              const targetCrossSec = 1.2 + i * 0.32;
              if (Math.abs(elapsedSec - targetCrossSec) < 0.08) {
                const centerY = (i + 0.5) * laneH;
                ctx.fillStyle = vestColors[i];
                ctx.fillRect(this.slitCurrentX, centerY - laneH * 0.28, sliceW, laneH * 0.56);
              }
            }
          }

          // Subtle lane guide ticks on top of slice
          const laneH = canvas.height / 6;
          if (this.slitCurrentX % 12 < sliceW) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
            for (let i = 1; i < 6; i++) {
              ctx.fillRect(this.slitCurrentX, Math.round(i * laneH), sliceW, 1);
            }
          }

          // Record timestamp metadata
          this.sliceIndex.push({
            x: this.slitCurrentX,
            timeSec: elapsedSec
          });

          // Draw a time marker every 0.5s / 1.0s at the top of the canvas
          const prevSlice = this.sliceIndex[this.sliceIndex.length - 2];
          if (prevSlice && Math.floor(elapsedSec * 2) > Math.floor(prevSlice.timeSec * 2)) {
            const halfSec = (Math.floor(elapsedSec * 2) / 2).toFixed(1);
            const isFullSec = halfSec.endsWith('.0');
            ctx.fillStyle = isFullSec ? 'rgba(239, 68, 68, 0.95)' : 'rgba(250, 204, 21, 0.75)';
            ctx.fillRect(this.slitCurrentX, 0, 1.5, isFullSec ? 24 : 14);
            ctx.fillStyle = '#ffffff';
            ctx.font = isFullSec ? 'bold 12px monospace' : '10px monospace';
            ctx.fillText(`${halfSec}s`, this.slitCurrentX + 3, isFullSec ? 16 : 12);
          }

          this.slitCurrentX += sliceW;
          if (this.dom.canvasEmptyPrompt) {
            this.dom.canvasEmptyPrompt.classList.add('hidden');
          }

          // Auto-scroll the viewport following the active write head (not the blank right end!)
          if (this.dom.canvasViewport) {
            const vp = this.dom.canvasViewport;
            const headCssX = this.slitCurrentX * this.canvasZoom;
            if (headCssX > vp.clientWidth * 0.75) {
              vp.scrollLeft = Math.max(0, headCssX - vp.clientWidth * 0.75);
            } else {
              vp.scrollLeft = 0;
            }
          }
        }
      }

      requestAnimationFrame(onFrame);
    };

    requestAnimationFrame(onFrame);
  }

  /* ========================================================================== */
  /* RACE EXECUTION & TIMING CONTROLS                                           */
  /* ========================================================================== */

  toggleArm() {
    this.isArmed = !this.isArmed;
    if (this.isArmed) {
      this.dom.btnArmSystem.className = "px-3 py-1 rounded-md font-semibold text-xs transition flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30";
      this.dom.armBtnText.textContent = "待命中 (ARM)";
      if (this.dom.scanStatusBadge) {
        this.dom.scanStatusBadge.textContent = "待命中 (等待起跑訊號)";
        this.dom.scanStatusBadge.className = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800";
      }
    } else {
      this.dom.btnArmSystem.className = "px-3 py-1 rounded-md font-semibold text-xs transition flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-400";
      this.dom.armBtnText.textContent = "已鎖定 (DISARM)";
      if (this.dom.scanStatusBadge) {
        this.dom.scanStatusBadge.textContent = "計時系統已鎖定";
        this.dom.scanStatusBadge.className = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400";
      }
    }

    // Broadcast arm state to connected sender peer
    if (this.peerConnection && this.peerConnection.open) {
      this.peerConnection.send({
        type: 'arm_status',
        isArmed: this.isArmed
      });
    }
  }

  manualStartTrigger() {
    if (!this.isArmed) {
      this.toggleArm();
    }
    this.handleStartTrigger({
      source: 'finish_manual',
      timestamp: performance.now()
    });
  }

  handleStartTrigger(eventData) {
    if (eventData.source === 'zero_test') {
      this.isArmed = true;
      this.raceState = 'idle';
    } else if (!this.isArmed) {
      console.warn('[Timing] System is DISARMED (已鎖定). Start trigger ignored.');
      this.showToast('🔒 系統處於「已鎖定」狀態，已忽略起跑訊號！請點擊上方切換為「待命中 (ARM)」', 'warn');
      return;
    }

    let effectiveStartTime = (typeof eventData.timestamp === 'number') ? eventData.timestamp : performance.now();

    // Sanity check: Clamping to prevent cross-device performance.now() epoch mismatch
    const hostNow = performance.now();
    if (effectiveStartTime > hostNow + 250 || (hostNow - effectiveStartTime) > 2000) {
      console.warn(`[Timing] effectiveStartTime was out of bounds (${effectiveStartTime.toFixed(1)} vs hostNow ${hostNow.toFixed(1)}), clamping to hostNow`);
      effectiveStartTime = hostNow - 5;
    }

    // Apply user-calibrated Zero Offset (IAAF Zero Control compensation, e.g. camera buffer delay)
    if (this.zeroOffsetMs) {
      effectiveStartTime += this.zeroOffsetMs;
      console.log(`[ZeroOffset] Applied offset: ${(this.zeroOffsetMs / 1000).toFixed(3)}s`);
    }

    // If triggered by single-phone acoustic gun sound detection, apply sound speed deduction
    if (eventData.source === 'single_acoustic' && this.enableSoundComp) {
      const deductSec = this.calculateSoundDelay();
      effectiveStartTime -= deductSec * 1000;
      console.log(`[SoundComp] Single-phone acoustic delay deducted: ${deductSec.toFixed(3)}s`);
    }

    // Ensure camera video is playing (in case iOS Safari paused it during background/audio)
    if (this.dom.cameraVideo && this.dom.cameraVideo.paused && this.cameraStream) {
      this.dom.cameraVideo.play().catch(() => {});
    }

    this.sliceIndex = []; // Clear current heat slices
    this.slitCurrentX = 0; // Reset canvas slice write head

    // Initialize canvas dimensions and draw 6-lane background grid before race starts
    this.initSlitCanvasDimensions();
    this.drawDemoCanvasGrid();
    if (this.dom.canvasViewport) {
      this.dom.canvasViewport.scrollLeft = 0;
    }
    if (this.dom.canvasEmptyPrompt) {
      this.dom.canvasEmptyPrompt.classList.add('hidden');
    }

    this.raceStartTime = effectiveStartTime;
    this.raceState = 'running';

    if (this.dom.scanStatusBadge) {
      this.dom.scanStatusBadge.textContent = "⚡ 高速掃描寫入中...";
      this.dom.scanStatusBadge.className = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800 animate-pulse";
    }

    // Update bottom trigger button to red STOP button
    this.updateTriggerButtonState();

    // Play alert sound & haptic vibration
    this.playGunshotAudio();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }

  toggleStartOrStop() {
    if (this.raceState === 'running') {
      this.stopRace();
    } else {
      this.manualStartTrigger();
    }
  }

  stopRace() {
    if (this.raceState !== 'running') return;
    this.raceState = 'finished';
    this.raceEndTime = performance.now();
    const totalElapsedSec = (this.raceEndTime - this.raceStartTime) / 1000;

    // Display final stopped clock time
    const mins = Math.floor(totalElapsedSec / 60);
    const secs = Math.floor(totalElapsedSec % 60);
    const centis = Math.floor((totalElapsedSec % 1) * 100);
    if (this.dom.liveClockDisplay) {
      this.dom.liveClockDisplay.textContent = 
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
    }

    if (this.dom.scanStatusBadge) {
      this.dom.scanStatusBadge.textContent = "比賽已結束 · 準備判讀";
      this.dom.scanStatusBadge.className = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800";
    }

    // Overlay lane identification badges on left edge so judge can clearly read lanes 1~6
    this.drawLaneBadgesOverlay();

    // Position cursor on the recorded region
    if (this.sliceIndex.length > 0) {
      const midIdx = Math.floor(this.sliceIndex.length * 0.5);
      const targetX = this.sliceIndex[midIdx] ? this.sliceIndex[midIdx].x : Math.max(80, Math.floor(this.slitCurrentX * 0.5));
      this.updateCursorPosition(targetX, true);
    }

    this.updateTriggerButtonState();

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // Automatically slide up the review drawer after 0.35s so judge can immediately read results!
    setTimeout(() => {
      if (this.dom.reviewDrawer && this.dom.reviewDrawer.classList.contains('translate-y-full')) {
        this.toggleReviewDrawer();
      }
    }, 350);
  }

  updateTriggerButtonState() {
    const btn = this.dom.btnManualTrigger;
    const icon = document.getElementById('manualTriggerIcon');
    const text = document.getElementById('manualTriggerText');
    if (!btn) return;

    if (this.raceState === 'running') {
      btn.className = "flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/50 animate-pulse active:scale-95";
      if (icon) icon.textContent = '⏹️';
      if (text) text.textContent = '停止計時 (STOP)';
    } else if (this.raceState === 'finished') {
      btn.className = "flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 active:scale-95";
      if (icon) icon.textContent = '✅';
      if (text) text.textContent = '已結束 (重跑)';
    } else {
      btn.className = "flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white shadow-md active:scale-95";
      if (icon) icon.textContent = '⚡';
      if (text) text.textContent = '手動起跑';
    }
  }

  startClockTicker() {
    const update = () => {
      if (this.raceState === 'running') {
        const elapsedMs = performance.now() - this.raceStartTime;
        const totalSec = Math.max(0, elapsedMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = Math.floor(totalSec % 60);
        const centis = Math.floor((totalSec % 1) * 100);

        this.dom.liveClockDisplay.textContent = 
          `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
      }
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  resetCurrentHeat() {
    this.raceState = 'idle';
    this.raceStartTime = 0;
    this.sliceIndex = [];
    this.slitCurrentX = 0;
    this.dom.liveClockDisplay.textContent = "00:00.00";
    if (this.dom.scanStatusBadge) {
      this.dom.scanStatusBadge.textContent = "等待起跑訊號";
      this.dom.scanStatusBadge.className = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400";
    }
    this.drawDemoCanvasGrid();
    if (this.dom.canvasViewport) {
      this.dom.canvasViewport.scrollLeft = 0;
    }
    this.dom.canvasEmptyPrompt.classList.remove('hidden');
    this.dom.scrubberCursor.classList.remove('hidden');
    this.dom.officialRoundedTime.textContent = "--:--.--";
    this.updateTriggerButtonState();

    // Re-initialize default 6 lanes for this heat
    this.initDefaultHeatData(this.currentHeat);
    const heat = this.heatData[this.currentHeat];
    if (heat) {
      heat.lanes.forEach(lane => {
        lane.rawTime = null;
        lane.officialTime = '';
        lane.rank = '-';
      });
      this.renderLanesTable();
    }
    if (this.dom.assignedCountBadge) {
      this.dom.assignedCountBadge.textContent = "已判讀 0/6";
    }
  }

  /* ========================================================================== */
  /* SCRUBBER & JUDGING WORKFLOW (觸控滑動、放大鏡與一鍵道次綁定)                */
  /* ========================================================================== */

  bindCanvasScrubberEvents() {
    const viewport = this.dom.canvasViewport;
    const canvas = this.dom.slitCanvas;
    let isDragging = false;

    const setCursorFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const relativeX = (clientX - rect.left) / this.canvasZoom;
      this.updateCursorPosition(relativeX);
    };

    viewport.addEventListener('mousedown', (e) => {
      isDragging = true;
      setCursorFromEvent(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) setCursorFromEvent(e);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    viewport.addEventListener('touchstart', (e) => {
      isDragging = true;
      setCursorFromEvent(e);
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
      if (isDragging) {
        if (e.cancelable) e.preventDefault();
        setCursorFromEvent(e);
      }
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
      isDragging = false;
    });
  }

  updateCursorPosition(pixelX, autoScroll = false) {
    // Constrain pixelX to canvas width
    const canvasW = (this.dom.slitCanvas && this.dom.slitCanvas.width) || 1200;
    pixelX = Math.max(0, Math.min(pixelX, canvasW));
    this.currentCursorPixelX = pixelX;

    let timeSec = 0;

    if (this.sliceIndex.length > 0) {
      // Binary search sliceIndex for closest recorded slice
      let low = 0;
      let high = this.sliceIndex.length - 1;
      let closest = this.sliceIndex[0];

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const item = this.sliceIndex[mid];
        if (Math.abs(item.x - pixelX) < Math.abs(closest.x - pixelX)) {
          closest = item;
        }
        if (item.x < pixelX) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      timeSec = closest.timeSec;
      pixelX = closest.x;
    } else {
      // Free drag mode (before start): 100px = 1.00s scale
      timeSec = pixelX / 100.0;
    }

    this.currentCursorTimeSec = timeSec;
    const cursorX = pixelX * this.canvasZoom;

    // Update cursor DOM line position
    if (this.dom.scrubberCursor) {
      this.dom.scrubberCursor.style.left = `${cursorX}px`;
      this.dom.scrubberCursor.classList.remove('hidden');
    }

    // Auto-scroll viewport to keep cursor visible if requested or out of bounds
    if (autoScroll && this.dom.canvasViewport) {
      const vp = this.dom.canvasViewport;
      if (cursorX < vp.scrollLeft || cursorX > vp.scrollLeft + vp.clientWidth) {
        vp.scrollLeft = Math.max(0, cursorX - vp.clientWidth / 2);
      }
    }

    // Format raw time: MM:SS.mmm (supports negative time for zero calibration)
    const sign = timeSec < 0 ? '-' : '';
    const absSec = Math.abs(timeSec);
    const mins = Math.floor(absSec / 60);
    const secs = (absSec % 60).toFixed(3);
    if (this.dom.cursorTimeDisplay) {
      this.dom.cursorTimeDisplay.textContent = `${sign}${String(mins).padStart(2, '0')}:${secs.padStart(6, '0')}`;
    }

    // IAAF Rule Rounding: Unconditional ceiling to next 0.01s (e.g. 10.231 -> 10.24)
    if (timeSec < 0) {
      if (this.dom.officialRoundedTime) {
        this.dom.officialRoundedTime.textContent = `-${absSec.toFixed(2)}s`;
      }
    } else {
      const roundedOfficial = Math.ceil(timeSec * 100) / 100;
      const rMins = Math.floor(roundedOfficial / 60);
      const rSecs = (roundedOfficial % 60).toFixed(2);
      if (this.dom.officialRoundedTime) {
        this.dom.officialRoundedTime.textContent = 
          rMins > 0 ? `${rMins}:${rSecs.padStart(5, '0')}` : `${rSecs}s`;
      }
    }
  }

  stepCursor(deltaSec) {
    const targetTime = this.currentCursorTimeSec + deltaSec;

    if (this.sliceIndex.length === 0) {
      this.updateCursorPosition(targetTime * 100.0, true);
      return;
    }

    // Find slice closest to targetTime
    let closest = this.sliceIndex[0];
    let minDiff = Infinity;
    for (let i = 0; i < this.sliceIndex.length; i++) {
      const diff = Math.abs(this.sliceIndex[i].timeSec - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = this.sliceIndex[i];
      }
    }

    this.updateCursorPosition(closest.x, true);
  }

  zoomCanvas(factor) {
    this.canvasZoom = Math.max(0.5, Math.min(24.0, this.canvasZoom * factor));
    this.applyCanvasZoom();
  }

  setCanvasZoom(level) {
    this.canvasZoom = Math.max(0.5, Math.min(24.0, level));
    this.applyCanvasZoom();
  }

  resetCanvasZoom() {
    this.canvasZoom = 1.0;
    this.applyCanvasZoom();
  }

  applyCanvasZoom() {
    const canvas = this.dom.slitCanvas;
    if (!canvas) return;

    // Use CSS width for true layout-based stretching, allowing native scrolling and accurate geometry
    const displayWidth = Math.round(canvas.width * this.canvasZoom);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.transform = ''; // clear transform to avoid layout conflict
    canvas.style.imageRendering = 'auto'; // Smooth bilinear GPU filtering, eliminates mosaic/pixelation!

    if (this.dom.zoomLevelDisplay) {
      this.dom.zoomLevelDisplay.textContent = `${this.canvasZoom.toFixed(1)}x`;
    }

    // Reposition cursor in zoomed layout
    this.updateCursorPosition(this.currentCursorPixelX || 0, true);
  }

  assignTimeToLane(laneNum) {
    if (this.currentCursorTimeSec <= 0) {
      alert('請先在畫卷上滑動游標，對準選手壓線位置！');
      return;
    }

    const heat = this.heatData[this.currentHeat];
    if (!heat) return;

    const laneItem = heat.lanes.find(l => l.lane === laneNum);
    if (!laneItem) return;

    // IAAF Rule Ceiling
    const roundedTime = Math.ceil(this.currentCursorTimeSec * 100) / 100;
    laneItem.rawTime = this.currentCursorTimeSec;
    laneItem.officialTime = roundedTime.toFixed(2);

    // Auto sort ranks
    this.recalculateRanks();
    this.renderLanesTable();

    // Redraw lane marker flag on the canvas
    this.drawLaneMarkerOnCanvas(laneNum, this.dom.officialRoundedTime.textContent);

    if (navigator.vibrate) navigator.vibrate(50);

    // Auto sync updated results to PC Backend
    this.syncCurrentHeatToBackend(false);
  }

  recalculateRanks() {
    const heat = this.heatData[this.currentHeat];
    if (!heat) return;

    // Filter lanes that have official times
    const assignedLanes = heat.lanes.filter(l => l.rawTime !== null);
    assignedLanes.sort((a, b) => a.rawTime - b.rawTime);

    assignedLanes.forEach((lane, idx) => {
      lane.rank = `${idx + 1}`;
    });

    this.dom.assignedCountBadge.textContent = `已判讀 ${assignedLanes.length}/6`;
  }

  drawLaneMarkerOnCanvas(laneNum, timeLabel) {
    // Optional overlay pin on canvas for official export
    const ctx = this.dom.slitCanvas.getContext('2d');
    const pixelX = Math.round(this.dom.scrubberCursor.offsetLeft / this.canvasZoom);
    
    // Choose distinct lane colors: 紅、藍、黃、紫、橘、綠
    const colors = ['#dc2626', '#2563eb', '#eab308', '#9333ea', '#f97316', '#16a34a'];
    const colorNames = ['紅', '藍', '黃', '紫', '橘', '綠'];
    const color = colors[(laneNum - 1) % colors.length];
    const colorName = colorNames[(laneNum - 1) % colorNames.length] || '';

    // Calculate vertical position: 螢幕最下方為第 1 道依序往上至第 6 道
    const canvasH = this.dom.slitCanvas.height;
    const laneH = canvasH / 6;
    const rowIndex = 6 - laneNum; // Lane 1 -> row 5 (bottom), Lane 6 -> row 0 (top)
    const centerY = (rowIndex + 0.5) * laneH;

    ctx.save();
    // Full height hairline
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pixelX, 0);
    ctx.lineTo(pixelX, canvasH);
    ctx.stroke();

    // Flag badge at the specific lane's vertical height
    const badgeW = 78;
    const badgeH = 20;
    const badgeY = Math.max(6, Math.min(canvasH - badgeH - 6, centerY - badgeH / 2));
    ctx.fillStyle = color;
    ctx.fillRect(pixelX - 2, badgeY, badgeW, badgeH);

    // Indicator triangular notch pointing to the finish line
    ctx.beginPath();
    ctx.moveTo(pixelX - 2, centerY);
    ctx.lineTo(pixelX - 6, centerY - 4);
    ctx.lineTo(pixelX - 6, centerY + 4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = (laneNum === 3) ? '#000000' : '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${laneNum}道(${colorName}) ${timeLabel}`, pixelX + 2, badgeY + 14);
    ctx.restore();
  }

  renderLanesTable() {
    const heat = this.heatData[this.currentHeat];
    if (!heat || !Array.isArray(heat.lanes)) return;

    const LANE_COLOR_NAMES = ['紅', '藍', '黃', '紫', '橘', '綠'];
    const LANE_BADGE_CLASSES = [
      'bg-red-600 text-white',
      'bg-blue-600 text-white',
      'bg-yellow-400 text-slate-950 font-black',
      'bg-purple-600 text-white',
      'bg-orange-500 text-white',
      'bg-emerald-600 text-white'
    ];

    if (this.dom.lanesTableBody) {
      this.dom.lanesTableBody.innerHTML = '';
    }
    if (this.dom.drawerRosterList) {
      this.dom.drawerRosterList.innerHTML = '';
    }
    if (this.dom.senderRosterList) {
      this.dom.senderRosterList.innerHTML = '';
    }

    heat.lanes.forEach(item => {
      const idx = item.lane - 1;
      const colorName = LANE_COLOR_NAMES[idx] || '';
      const badgeCls = LANE_BADGE_CLASSES[idx] || 'bg-slate-700 text-white';
      const gradeStr = item.grade || '';
      const nameStr = item.name || '';
      const fullRunner = `${gradeStr} ${nameStr}`.trim() || '未排定';

      // 1. Update Review Drawer Table (#lanesTableBody)
      if (this.dom.lanesTableBody) {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/40 transition text-xs";
        tr.innerHTML = `
          <td class="py-1 px-1.5 font-mono">
            <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeCls}">
              ${item.lane}道 (${colorName})
            </span>
          </td>
          <td class="py-1 px-1.5 text-slate-100 font-medium">
            <div class="flex items-center gap-1">
              <span class="text-slate-400 text-[10px]">${gradeStr}</span>
              <input type="text" value="${nameStr}" onchange="app.updateLaneField(${item.lane}, 'name', this.value)" class="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-red-500 outline-none w-20 text-slate-100 font-semibold text-xs" placeholder="選手">
            </div>
          </td>
          <td class="py-1 px-1 font-mono font-black ${item.officialTime ? 'text-amber-400' : 'text-slate-600'}">
            ${item.officialTime ? `${item.officialTime}s` : '--'}
          </td>
          <td class="py-1 px-1 font-mono font-bold text-center ${item.rank === '1' ? 'text-yellow-400' : 'text-slate-300'}">
            ${item.rank || '-'}
          </td>
          <td class="py-1 px-1 text-right">
            <button onclick="app.clearLaneTime(${item.lane})" class="text-[10px] text-slate-500 hover:text-red-400 px-1">清除</button>
          </td>
        `;
        this.dom.lanesTableBody.appendChild(tr);
      }

      // 2. Update Tools Drawer Roster Preview (#drawerRosterList)
      if (this.dom.drawerRosterList) {
        const card = document.createElement('div');
        card.className = "flex items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-lg px-2 py-1 truncate";
        card.innerHTML = `
          <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${badgeCls} shrink-0">${item.lane}道(${colorName})</span>
          <span class="text-slate-300 text-[11px] font-medium truncate">${fullRunner}</span>
        `;
        this.dom.drawerRosterList.appendChild(card);
      }

      // 3. Update Start Sender View Roster Preview (#senderRosterList)
      if (this.dom.senderRosterList) {
        const sCard = document.createElement('div');
        sCard.className = "flex items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-lg px-2 py-1.5 truncate";
        sCard.innerHTML = `
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeCls} shrink-0">${item.lane}道(${colorName})</span>
          <span class="text-slate-200 text-xs font-semibold truncate">${fullRunner}</span>
        `;
        this.dom.senderRosterList.appendChild(sCard);
      }

      // 4. Update Live Camera Slit Guide Badges (#slitLaneText1..6) - Only show lane & color (clean camera view)
      const slitBadge = document.getElementById(`slitLaneText${item.lane}`);
      if (slitBadge) {
        const arrow = item.lane === 6 ? ' ⬆頂' : (item.lane === 1 ? ' ⬇底' : '');
        slitBadge.textContent = `${item.lane}道(${colorName})${arrow}`;
      }

      // 5. Update Quick Assign Buttons in Review Toolbar (#btnAssignLane1..6)
      const assignBtn = document.getElementById(`btnAssignLane${item.lane}`);
      if (assignBtn) {
        const arrow = item.lane === 6 ? '⬆' : (item.lane === 1 ? '⬇' : '');
        const subLabel = nameStr || '未排';
        assignBtn.innerHTML = `<span class="block text-[11px] leading-tight">${item.lane}道(${colorName})${arrow}</span><span class="block text-[10px] font-medium leading-tight opacity-95 truncate">${subLabel}</span>`;
      }
    });
  }

  updateLaneField(laneNum, field, val) {
    const heat = this.heatData[this.currentHeat];
    if (heat) {
      const lane = heat.lanes.find(l => l.lane === laneNum);
      if (lane) {
        lane[field] = val;
        this.renderLanesTable();
        this.syncCurrentHeatToBackend(false);
      }
    }
  }

  clearLaneTime(laneNum) {
    const heat = this.heatData[this.currentHeat];
    if (heat) {
      const lane = heat.lanes.find(l => l.lane === laneNum);
      if (lane) {
        lane.rawTime = null;
        lane.officialTime = '';
        lane.rank = '-';
        this.recalculateRanks();
        this.renderLanesTable();
        this.syncCurrentHeatToBackend(false);
      }
    }
  }

  /* ========================================================================== */
  /* WEBRTC P2P & PTP-LITE CLOCK SYNCHRONIZATION                                */
  /* ========================================================================== */

  bindPeerKeepAliveEvents() {
    const checkAndHealConnection = () => {
      if (document.visibilityState === 'hidden') return;
      // 1. Heal Finish Host signaling server connection if disconnected
      if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
        try {
          console.log('[PeerJS] Healing Finish Host signaling connection...');
          this.peer.reconnect();
        } catch (e) {}
      }
      // 2. Heal Start Sender connection if paired & interrupted (e.g. after saving photo)
      if (this.role === 'start' && this.shouldStayConnected && this.targetRoomCode) {
        if (this.senderPeer && !this.senderPeer.destroyed && this.senderPeer.disconnected) {
          try { this.senderPeer.reconnect(); } catch (e) {}
        }
        if (!this.peerConnection || !this.peerConnection.open) {
          this.scheduleSenderReconnect(300);
        }
      }
    };

    document.addEventListener('visibilitychange', checkAndHealConnection);
    window.addEventListener('focus', checkAndHealConnection);
    window.addEventListener('online', checkAndHealConnection);
  }

  initFinishHostPeer() {
    // Create Peer with designated room ID: profinish-heat-${roomCode}
    const peerId = `profinish-heat-${this.roomCode}`;
    
    try {
      if (typeof Peer === 'undefined') {
        console.warn('PeerJS CDN loading in background...');
        return;
      }

      if (this.peer && !this.peer.destroyed) {
        try { this.peer.destroy(); } catch (e) {}
      }

      this.peer = new Peer(peerId, {
        debug: 1,
        pingInterval: 5000,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        console.log('[PeerJS] Finish Host listening on room peer ID:', id);
        if (this.peerConnection && this.peerConnection.open) {
          this.updateSyncBadge('connected', `已連線起跑機 · PTP同步中`);
        } else {
          this.updateSyncBadge('ready', `配對代碼 [${this.roomCode}] 等待連線`);
        }
      });

      this.peer.on('connection', (conn) => {
        console.log('[PeerJS] Start Sender connected!');
        if (this.peerConnection && this.peerConnection !== conn) {
          try { this.peerConnection.close(); } catch (e) {}
        }
        this.peerConnection = conn;
        this.setupDataChannel(conn, 'host');
      });

      this.peer.on('disconnected', () => {
        console.warn('[PeerJS] Finish Host signaling socket disconnected, auto-reconnecting...');
        setTimeout(() => {
          if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
            try { this.peer.reconnect(); } catch (e) {}
          }
        }, 1000);
      });

      this.peer.on('error', (err) => {
        console.warn('[PeerJS] Peer error:', err.type || err);
        // If P2P DataChannel with Start Sender is still open, never downgrade status!
        if (this.peerConnection && this.peerConnection.open) {
          if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
            setTimeout(() => {
              try { this.peer.reconnect(); } catch (e) {}
            }, 1500);
          }
          return;
        }

        if (err && err.type === 'unavailable-id') {
          setTimeout(() => this.initFinishHostPeer(), 2000);
          return;
        }

        if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
          setTimeout(() => {
            try { this.peer.reconnect(); } catch (e) {}
          }, 1500);
        } else {
          this.updateSyncBadge('offline', '單機模式 (聲速補償)');
        }
      });
    } catch (e) {
      console.warn('PeerJS init failed:', e);
    }
  }

  connectToFinishHost(isAutoReconnect = false) {
    const targetCode = (this.dom.inputRoomCode && this.dom.inputRoomCode.value.trim()) || this.targetRoomCode;
    if (!targetCode || targetCode.length < 3) {
      if (!isAutoReconnect) this.showToast('請輸入有效的 4 位數配對碼！', 'warn');
      return;
    }

    this.targetRoomCode = targetCode;
    this.shouldStayConnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (!isAutoReconnect && this.dom.btnConnectHost) {
      this.dom.btnConnectHost.textContent = '連線中...';
      this.dom.btnConnectHost.disabled = true;
    }

    const connectDataChannel = (peerInstance) => {
      const hostPeerId = `profinish-heat-${targetCode}`;
      console.log(`[PeerJS] Connecting to host: ${hostPeerId}`);
      if (this.peerConnection && this.peerConnection.open) {
        return;
      }
      const conn = peerInstance.connect(hostPeerId, { reliable: true });

      conn.on('open', () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.peerConnection = conn;
        if (this.dom.btnConnectHost) {
          this.dom.btnConnectHost.textContent = '已連線';
          this.dom.btnConnectHost.disabled = false;
          this.dom.btnConnectHost.className = "px-3 py-1.5 rounded-lg bg-emerald-600 font-bold text-xs text-white shadow";
        }
        this.setupDataChannel(conn, 'sender');
      });

      const handleDisconnect = () => {
        if (this.peerConnection === conn) {
          this.peerConnection = null;
        }
        if (this.shouldStayConnected) {
          if (this.dom.senderSyncBadge) {
            this.dom.senderSyncBadge.textContent = '🔄 訊號保持/重連中...';
            this.dom.senderSyncBadge.className = "text-xs font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800";
          }
          this.scheduleSenderReconnect(1200);
        } else {
          if (this.dom.btnConnectHost) {
            this.dom.btnConnectHost.textContent = '連線';
            this.dom.btnConnectHost.disabled = false;
          }
          if (this.dom.senderSyncBadge) {
            this.dom.senderSyncBadge.textContent = '連線已中斷';
            this.dom.senderSyncBadge.className = "text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-red-400";
          }
        }
      };

      conn.on('close', handleDisconnect);
      conn.on('error', handleDisconnect);
    };

    try {
      // Reuse existing open senderPeer if available
      if (this.senderPeer && !this.senderPeer.destroyed) {
        if (this.senderPeer.disconnected) {
          this.senderPeer.reconnect();
        } else if (this.senderPeer.open) {
          connectDataChannel(this.senderPeer);
          return;
        }
      }

      if (this.senderPeer && !this.senderPeer.destroyed) {
        try { this.senderPeer.destroy(); } catch (e) {}
      }

      // Create sender peer with random ID
      const senderPeerId = `profinish-sender-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const senderPeer = new Peer(senderPeerId, {
        debug: 1,
        pingInterval: 5000,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });
      this.senderPeer = senderPeer;

      senderPeer.on('open', () => {
        connectDataChannel(senderPeer);
      });

      senderPeer.on('disconnected', () => {
        if (this.senderPeer === senderPeer && !senderPeer.destroyed) {
          setTimeout(() => {
            try { senderPeer.reconnect(); } catch (e) {}
          }, 800);
        }
      });

      senderPeer.on('error', (err) => {
        console.warn('[PeerJS] Sender peer error:', err.type || err);
        if (this.peerConnection && this.peerConnection.open) return;

        if (this.shouldStayConnected) {
          this.scheduleSenderReconnect(1500);
        } else {
          this.showToast('配對失敗：找不到該代碼之終點機，請確認代碼或網路連線', 'warn');
          if (this.dom.btnConnectHost) {
            this.dom.btnConnectHost.textContent = '連線';
            this.dom.btnConnectHost.disabled = false;
          }
        }
      });
    } catch (err) {
      if (!isAutoReconnect) {
        this.showToast('WebRTC 連線異常: ' + err.message, 'warn');
      }
      if (this.dom.btnConnectHost) this.dom.btnConnectHost.disabled = false;
    }
  }

  scheduleSenderReconnect(delayMs = 1500) {
    if (!this.shouldStayConnected || !this.targetRoomCode) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldStayConnected && (!this.peerConnection || !this.peerConnection.open)) {
        this.connectToFinishHost(true);
      }
    }, delayMs);
  }

  setupDataChannel(conn, roleType) {
    conn.on('data', (data) => {
      this.handleIncomingPeerData(data, roleType);
    });

    if (roleType === 'sender') {
      this.dom.senderSyncBadge.textContent = '已雙機直連 (校時中)';
      this.dom.senderSyncBadge.className = "text-xs font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800";
      // Start PTP-Lite Ping-Pong every 500ms
      this.startPtpPingLoop(conn);
    } else {
      this.updateSyncBadge('connected', `已連線起跑機 · PTP同步中`);
      conn.send({ type: 'arm_status', isArmed: this.isArmed });
      conn.send({ type: 'heat_changed', heatKey: this.currentHeat });

      const onHostConnClosed = () => {
        if (this.peerConnection === conn) {
          this.peerConnection = null;
          this.updateSyncBadge('ready', `配對代碼 [${this.roomCode}] 等待連線`);
        }
        if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
          try { this.peer.reconnect(); } catch (e) {}
        }
      };
      conn.on('close', onHostConnClosed);
      conn.on('error', onHostConnClosed);
    }
  }

  startPtpPingLoop(conn) {
    if (this.ptpTimer) clearInterval(this.ptpTimer);
    this.ptpTimer = setInterval(() => {
      if (conn && conn.open) {
        try {
          conn.send({
            type: 'ptp_ping',
            t1: performance.now()
          });
        } catch (e) {}
      } else if (this.role === 'start' && this.shouldStayConnected) {
        this.scheduleSenderReconnect(800);
      }
    }, 500);
  }

  handleIncomingPeerData(data, currentRole) {
    // Finish Host handles PTP Ping from Sender
    if (data.type === 'ptp_ping') {
      const t2 = performance.now();
      const t3 = performance.now();
      if (this.peerConnection) {
        this.peerConnection.send({
          type: 'ptp_pong',
          t1: data.t1,
          t2: t2,
          t3: t3
        });
      }
    } 
    // Start Sender handles PTP Pong from Host
    else if (data.type === 'ptp_pong') {
      const t4 = performance.now();
      const t1 = data.t1;
      const t2 = data.t2;
      const t3 = data.t3;

      // PTP Calculations:
      // RTT = (t4 - t1) - (t3 - t2)
      // Offset θ = ((t2 - t1) + (t3 - t4)) / 2
      const rtt = (t4 - t1) - (t3 - t2);
      const offset = ((t2 - t1) + (t3 - t4)) / 2;

      this.ptpSamples.push({ rtt, offset });
      if (this.ptpSamples.length > 20) this.ptpSamples.shift();

      // Filter lowest 5 RTT samples to eliminate network jitter
      const sorted = [...this.ptpSamples].sort((a, b) => a.rtt - b.rtt);
      const best = sorted.slice(0, Math.min(5, sorted.length));
      const avgOffset = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
      const avgRtt = best.reduce((sum, s) => sum + s.rtt, 0) / best.length;

      this.clockOffset = avgOffset;
      this.meanRtt = avgRtt;

      // Update PTP Status UI on Sender
      if (this.dom.ptpRttVal) this.dom.ptpRttVal.textContent = `${avgRtt.toFixed(1)} ms`;
      if (this.dom.ptpOffsetVal) this.dom.ptpOffsetVal.textContent = `${avgOffset.toFixed(1)} ms`;
      
      let rating = "極佳 (< 2ms)";
      let colorClass = "text-emerald-400";
      if (avgRtt > 20) {
        rating = "良好 (< 20ms)";
        colorClass = "text-amber-400";
      }
      if (this.dom.ptpSyncRating) {
        this.dom.ptpSyncRating.textContent = rating;
        this.dom.ptpSyncRating.className = `${colorClass} font-bold`;
      }
    }
    // Finish Host handles race start signal or zero-test trigger from Sender
    else if (data.type === 'race_start' || data.type === 'zero_test_trigger') {
      if (data.type === 'race_start' && !this.isArmed) {
        console.warn('[PeerJS] Received race_start but Finish Host is DISARMED (已鎖定).');
        this.showToast('🔒 終點處於「已鎖定」狀態，已阻擋起跑訊號！請點擊上方切換為「待命中 (ARM)」', 'warn');
        if (this.peerConnection && this.peerConnection.open) {
          this.peerConnection.send({ type: 'host_disarmed' });
        }
        return;
      }

      const transitDelay = (typeof data.transitDelay === 'number' && data.transitDelay >= 0 && data.transitDelay < 500)
        ? data.transitDelay
        : 5;
      const effectiveStartTime = performance.now() - transitDelay;
      console.log(`[PeerJS] Received ${data.type} with transitDelay: ${transitDelay.toFixed(1)}ms`);

      this.handleStartTrigger({
        source: data.type === 'zero_test_trigger' ? 'zero_test' : 'remote_sender',
        timestamp: effectiveStartTime
      });

      if (data.type === 'zero_test_trigger') {
        this.showToast('⚡ 接收到歸零測試訊號！計時與狹縫攝影已同步啟動', 'success');
      } else {
        this.showToast('🚀 接收到起跑訊號！已同步啟動計時', 'success');
      }
    }
    // Handle Finish Host arm state received by Start Sender
    else if (data.type === 'arm_status') {
      this.hostIsArmed = data.isArmed;
      if (this.dom.senderHostArmBadge) {
        if (data.isArmed) {
          this.dom.senderHostArmBadge.textContent = '🟢 待命中 (可起跑)';
          this.dom.senderHostArmBadge.className = 'text-emerald-400 font-bold';
        } else {
          this.dom.senderHostArmBadge.textContent = '🔒 已鎖定 (未就緒)';
          this.dom.senderHostArmBadge.className = 'text-red-400 font-bold animate-pulse';
        }
      }
    }
    // Handle heat_changed sync between paired devices
    else if (data.type === 'heat_changed' && data.heatKey) {
      if (String(data.heatKey) !== String(this.currentHeat)) {
        this.switchHeat(data.heatKey, false);
      }
    }
    // Handle host_disarmed notification on Start Sender
    else if (data.type === 'host_disarmed') {
      this.showToast('⚠️ 終點平板目前為「已鎖定」狀態，未開始計時！請請終點端按「待命中 (ARM)」解鎖', 'warn');
    }
    // Handle IAAF Zero-Test flash signal
    else if (data.type === 'zero_test_flash') {
      this.showZeroTestFlash();
    }
  }

  showToast(message, type = 'info') {
    let toast = document.getElementById('globalToastPill');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'globalToastPill';
      toast.className = 'fixed top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-2xl transition-all duration-300 pointer-events-none opacity-0 translate-y-[-10px]';
      document.body.appendChild(toast);
    }

    if (type === 'success') {
      toast.style.background = 'rgba(5, 150, 105, 0.95)';
      toast.style.border = '1px solid rgba(52, 211, 153, 0.6)';
    } else if (type === 'warn') {
      toast.style.background = 'rgba(217, 119, 6, 0.95)';
      toast.style.border = '1px solid rgba(251, 191, 36, 0.6)';
    } else {
      toast.style.background = 'rgba(30, 41, 59, 0.95)';
      toast.style.border = '1px solid rgba(148, 163, 184, 0.4)';
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, 0)';

    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -10px)';
    }, 2800);
  }

  senderSendTrigger() {
    // If connected and host is locked, prevent false start and alert starter
    if (this.peerConnection && this.peerConnection.open && this.hostIsArmed === false) {
      this.showToast('🔒 終點平板為「已鎖定」狀態，請先請終點裁判按「待命中 (ARM)」！', 'warn');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      return;
    }

    const localNow = performance.now();
    const transitDelay = (this.meanRtt && this.meanRtt > 0 && this.meanRtt < 200) ? (this.meanRtt / 2) : 5;

    // Trigger local gunshot audio & visual flash
    this.playGunshotAudio();
    this.showZeroTestFlash();
    if (navigator.vibrate) navigator.vibrate([150, 50, 150]);

    if (this.peerConnection && this.peerConnection.open) {
      this.peerConnection.send({
        type: 'race_start',
        transitDelay: transitDelay,
        source: 'sender_touch'
      });
      this.showToast('🚀 起跑訊號已發送！終點機已同步開始計時', 'success');
    } else {
      // Non-blocking toast: Never block audio with modal alert!
      this.showToast('💥 鳴槍完成 (獨立發令模式 · 未連線終點機)', 'warn');
    }
  }

  updateSyncBadge(status, text) {
    this.dom.syncText.textContent = text;
    if (status === 'connected') {
      this.dom.syncDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
      this.dom.syncBadge.className = "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800";
    } else if (status === 'ready') {
      this.dom.syncDot.className = "w-2 h-2 rounded-full bg-sky-400";
      this.dom.syncBadge.className = "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono bg-slate-800 text-sky-400 border border-slate-700";
    } else {
      this.dom.syncDot.className = "w-2 h-2 rounded-full bg-amber-400";
      this.dom.syncBadge.className = "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700";
    }
  }

  /* ========================================================================== */
  /* AUDIO TRIGGER ENGINE (槍聲/哨音瞬態偵測、發令員與歸零測試)                  */
  /* ========================================================================== */

  async toggleAudioDetection() {
    if (this.isAudioListening) {
      this.stopAudioDetection();
    } else {
      await this.startAudioDetection();
    }
  }

  async startAudioDetection() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      
      const source = this.audioCtx.createMediaStreamSource(this.audioStream);
      this.audioAnalyser = this.audioCtx.createAnalyser();
      this.audioAnalyser.fftSize = 256;
      source.connect(this.audioAnalyser);

      this.isAudioListening = true;
      this.dom.btnToggleAudioListen.textContent = "停止麥克風偵測";
      this.dom.btnToggleAudioListen.className = "px-3 py-1 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition";

      const dataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);

      const checkAudio = () => {
        if (!this.isAudioListening) return;

        this.audioAnalyser.getByteFrequencyData(dataArray);
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] > max) max = dataArray[i];
        }

        const percentage = Math.round((max / 255) * 100);
        this.dom.audioLevelLabel.textContent = `${percentage}%`;
        this.dom.audioLevelBar.style.width = `${percentage}%`;

        // Check against threshold
        if (percentage >= this.audioThreshold) {
          const now = Date.now();
          if (now - this.lastAudioTriggerTime > 2000) { // 2s debounce
            this.lastAudioTriggerTime = now;
            console.log('[AudioTrigger] Peak detected! Sound volume:', percentage);

            if (this.role === 'start') {
              this.senderSendTrigger();
            } else {
              this.handleStartTrigger({
                source: 'single_acoustic',
                timestamp: performance.now()
              });
            }
          }
        }

        this.audioAnimFrame = requestAnimationFrame(checkAudio);
      };

      this.audioAnimFrame = requestAnimationFrame(checkAudio);
    } catch (err) {
      alert('無法開啟麥克風：請確認已給予瀏覽器麥克風權限！');
      console.error(err);
    }
  }

  stopAudioDetection() {
    this.isAudioListening = false;
    if (this.audioAnimFrame) cancelAnimationFrame(this.audioAnimFrame);
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(t => t.stop());
      this.audioStream = null;
    }
    if (this.dom.btnToggleAudioListen) {
      this.dom.btnToggleAudioListen.textContent = "開啟麥克風偵測";
      this.dom.btnToggleAudioListen.className = "px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition";
    }
  }

  setAudioThreshold(val) {
    this.audioThreshold = parseInt(val, 10);
    this.dom.audioThresholdVal.textContent = `${val}%`;
    this.dom.audioThresholdMarker.style.left = `${val}%`;
  }

  setStarterSound(type) {
    this.starterSoundType = type; // 'gunshot' | 'beep'
    const btnG = document.getElementById('btnSoundGunshot');
    const btnB = document.getElementById('btnSoundBeep');
    if (btnG && btnB) {
      if (type === 'gunshot') {
        btnG.className = "px-2.5 py-1 rounded text-xs font-bold transition bg-red-600 text-white shadow";
        btnB.className = "px-2.5 py-1 rounded text-xs font-bold transition text-slate-400 hover:text-white";
      } else {
        btnG.className = "px-2.5 py-1 rounded text-xs font-bold transition text-slate-400 hover:text-white";
        btnB.className = "px-2.5 py-1 rounded text-xs font-bold transition bg-amber-500 text-slate-950 shadow";
      }
    }
  }

  startSelfStarterSequence() {
    const btn = document.getElementById('btnSelfStarter');
    if (!btn) return;
    btn.disabled = true;

    // Immediately unlock and keep AudioContext active on iOS
    this.initAudioContext();
    let keepAliveOsc = null;
    let keepAliveGain = null;
    if (this.audioCtx) {
      try {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
        keepAliveOsc = this.audioCtx.createOscillator();
        keepAliveGain = this.audioCtx.createGain();
        keepAliveGain.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);
        keepAliveOsc.connect(keepAliveGain);
        keepAliveGain.connect(this.audioCtx.destination);
        keepAliveOsc.start();
      } catch (e) {}
    }

    const stopKeepAlive = () => {
      try {
        if (keepAliveOsc) {
          keepAliveOsc.stop();
          keepAliveOsc.disconnect();
          keepAliveOsc = null;
        }
      } catch (e) {}
    };

    window._activeUtterances = window._activeUtterances || [];

    const speak = (text, onEnd) => {
      let isDone = false;
      const done = () => {
        if (isDone) return;
        isDone = true;
        onEnd();
      };

      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'zh-TW';
          utterance.rate = 0.95;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          utterance.onend = done;
          utterance.onerror = done;
          window._activeUtterances.push(utterance);
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          done();
        }
        // Safety timeout to prevent iOS Safari GC freeze
        setTimeout(done, 1200);
      } else {
        setTimeout(done, 1000);
      }
    };

    btn.textContent = '🔊 發令中：「各就位」...';
    btn.className = "w-full py-3.5 rounded-xl bg-amber-700 text-white font-bold text-xs shadow transition flex items-center justify-center gap-2 animate-pulse";

    speak('各就位', () => {
      setTimeout(() => {
        btn.textContent = '🔊 發令中：「預備」...';
        btn.className = "w-full py-3.5 rounded-xl bg-red-700 text-white font-bold text-xs shadow transition flex items-center justify-center gap-2 animate-pulse";

        speak('預備', () => {
          // IAAF Standard random delay: 1.5s ~ 2.2s after "Set"
          const randomDelay = 1500 + Math.random() * 700;
          setTimeout(() => {
            stopKeepAlive();
            btn.textContent = '💥 鳴槍起跑 (BANG)！';
            btn.className = "w-full py-3.5 rounded-xl bg-red-600 text-white font-black text-sm shadow-xl transition flex items-center justify-center gap-2";

            // Trigger the explosion gunshot sound, visual flash, vibration & start signal
            this.senderSendTrigger();

            setTimeout(() => {
              btn.disabled = false;
              btn.textContent = '📢 啟動自動發令程序（各就位 ➜ 預備 ➜ 鳴槍）';
              btn.className = "w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition flex items-center justify-center gap-2";
            }, 1200);
          }, randomDelay);
        });
      }, 1500);
    });
  }

  triggerZeroTest() {
    const localNow = performance.now();
    const transitDelay = (this.meanRtt && this.meanRtt > 0 && this.meanRtt < 200) ? (this.meanRtt / 2) : 5;

    // Trigger local gunshot/beep audio & visual flash
    this.playGunshotAudio();
    this.showZeroTestFlash();
    if (navigator.vibrate) navigator.vibrate([150, 50, 150]);

    if (this.role === 'start') {
      // Running on Start Sender Phone
      if (this.peerConnection && this.peerConnection.open) {
        this.peerConnection.send({
          type: 'zero_test_trigger',
          transitDelay: transitDelay
        });
        this.showToast('⚡ 歸零測試訊號已發送！終點機已同步啟動計時與攝影', 'success');
      } else {
        this.showToast('⚡ 歸零閃光已觸發 (未連線終點機)', 'warn');
      }
    } else {
      // Running on Finish Host Phone directly
      this.handleStartTrigger({
        source: 'zero_test',
        timestamp: localNow
      });
      this.showToast('⚡ 本機歸零測試啟動！計時與狹縫攝影已同步開始', 'success');
    }
  }

  showZeroTestFlash() {
    const overlay = this.dom.zeroTestFlashOverlay;
    if (!overlay) return;
    overlay.classList.remove('hidden');
    
    // Play 1kHz test beep
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch(e){}

    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 150);
  }

  updateZeroOffsetDisplay() {
    if (this.dom.zeroOffsetDisplay) {
      const sign = this.zeroOffsetMs >= 0 ? '+' : '';
      this.dom.zeroOffsetDisplay.textContent = `${sign}${(this.zeroOffsetMs / 1000).toFixed(3)}s`;
    }
  }

  adjustZeroOffset(deltaMs) {
    this.zeroOffsetMs = Math.round((this.zeroOffsetMs + deltaMs) * 10) / 10;
    localStorage.setItem('profinish_zero_offset', this.zeroOffsetMs.toFixed(1));
    this.updateZeroOffsetDisplay();
    const sign = this.zeroOffsetMs >= 0 ? '+' : '';
    this.showToast(`🎯 歸零校正偏移量已調整為：${sign}${(this.zeroOffsetMs / 1000).toFixed(3)}s`, 'info');
  }

  resetZeroOffset() {
    this.zeroOffsetMs = 0;
    localStorage.setItem('profinish_zero_offset', '0');
    this.updateZeroOffsetDisplay();
    this.showToast('🎯 歸零校正偏移量已重設為 +0.000s', 'info');
  }

  calibrateZeroFromCurrentCursor() {
    if (!this.sliceIndex || this.sliceIndex.length === 0) {
      this.showToast('請先進行歸零測試並在畫卷上定位閃光前端', 'warn');
      return;
    }
    const deltaSec = this.currentCursorTimeSec;
    // To make currentCursorTimeSec become 0.000s, effectiveStartTime needs to be shifted forward by deltaSec
    this.zeroOffsetMs = Math.round((this.zeroOffsetMs + deltaSec * 1000) * 10) / 10;
    localStorage.setItem('profinish_zero_offset', this.zeroOffsetMs.toFixed(1));
    this.updateZeroOffsetDisplay();

    // Recalibrate current sliceIndex on the fly
    this.sliceIndex.forEach(slice => {
      slice.timeSec -= deltaSec;
    });
    this.updateCursorPosition(this.currentCursorPixelX);
    
    const sign = this.zeroOffsetMs >= 0 ? '+' : '';
    this.showToast(`🎯 已將閃光前端校正為 00:00.000！(總偏移補償: ${sign}${(this.zeroOffsetMs / 1000).toFixed(3)}s)`, 'success');
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playGunshotAudio() {
    try {
      this.initAudioContext();
      const ctx = this.audioCtx;
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      if (this.starterSoundType === 'beep') {
        // Electronic Starter Tone: 1800Hz loud, sharp piercing beep
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, now);
        osc.frequency.setValueAtTime(1800, now + 0.35);

        gain.gain.setValueAtTime(3.0, now);
        gain.gain.setValueAtTime(3.0, now + 0.35);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.40);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.42);
        return;
      }

      // REALISTIC STARTER GUNSHOT (💥 震撼發令槍火藥爆鳴)
      // 1. Initial Shockwave Crack (超高速火藥破片破空音)
      const crackDuration = 0.08;
      const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * crackDuration), ctx.sampleRate);
      const crackData = crackBuf.getChannelData(0);
      for (let i = 0; i < crackData.length; i++) {
        crackData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.009));
      }
      const crackSource = ctx.createBufferSource();
      crackSource.buffer = crackBuf;

      const crackFilter = ctx.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.setValueAtTime(1800, now);

      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(4.0, now);
      crackGain.gain.exponentialRampToValueAtTime(0.01, now + crackDuration);

      crackSource.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(ctx.destination);
      crackSource.start(now);

      // 2. Heavy Gunpowder Explosion Body (火藥爆轟重擊: 800Hz 瞬間墜至 50Hz)
      const boomOsc = ctx.createOscillator();
      const boomGain = ctx.createGain();
      boomOsc.type = 'sawtooth';
      boomOsc.frequency.setValueAtTime(800, now);
      boomOsc.frequency.exponentialRampToValueAtTime(50, now + 0.15);

      const boomFilter = ctx.createBiquadFilter();
      boomFilter.type = 'lowpass';
      boomFilter.frequency.setValueAtTime(900, now);
      boomFilter.frequency.exponentialRampToValueAtTime(180, now + 0.20);

      boomGain.gain.setValueAtTime(4.5, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      boomOsc.connect(boomFilter);
      boomFilter.connect(boomGain);
      boomGain.connect(ctx.destination);
      boomOsc.start(now);
      boomOsc.stop(now + 0.25);

      // 3. Open Track Stadium Reverb / Distance Echo (田徑場空曠大回音)
      const reverbDuration = 0.75;
      const reverbBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * reverbDuration), ctx.sampleRate);
      const reverbData = reverbBuf.getChannelData(0);
      for (let i = 0; i < reverbData.length; i++) {
        reverbData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.16));
      }
      const reverbSource = ctx.createBufferSource();
      reverbSource.buffer = reverbBuf;

      const reverbFilter = ctx.createBiquadFilter();
      reverbFilter.type = 'bandpass';
      reverbFilter.frequency.setValueAtTime(1200, now);
      reverbFilter.frequency.linearRampToValueAtTime(300, now + reverbDuration);
      reverbFilter.Q.setValueAtTime(1.0, now);

      const reverbGain = ctx.createGain();
      reverbGain.gain.setValueAtTime(2.2, now);
      reverbGain.gain.exponentialRampToValueAtTime(0.001, now + reverbDuration);

      reverbSource.connect(reverbFilter);
      reverbFilter.connect(reverbGain);
      reverbGain.connect(ctx.destination);
      reverbSource.start(now);

    } catch (e) {
      console.warn('Gunshot sound playback error:', e);
    }
  }

  /* ========================================================================== */
  /* MEET STORE, CSV & PROOF PHOTO EXPORT                                       */
  /* ========================================================================== */

  setDistance(dist) {
    this.currentDistance = parseInt(dist, 10);
    const heat = this.heatData[this.currentHeat];
    if (heat) {
      heat.distance = this.currentDistance;
    }

    [60, 100, 200].forEach(d => {
      const btn = document.getElementById(`btnDist${d}`);
      if (btn) {
        if (d === this.currentDistance) {
          btn.className = "py-2 rounded-lg bg-red-600 text-white font-bold shadow transition";
        } else {
          btn.className = "py-2 rounded-lg text-slate-400 hover:text-white transition";
        }
      }
    });

    this.updateSoundDelayDisplay();
    this.updateHudBadge();
  }

  calculateSoundDelay() {
    // Speed of sound: v = 331.3 + 0.606 * T
    const v = 331.3 + 0.606 * this.temperature;
    return this.currentDistance / v;
  }

  updateSoundDelayDisplay() {
    const v = 331.3 + 0.606 * this.temperature;
    const delay = this.currentDistance / v;
    if (this.dom.soundSpeedVal) this.dom.soundSpeedVal.textContent = v.toFixed(1);
    if (this.dom.soundDelayDeductVal) this.dom.soundDelayDeductVal.textContent = `-${delay.toFixed(2)}s`;
  }

  toggleSoundComp(checked) {
    this.enableSoundComp = checked;
  }

  setTemperature(temp) {
    this.temperature = parseFloat(temp) || 25;
    this.updateSoundDelayDisplay();
  }

  switchHeat(heatKey, broadcastPeer = true) {
    let resolvedKey = heatKey;
    if (!this.heatData[resolvedKey]) {
      const found = Object.values(this.heatData).find(
        h => h && (String(h.uid) === String(heatKey) || String(h.id) === String(heatKey))
      );
      if (found) {
        resolvedKey = found.uid || found.id;
      } else {
        resolvedKey = (typeof heatKey === 'string' && isNaN(Number(heatKey))) ? heatKey : (parseInt(heatKey, 10) || heatKey);
      }
    }

    this.currentHeat = resolvedKey;
    this.initDefaultHeatData(this.currentHeat);
    const heat = this.heatData[this.currentHeat];
    if (heat && heat.distance) {
      this.currentDistance = heat.distance;
    }

    [this.dom.selectHeat, this.dom.reviewSelectHeat, this.dom.senderSelectHeat].forEach(sel => {
      if (sel) sel.value = String(this.currentHeat);
    });

    [60, 100, 200].forEach(d => {
      const btn = document.getElementById(`btnDist${d}`);
      if (btn) {
        if (d === this.currentDistance) {
          btn.className = "py-2 rounded-lg bg-red-600 text-white font-bold shadow transition";
        } else {
          btn.className = "py-2 rounded-lg text-slate-400 hover:text-white transition";
        }
      }
    });

    this.recalculateRanks();
    this.renderLanesTable();
    this.updateHudBadge();
    if (this.sliceIndex.length === 0) {
      this.drawDemoCanvasGrid();
    }

    if (broadcastPeer && this.peerConnection && this.peerConnection.open) {
      this.peerConnection.send({
        type: 'heat_changed',
        heatKey: this.currentHeat
      });
    }
  }

  stepHeat(delta) {
    const keys = (this.orderedHeatKeys && this.orderedHeatKeys.length > 0)
      ? this.orderedHeatKeys
      : Object.keys(this.heatData);
    if (keys.length === 0) return;

    let idx = keys.findIndex(k => String(k) === String(this.currentHeat));
    if (idx === -1) idx = 0;
    const nextIdx = Math.max(0, Math.min(keys.length - 1, idx + delta));
    if (nextIdx !== idx) {
      this.switchHeat(keys[nextIdx]);
    }
  }

  addNewHeat() {
    const nextHeat = Object.keys(this.heatData).length + 1;
    this.initDefaultHeatData(nextHeat);

    [this.dom.selectHeat, this.dom.reviewSelectHeat, this.dom.senderSelectHeat].forEach(sel => {
      if (sel) {
        const opt = document.createElement('option');
        opt.value = nextHeat;
        opt.text = `第 ${nextHeat} 組`;
        opt.selected = true;
        sel.appendChild(opt);
      }
    });
    if (this.orderedHeatKeys) {
      this.orderedHeatKeys.push(String(nextHeat));
    }

    this.switchHeat(nextHeat);
  }

  generateNewRoomCode() {
    this.roomCode = String(Math.floor(1000 + Math.random() * 9000));
    this.dom.myRoomCodeDisplay.textContent = this.roomCode;
    if (this.peer) {
      this.peer.destroy();
      this.initFinishHostPeer();
    }
  }

  setSlitWidth(val) {
    this.sliceWidth = parseInt(val, 10);
  }

  setAutoDelay(val) {
    this.autoDelaySeconds = Math.max(0, parseFloat(val) || 0);
  }

  openSettingsModal() {
    this.dom.settingsModal.classList.remove('hidden');
  }

  closeSettingsModal() {
    this.dom.settingsModal.classList.add('hidden');
  }

  importCsvModal() {
    this.dom.csvImportModal.classList.remove('hidden');
  }

  closeCsvModal() {
    this.dom.csvImportModal.classList.add('hidden');
  }

  triggerSafeBlobDownload(blob, fileName) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    // Delay revoking URL so mobile/desktop browser download stream does not abort or trigger page unload
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 15000);
  }

  downloadSampleCsv() {
    const csvContent = "\uFEFF組別,項目,道次,班級,姓名,號碼衣\n" +
      "1,100m,1,六年一班,陳小明,紅\n" +
      "1,100m,2,六年二班,林阿豪,藍\n" +
      "1,100m,3,六年三班,張志偉,黃\n" +
      "1,100m,4,六年四班,黃冠宇,紫\n" +
      "1,100m,5,六年五班,李宗翰,橘\n" +
      "1,100m,6,六年六班,王俊傑,綠\n";
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.triggerSafeBlobDownload(blob, "profinish_sample_roster.csv");
  }

  handleCsvFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      
      const heat = this.heatData[this.currentHeat];
      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim());
        if (parts.length >= 6) {
          const laneNum = parseInt(parts[2], 10);
          const lane = heat.lanes.find(l => l.lane === laneNum);
          if (lane) {
            lane.grade = parts[3];
            lane.name = parts[4];
            lane.bib = parts[5];
          }
        }
      }

      this.renderLanesTable();
      this.closeCsvModal();
      this.showToast('✅ 道次學生名單已成功匯入！', 'success');
    };
    reader.readAsText(file);
  }

  exportResultsCsv() {
    const heat = this.heatData[this.currentHeat];
    if (!heat) return;
    const heatId = heat.id || this.currentHeat;
    const eventTitle = heat.eventTitle || `${this.currentDistance}m`;

    let csv = "\uFEFF組別,項目,道次,班級,姓名,號碼衣,官方成績,名次\n";
    heat.lanes.forEach(l => {
      csv += `${heatId},${eventTitle},${l.lane},${l.grade},${l.name},${l.bib},${l.officialTime || '-'},${l.rank}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    this.triggerSafeBlobDownload(blob, `ProFinish_第${heatId}組_${eventTitle}_成績總表.csv`);
    this.showToast(`📊 第 ${heatId} 組 CSV 成績單已匯出`, 'success');
  }

  exportPhotoFinishProof() {
    const srcCanvas = this.dom.slitCanvas;
    if (!srcCanvas || srcCanvas.width <= 10) {
      this.showToast('尚未有終點影像可匯出！', 'warn');
      return;
    }

    const heat = this.heatData[this.currentHeat];
    const heatId = (heat && heat.id) ? heat.id : this.currentHeat;
    const eventTitle = (heat && heat.eventTitle) ? heat.eventTitle : `${this.currentDistance} 公尺`;
    
    // Create composite export canvas
    const expCanvas = document.createElement('canvas');
    const headerHeight = 90;
    const footerHeight = 120;
    expCanvas.width = srcCanvas.width;
    expCanvas.height = srcCanvas.height + headerHeight + footerHeight;

    const ctx = expCanvas.getContext('2d');

    // Background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, expCanvas.width, expCanvas.height);

    // Header Title
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(0, 0, expCanvas.width, 6);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('🏃‍♂️ 校園運動會田徑賽事 · 官方終點攝影壓線判決證明', 20, 38);

    ctx.font = '13px monospace';
    ctx.fillStyle = '#94a3b8';
    const nowStr = new Date().toLocaleString('zh-TW');
    ctx.fillText(`項目: ${eventTitle} | 組別: 第 ${heatId} 組 | 系統: ProFinish PWA v2.0 | 產生時間: ${nowStr}`, 20, 64);

    // Draw main slit scan image
    ctx.drawImage(srcCanvas, 0, headerHeight);

    // Footer Table with Official Results
    const tableTop = headerHeight + srcCanvas.height + 15;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(10, tableTop - 5, expCanvas.width - 20, footerHeight - 20);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('官方判定成績：', 25, tableTop + 16);

    let colX = 130;
    if (heat && Array.isArray(heat.lanes)) {
      heat.lanes.forEach(l => {
        if (l.officialTime) {
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 12px monospace';
          const vestLabel = l.bib ? `(${l.bib})` : '';
          ctx.fillText(`[${l.rank}名] ${l.lane}道${vestLabel} ${l.name} (${l.grade}) - ${l.officialTime}s`, colX, tableTop + 16);
          colX += 240;
        }
      });
    }

    const fileName = `ProFinish_第${heatId}組_${eventTitle}_壓線判定圖.png`;

    // Download PNG locally using async toBlob (non-blocking to preserve WebRTC P2P connection)
    expCanvas.toBlob((blob) => {
      this.triggerSafeBlobDownload(blob, fileName);
      this.showToast(`📸 第 ${heatId} 組壓線證明圖已儲存！`, 'success');

      // Silently upload lightweight JPEG proof to PC backend in background without blocking main thread
      setTimeout(() => {
        try {
          const proofDataUrl = expCanvas.toDataURL('image/jpeg', 0.82);
          this.syncCurrentHeatToBackend(false, proofDataUrl);
        } catch (e) {
          console.warn('Proof sync skipped:', e);
        }
      }, 350);
    }, 'image/png');
  }

  /* ========================================================================== */
  /* PC BACKEND ADMIN REAL-TIME SYNC (與電腦端後台雙向同步名單、道次與成績)          */
  /* ========================================================================== */

  async initBackendSync() {
    await this.fetchBackendMeetData(true);

    const configuredBackend = localStorage.getItem('profinish_backend_url') || '';
    if (location.hostname.endsWith('github.io') && !configuredBackend) return;

    try {
      const targetUrl = configuredBackend ? `${configuredBackend.replace(/\/+$/, '')}/api/events` : '/api/events';
      const es = new EventSource(targetUrl);
      es.onerror = () => { es.close(); };
      es.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'active_heat_changed') {
            await this.fetchBackendMeetData(false);
            if (this.raceState !== 'running' && msg.payload) {
              const targetKey = msg.payload.activeHeatUid || msg.payload.activeHeatId;
              if (targetKey) this.switchHeat(targetKey);
            }
          } else if (msg.type === 'meet_updated') {
            await this.fetchBackendMeetData(false);
          }
        } catch (e) {}
      };
    } catch (err) {
      console.warn('SSE backend connection unavailable:', err);
    }
  }

  async fetchBackendMeetData(switchToActive = false) {
    try {
      const configuredBackend = localStorage.getItem('profinish_backend_url') || '';
      let res = null;
      if (configuredBackend) {
        res = await fetch(`${configuredBackend.replace(/\/+$/, '')}/api/meet`, { cache: 'no-store' }).catch(() => null);
      }
      if (!res || !res.ok) {
        res = await fetch('/api/meet', { cache: 'no-store' }).catch(() => null);
      }
      if (!res || !res.ok) {
        res = await fetch('./meet_data.json', { cache: 'no-store' }).catch(() => null);
      }
      let meet = null;
      if (res && res.ok) {
        meet = await res.json().catch(() => null);
      }
      if (meet && Array.isArray(meet.heats) && meet.heats.length > 0) {
        // Cache latest roster locally so tablet/phone keep data even if server/tunnel goes offline
        try { localStorage.setItem('profinish_meet_cache', JSON.stringify(meet)); } catch (e) {}
      } else {
        try { meet = JSON.parse(localStorage.getItem('profinish_meet_cache') || 'null'); } catch (e) { meet = null; }
        if (meet) this.showToast('⚠️ 無法連線伺服器，已載入本機最後一次的分組名單', 'warn');
      }
      if (!meet || !Array.isArray(meet.heats) || meet.heats.length === 0) return;

      // Sort heats by schedule order: Date -> Low Grade -> Girls First
      meet.heats.sort((a, b) => this.compareHeatsBySchedule(a, b));

      // Remove initial dummy placeholder heat 1 if it has no uid/eventTitle
      if (this.heatData[1] && !this.heatData[1].uid && !this.heatData[1].eventTitle) {
        delete this.heatData[1];
      }

      this.orderedHeatKeys = meet.heats.map(h => String(h.uid || h.id));

      // Update all heat selector dropdowns (Tools Drawer, Review Drawer, Start Sender View)
      const selects = [this.dom.selectHeat, this.dom.reviewSelectHeat, this.dom.senderSelectHeat].filter(Boolean);
      selects.forEach(sel => {
        sel.innerHTML = '';
        meet.heats.forEach(h => {
          const opt = document.createElement('option');
          opt.value = String(h.uid || h.id);
          const dateTag = h.raceDate ? `[${h.raceDate.slice(5)}] ` : '';
          const roundTag = h.roundName ? ` (${h.roundName})` : '';
          opt.textContent = `${dateTag}第 ${h.id} 組 · ${h.eventTitle || (h.distance + 'm')}${roundTag}`;
          sel.appendChild(opt);
        });
      });

      meet.heats.forEach(h => {
        const key = String(h.uid || h.id);
        const existing = this.heatData[key] || {};
        this.heatData[key] = {
          ...existing,
          id: h.id,
          uid: h.uid,
          eventTitle: h.eventTitle,
          roundName: h.roundName,
          raceDate: h.raceDate || '',
          distance: h.distance || 100,
          status: h.status || 'ready',
          lanes: (h.lanes || []).slice(0, 6).map(l => ({
            lane: l.lane,
            grade: l.grade || '',
            name: l.name || '',
            bib: l.bib || '',
            rawTime: l.rawTime !== undefined ? l.rawTime : null,
            officialTime: l.officialTime || '',
            rank: l.rank || '-',
            status: l.status || 'OK'
          }))
        };
      });

      if (switchToActive || !this.heatData[this.currentHeat]) {
        let targetHeat = null;
        if (meet.activeHeatUid) {
          targetHeat = meet.heats.find(h => h.uid === meet.activeHeatUid);
        }
        if (!targetHeat && meet.activeHeatId) {
          targetHeat = meet.heats.find(h => String(h.id) === String(meet.activeHeatId));
        }
        if (!targetHeat) {
          targetHeat = meet.heats[0];
        }
        if (targetHeat) {
          this.switchHeat(targetHeat.uid || targetHeat.id, false);
        }
      } else {
        const cur = this.heatData[this.currentHeat];
        if (cur && cur.distance) {
          this.currentDistance = cur.distance;
        }
        selects.forEach(sel => {
          sel.value = String(this.currentHeat);
        });
        this.recalculateRanks();
        this.renderLanesTable();
        this.updateHudBadge();
        if (this.sliceIndex.length === 0) {
          this.drawDemoCanvasGrid();
        }
      }
    } catch (err) {
      console.warn('Backend meet fetch skipped:', err);
    }
  }

  async syncCurrentHeatToBackend(withToast = false, customProofDataUrl = null) {
    const heat = this.heatData[this.currentHeat];
    if (!heat) return;

    // 1. Always update local storage cache immediately so results are never lost (without heavy base64 images)
    try {
      const cached = JSON.parse(localStorage.getItem('profinish_meet_cache') || 'null');
      if (cached && Array.isArray(cached.heats)) {
        const idx = cached.heats.findIndex(h => String(h.uid || h.id) === String(heat.uid || heat.id));
        if (idx !== -1) {
          const { proofImage: _omit, ...lightHeat } = heat;
          cached.heats[idx] = { ...cached.heats[idx], ...lightHeat };
          delete cached.heats[idx].proofImage;
        }
        localStorage.setItem('profinish_meet_cache', JSON.stringify(cached));
      }
    } catch (e) {}

    let proofImage = customProofDataUrl;
    if (!proofImage && withToast && this.dom.slitCanvas && this.dom.slitCanvas.width > 10) {
      try {
        proofImage = this.dom.slitCanvas.toDataURL('image/jpeg', 0.82);
      } catch (e) {}
    }

    const isStaticHost = location.hostname.endsWith('github.io');
    const configuredBackend = localStorage.getItem('profinish_backend_url') || '';
    const targetUrl = configuredBackend 
      ? `${configuredBackend.replace(/\/+$/, '')}/api/heat-result`
      : '/api/heat-result';

    // If on GitHub Pages and no custom backend IP configured
    if (isStaticHost && !configuredBackend) {
      if (withToast) {
        this.showGitHubSyncModal(heat);
      }
      return;
    }

    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          heatId: heat.id || this.currentHeat,
          uid: heat.uid,
          raceDate: heat.raceDate,
          eventTitle: heat.eventTitle,
          distance: this.currentDistance,
          lanes: heat.lanes,
          proofImage: proofImage || undefined
        })
      });
      if (res.ok && withToast) {
        this.showToast(`☁️ 已成功將「第 ${heat.id || this.currentHeat} 組」成績與壓線圖同步至電腦後台！`, 'success');
      } else if (!res.ok && withToast) {
        if (isStaticHost) {
          this.showGitHubSyncModal(heat);
        } else {
          this.showToast('⚠️ 同步至電腦後台失敗，本組成績已安全保存在本機', 'warn');
        }
      }
    } catch (err) {
      if (withToast) {
        if (isStaticHost) {
          this.showGitHubSyncModal(heat);
        } else {
          this.showToast('⚠️ 無法連線電腦後台，本組成績已安全保存在本機', 'warn');
        }
      }
    }
  }

  showGitHubSyncModal(heat) {
    const heatId = heat.id || this.currentHeat;
    let modal = document.getElementById('ghSyncModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ghSyncModal';
      modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4';
      document.body.appendChild(modal);
    }
    const currentBackend = localStorage.getItem('profinish_backend_url') || '';
    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-4 shadow-2xl flex flex-col gap-3 text-slate-100 text-xs">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <span class="font-bold text-sm text-emerald-400 flex items-center gap-1.5">
            <span>✅</span> 本組成績已保存在平板！
          </span>
          <button onclick="document.getElementById('ghSyncModal').classList.add('hidden')" class="text-slate-400 hover:text-white text-base">✕</button>
        </div>
        <p class="text-[11px] text-slate-300 leading-relaxed">
          您目前使用的是 <b>GitHub 雲端版</b>。本組（第 ${heatId} 組）成績已完整記錄在平板中，<b>絕不遺失</b>！
        </p>
        <div class="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-2">
          <span class="text-[10px] text-slate-400 font-semibold">📤 傳遞本組成績至司令台 / 電腦：</span>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="app.exportResultsCsv()" class="py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-center flex items-center justify-center gap-1">
              <span>📊</span> 成績單 (CSV)
            </button>
            <button onclick="app.exportPhotoFinishProof()" class="py-2 px-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-center flex items-center justify-center gap-1">
              <span>📸</span> 壓線證明圖
            </button>
          </div>
        </div>
        <div class="border-t border-slate-800 pt-2 flex flex-col gap-1.5">
          <span class="text-[10px] text-slate-400">🔗 若操場與司令台同 Wi-Fi，可填寫電腦 IP 自動回傳：</span>
          <div class="flex gap-1.5">
            <input type="text" id="inputBackendHostIp" value="${currentBackend}" placeholder="例 http://163.19.131.70:8080" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-white outline-none">
            <button onclick="app.saveCustomBackendUrl()" class="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-bold text-[11px] text-white">儲存</button>
          </div>
        </div>
        <button onclick="document.getElementById('ghSyncModal').classList.add('hidden')" class="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-slate-200 text-xs mt-1">
          關閉視窗
        </button>
      </div>
    `;
    modal.classList.remove('hidden');
  }

  saveCustomBackendUrl() {
    const input = document.getElementById('inputBackendHostIp');
    if (!input) return;
    const val = input.value.trim();
    if (val) {
      localStorage.setItem('profinish_backend_url', val);
      alert('已儲存司令台電腦網址！之後點擊傳回後台將自動同步至該電腦。');
    } else {
      localStorage.removeItem('profinish_backend_url');
      alert('已清除自訂電腦網址。');
    }
    const modal = document.getElementById('ghSyncModal');
    if (modal) modal.classList.add('hidden');
  }

  getGradeOrder(title) {
    if (!title) return 99;
    if (title.includes('一年級') || title.includes('1年級')) return 1;
    if (title.includes('二年級') || title.includes('2年級')) return 2;
    if (title.includes('三年級') || title.includes('3年級')) return 3;
    if (title.includes('四年級') || title.includes('4年級')) return 4;
    if (title.includes('五年級') || title.includes('5年級')) return 5;
    if (title.includes('六年級') || title.includes('6年級')) return 6;
    if (title.includes('七年級') || title.includes('7年級')) return 7;
    if (title.includes('八年級') || title.includes('8年級')) return 8;
    if (title.includes('九年級') || title.includes('9年級')) return 9;
    return 50;
  }

  getGenderOrder(title) {
    if (!title) return 99;
    if (title.includes('女')) return 1;
    if (title.includes('男')) return 2;
    return 3;
  }

  getStageOrder(roundName) {
    if (!roundName) return 1;
    if (roundName.includes('預賽')) return 1;
    if (roundName.includes('準決賽') || roundName.includes('複賽')) return 2;
    if (roundName.includes('決賽')) return 3;
    return 1;
  }

  getHeatNumber(roundName, id) {
    if (roundName) {
      const match = roundName.match(/第\s*(\d+)\s*組/);
      if (match) return parseInt(match[1], 10);
    }
    return typeof id === 'number' ? id : 1;
  }

  compareHeatsBySchedule(a, b) {
    const dateA = a.raceDate && a.raceDate.trim() ? a.raceDate.trim() : '9999-99-99';
    const dateB = b.raceDate && b.raceDate.trim() ? b.raceDate.trim() : '9999-99-99';
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const gradeA = this.getGradeOrder(a.eventTitle);
    const gradeB = this.getGradeOrder(b.eventTitle);
    if (gradeA !== gradeB) return gradeA - gradeB;

    const genderA = this.getGenderOrder(a.eventTitle);
    const genderB = this.getGenderOrder(b.eventTitle);
    if (genderA !== genderB) return genderA - genderB;

    const distA = a.distance || 0;
    const distB = b.distance || 0;
    if (distA !== distB) return distA - distB;

    const stageA = this.getStageOrder(a.roundName);
    const stageB = this.getStageOrder(b.roundName);
    if (stageA !== stageB) return stageA - stageB;

    const heatNumA = this.getHeatNumber(a.roundName, a.id);
    const heatNumB = this.getHeatNumber(b.roundName, b.id);
    if (heatNumA !== heatNumB) return heatNumA - heatNumB;

    return (a.id || 0) - (b.id || 0);
  }
}

// Global App Instance
const app = new ProFinishApp();
window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
