const slider = document.getElementById('comparison-slider');
const overlayContainer = document.getElementById('video-overlay-container');
const sliderHandle = document.getElementById('slider-handle');
const viewerContainer = document.getElementById('viewer-container');
const wipeAngleInput = document.getElementById('wipe-angle-input');
const wipeAngleDisplay = document.getElementById('wipe-angle-display');
const wipeResetBtn = document.getElementById('wipe-reset-btn');
const snapGuideV = document.getElementById('snap-guide-v');
const snapGuideH = document.getElementById('snap-guide-h');
const videoBase = document.getElementById('video-base');
const videoOverlay = document.getElementById('video-overlay');
const btnStart = document.getElementById('btn-start');
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const currentTimeDisplay = document.getElementById('current-time');
const durationTimeDisplay = document.getElementById('duration-time');
const timelineSlider = document.getElementById('timeline-slider');
const playhead = document.getElementById('playhead');
const dropOverlay = document.getElementById('drop-overlay');
const dropLeft = document.getElementById('drop-left');
const dropRight = document.getElementById('drop-right');
const volTrack1 = document.getElementById('vol-track1');
const volTrack2 = document.getElementById('vol-track2');
const canvasWave1 = document.getElementById('canvas-waveform-1');
const canvasWave2 = document.getElementById('canvas-waveform-2');
const track1Name = document.getElementById('track1-name');
const track2Name = document.getElementById('track2-name');
const bufferBar1 = document.getElementById('buffer-bar-1');
const bufferBar2 = document.getElementById('buffer-bar-2');
const masterMeterCanvas = document.getElementById('master-meter');
const masterDbDisplay = document.getElementById('master-db');
const masterFader = document.getElementById('master-fader');

const drawBufferBar = (canvas, video) => {
  const dur = video.duration;
  if (!dur || isNaN(dur)) return;
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (!w || !h) return;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, w, h);
  const buffered = video.buffered;
  for (let i = 0; i < buffered.length; i++) {
    const x = (buffered.start(i) / dur) * w;
    const bw = ((buffered.end(i) - buffered.start(i)) / dur) * w;
    ctx.fillStyle = '#8bf236';
    ctx.fillRect(x, 0, bw, h);
  }
  const pos = (video.currentTime / dur) * w;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.max(0, pos - 1), 0, 2, h);
};

const updateBufferBars = () => {
  drawBufferBar(bufferBar1, videoBase);
  drawBufferBar(bufferBar2, videoOverlay);
};

videoBase.addEventListener('progress', updateBufferBars);
videoOverlay.addEventListener('progress', updateBufferBars);
videoBase.addEventListener('timeupdate', updateBufferBars);
videoOverlay.addEventListener('timeupdate', updateBufferBars);
videoBase.addEventListener('loadedmetadata', updateBufferBars);
videoOverlay.addEventListener('loadedmetadata', updateBufferBars);
window.addEventListener('resize', () => { updateBufferBars(); drawTimeRuler(); });

let isPlaying = false;
let duration = 0;
let dragCounter = 0;
let isDraggingTimeline = false;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioInitialized = false;
let gainNode1, gainNode2, masterGainNode, masterAnalyser, analyser1, analyser2;
let muted1 = false, muted2 = false;
let soloed1 = false, soloed2 = false;
let savedGain1 = 1, savedGain2 = 1;

const dbToLinear = (db) => db <= -60 ? 0 : Math.pow(10, db / 20);

const timeRulerCanvas = document.getElementById('time-ruler');

const drawTimeRuler = () => {
  const c = timeRulerCanvas;
  if (!c || !duration) return;
  const w = c.offsetWidth;
  const h = c.offsetHeight || 20;
  if (!w) return;
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '9px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;

  if (timecodeMode === 'frames') {
    const totalFrames = Math.floor(duration * 24);
    let majorInterval, minorInterval;
    if (totalFrames <= 120) { majorInterval = 24; minorInterval = 6; }
    else if (totalFrames <= 720) { majorInterval = 120; minorInterval = 24; }
    else if (totalFrames <= 4320) { majorInterval = 240; minorInterval = 48; }
    else { majorInterval = 1440; minorInterval = 240; }
    for (let f = 0; f <= totalFrames; f += minorInterval) {
      const x = Math.round((f / totalFrames) * w) + 0.5;
      const isMajor = f % majorInterval === 0;
      ctx.beginPath();
      ctx.strokeStyle = isMajor ? '#555' : '#333';
      ctx.moveTo(x, isMajor ? 2 : h - 5);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (isMajor && x > 4) {
        ctx.fillStyle = '#777';
        ctx.fillText(`F${f}`, x + 2, h - 5);
      }
    }
  } else {
    let majorInterval, minorInterval;
    if (duration <= 30) { majorInterval = 5; minorInterval = 1; }
    else if (duration <= 300) { majorInterval = 30; minorInterval = 5; }
    else if (duration <= 1800) { majorInterval = 60; minorInterval = 10; }
    else { majorInterval = 300; minorInterval = 30; }
    for (let t = 0; t <= duration; t += minorInterval) {
      const x = Math.round((t / duration) * w) + 0.5;
      const isMajor = Math.round(t) % majorInterval === 0;
      ctx.beginPath();
      ctx.strokeStyle = isMajor ? '#555' : '#333';
      ctx.moveTo(x, isMajor ? 2 : h - 5);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (isMajor && x > 4) {
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        const label = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
        ctx.fillStyle = '#777';
        ctx.fillText(label, x + 2, h - 5);
      }
    }
  }
};

const drawMasterMeter = () => {
  let db = -Infinity;
  if (masterAnalyser) {
    const buf = new Float32Array(masterAnalyser.fftSize);
    masterAnalyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  const c = masterMeterCanvas;
  const rect = c.getBoundingClientRect();
  const w = rect.width || c.offsetWidth || 20;
  const h = rect.height || c.offsetHeight || 200;
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  const minDb = -60, maxDb = 6;
  const range = maxDb - minDb;
  const segments = 40;
  const segH = h / segments;
  const gap = Math.max(1, Math.floor(segH * 0.12));
  for (let i = 0; i < segments; i++) {
    const segDb = maxDb - (i / segments) * range;
    const active = db >= segDb - (range / segments);
    if (segDb > 0) ctx.fillStyle = active ? '#e84040' : '#3a1010';
    else if (segDb > -6) ctx.fillStyle = active ? '#e8b040' : '#3a2a10';
    else ctx.fillStyle = active ? '#8bf236' : '#1a3010';
    ctx.fillRect(0, i * segH, w, segH - gap);
  }

  masterDbDisplay.textContent = isFinite(db) ? `${db.toFixed(1)} dB` : '-∞ dB';
  requestAnimationFrame(drawMasterMeter);
};

drawMasterMeter();

const initAudio = () => {
  if (audioInitialized) return;
  const source1 = audioCtx.createMediaElementSource(videoBase);
  const source2 = audioCtx.createMediaElementSource(videoOverlay);
  gainNode1 = audioCtx.createGain();
  gainNode2 = audioCtx.createGain();
  masterGainNode = audioCtx.createGain();
  masterAnalyser = audioCtx.createAnalyser();
  masterAnalyser.fftSize = 1024;
  gainNode1.gain.value = parseFloat(volTrack1.value);
  gainNode2.gain.value = parseFloat(volTrack2.value);
  masterGainNode.gain.value = dbToLinear(parseFloat(masterFader.value));
  analyser1 = audioCtx.createAnalyser();
  analyser1.fftSize = 256;
  analyser2 = audioCtx.createAnalyser();
  analyser2.fftSize = 256;
  source1.connect(gainNode1);
  source2.connect(gainNode2);
  gainNode1.connect(analyser1);
  gainNode2.connect(analyser2);
  gainNode1.connect(masterGainNode);
  gainNode2.connect(masterGainNode);
  masterGainNode.connect(masterAnalyser);
  masterAnalyser.connect(audioCtx.destination);
  audioInitialized = true;
};

masterFader.addEventListener('input', () => {
  const db = parseFloat(masterFader.value);
  masterDbDisplay.textContent = `${db.toFixed(1)} dB`;
  if (masterGainNode) masterGainNode.gain.value = dbToLinear(db);
});

const pauseVideos = () => {
  videoBase.pause();
  videoOverlay.pause();
};

const seekBoth = (t) => {
  videoBase.currentTime = t;
  videoOverlay.currentTime = t;
};

let syncRafId = null;

const syncLoop = () => {
  if (!isPlaying) return;
  const drift = videoBase.currentTime - videoOverlay.currentTime;
  if (Math.abs(drift) > 0.05) {
    videoOverlay.currentTime = videoBase.currentTime;
  } else if (Math.abs(drift) > 0.01) {
    videoOverlay.playbackRate = videoBase.playbackRate * (1 + drift * 2);
  } else {
    videoOverlay.playbackRate = videoBase.playbackRate;
  }
  syncRafId = requestAnimationFrame(syncLoop);
};

const playVideos = () => {
  const t = videoBase.currentTime;
  videoOverlay.currentTime = t;
  Promise.all([
    videoBase.play(),
    videoOverlay.play()
  ]).catch(() => {});
  if (syncRafId) cancelAnimationFrame(syncRafId);
  syncRafId = requestAnimationFrame(syncLoop);
};

let wipeX = 0;
let wipeY = 0;
let wipeAngle = 0;

const updateWipe = () => {
  const rect = viewerContainer.getBoundingClientRect();
  const W = rect.width || viewerContainer.offsetWidth || 800;
  const H = rect.height || viewerContainer.offsetHeight || 450;
  const θ = wipeAngle * Math.PI / 180;
  const sinθ = Math.sin(θ);
  const cosθ = Math.cos(θ);
  const BIG = Math.sqrt(W * W + H * H);
  const lx = W / 2 + wipeX;
  const ly = H / 2 + wipeY;
  const ax = lx - sinθ * BIG, ay = ly + cosθ * BIG;
  const bx = lx + sinθ * BIG, by = ly - cosθ * BIG;
  const dx = ax - cosθ * BIG, dy = ay - sinθ * BIG;
  const ex = bx - cosθ * BIG, ey = by - sinθ * BIG;
  const px = v => `${(v / W * 100).toFixed(3)}%`;
  const py = v => `${(v / H * 100).toFixed(3)}%`;
  overlayContainer.style.clipPath =
    `polygon(${px(ax)} ${py(ay)}, ${px(dx)} ${py(dy)}, ${px(ex)} ${py(ey)}, ${px(bx)} ${py(by)})`;
  sliderHandle.style.left = `${(lx / W * 100).toFixed(3)}%`;
  sliderHandle.style.top = `${(ly / H * 100).toFixed(3)}%`;
  sliderHandle.style.transform = `translate(-50%, -50%) rotate(${wipeAngle}deg)`;
  sliderHandle.style.height = `${Math.max(W, H) * 2}px`;
  wipeAngleDisplay.textContent = `${Math.round(wipeAngle)}°`;
  wipeAngleInput.value = Math.round(wipeAngle);
  const pct = (Math.round(wipeAngle) / 180) * 100;
  wipeAngleInput.style.background = `linear-gradient(to right, #8bf236 0%, #8bf236 ${pct}%, #2a2a2a ${pct}%, #2a2a2a 100%)`;
};

updateWipe();
window.addEventListener('resize', updateWipe);

wipeAngleInput.addEventListener('input', () => {
  wipeAngle = Math.max(0, Math.min(180, parseFloat(wipeAngleInput.value)));
  updateWipe();
});

wipeResetBtn.addEventListener('click', () => {
  wipeAngle = 0;
  wipeX = 0;
  wipeY = 0;
  updateWipe();
});

let isDraggingWipe = false;

viewerContainer.addEventListener('pointerdown', (e) => {
  if (viewerContainer.classList.contains('sbs-mode')) return;
  if (dropOverlay.classList.contains('active')) return;
  if (e.target.closest('.wipe-toolbar')) return;
  isDraggingWipe = true;
  viewerContainer.setPointerCapture(e.pointerId);
  const rect = viewerContainer.getBoundingClientRect();
  wipeX = e.clientX - rect.left - rect.width / 2;
  wipeY = e.clientY - rect.top - rect.height / 2;
  updateWipe();
});

const SNAP_THRESHOLD = 8;

viewerContainer.addEventListener('pointermove', (e) => {
  if (!isDraggingWipe) return;
  const rect = viewerContainer.getBoundingClientRect();
  wipeX = e.clientX - rect.left - rect.width / 2;
  wipeY = e.clientY - rect.top - rect.height / 2;

  const normAngle = wipeAngle % 180;
  const isVertical = normAngle < 5 || normAngle > 175;
  const isHorizontal = normAngle > 85 && normAngle < 95;

  let snappedV = false;
  let snappedH = false;

  if (isVertical && Math.abs(wipeX) < SNAP_THRESHOLD) {
    wipeX = 0;
    snappedV = true;
  }
  if (isHorizontal && Math.abs(wipeY) < SNAP_THRESHOLD) {
    wipeY = 0;
    snappedH = true;
  }

  const snapped = snappedV || snappedH;
  snapGuideV.classList.toggle('active', snapped);
  snapGuideH.classList.toggle('active', snapped);

  updateWipe();
});

viewerContainer.addEventListener('pointerup', () => {
  isDraggingWipe = false;
  snapGuideV.classList.remove('active');
  snapGuideH.classList.remove('active');
});
viewerContainer.addEventListener('pointercancel', () => {
  isDraggingWipe = false;
  snapGuideV.classList.remove('active');
  snapGuideH.classList.remove('active');
});

viewerContainer.addEventListener('wheel', (e) => {
  if (viewerContainer.classList.contains('sbs-mode')) return;
  if (!e.ctrlKey) return;
  e.preventDefault();
  wipeAngle = ((wipeAngle + (e.deltaY > 0 ? 10 : -10)) + 180) % 180;
  updateWipe();
}, { passive: false });

const formatTime = (timeInSeconds) => {
  if (isNaN(timeInSeconds)) return "00:00:00:00";
  const h = Math.floor(timeInSeconds / 3600);
  const m = Math.floor((timeInSeconds % 3600) / 60);
  const s = Math.floor(timeInSeconds % 60);
  const f = Math.floor((timeInSeconds % 1) * 24);
  const pad = (num) => num.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
};

const formatFrame = (timeInSeconds) => {
  if (isNaN(timeInSeconds)) return 'F 0';
  return `F ${Math.floor(timeInSeconds * 24)}`;
};

let timecodeMode = 'time';
const btnTimecodeMode = document.getElementById('btn-timecode-mode');

btnTimecodeMode.addEventListener('click', () => {
  timecodeMode = timecodeMode === 'time' ? 'frames' : 'time';
  btnTimecodeMode.classList.toggle('active', timecodeMode === 'frames');
  updateTimeline();
  if (duration) durationTimeDisplay.textContent = timecodeMode === 'frames' ? formatFrame(duration) : formatTime(duration);
  drawTimeRuler();
});

const updateTimeline = () => {
  if (videoBase.readyState > 0) {
    const current = isDraggingTimeline ? parseFloat(timelineSlider.value) : videoBase.currentTime;
    const pct = (current / duration) * 100;
    playhead.style.left = `${pct}%`;
    if (!isDraggingTimeline) {
      timelineSlider.value = current;
    }
    currentTimeDisplay.textContent = timecodeMode === 'frames' ? formatFrame(current) : formatTime(current);
  }
};

videoBase.addEventListener('loadedmetadata', () => {
  duration = videoBase.duration;
  durationTimeDisplay.textContent = timecodeMode === 'frames' ? formatFrame(duration) : formatTime(duration);
  timelineSlider.max = duration;
  updateTimeline();
  drawTimeRuler();
});

videoBase.addEventListener('timeupdate', () => {
  if (!isDraggingTimeline) {
    updateTimeline();
  }
});

videoBase.addEventListener('seeked', () => {
  if (Math.abs(videoBase.currentTime - videoOverlay.currentTime) > 0.01) {
    videoOverlay.currentTime = videoBase.currentTime;
  }
});

videoBase.addEventListener('ended', () => {
  isPlaying = false;
  iconPlay.style.display = 'block';
  iconPause.style.display = 'none';
});

timelineSlider.addEventListener('mousedown', () => isDraggingTimeline = true);
timelineSlider.addEventListener('touchstart', () => isDraggingTimeline = true);

timelineSlider.addEventListener('mouseup', () => {
  isDraggingTimeline = false;
  seekBoth(parseFloat(timelineSlider.value));
});

timelineSlider.addEventListener('touchend', () => {
  isDraggingTimeline = false;
  seekBoth(parseFloat(timelineSlider.value));
});

timelineSlider.addEventListener('input', () => {
  updateTimeline();
});

const togglePlayPause = () => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  initAudio();
  if (isPlaying) {
    pauseVideos();
    if (syncRafId) { cancelAnimationFrame(syncRafId); syncRafId = null; }
    videoOverlay.playbackRate = videoBase.playbackRate;
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  } else {
    playVideos();
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
  }
  isPlaying = !isPlaying;
};

btnPlayPause.addEventListener('click', togglePlayPause);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayPause();
  }
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

btnStart.addEventListener('click', () => {
  seekBoth(0);
  updateTimeline();
});

const FRAME_DUR = 1 / 24;
const btnPrevFrame = document.getElementById('btn-prev-frame');
const btnNextFrame = document.getElementById('btn-next-frame');
const playbackSpeed = document.getElementById('playback-speed');

btnPrevFrame.addEventListener('click', () => {
  if (!duration) return;
  if (isPlaying) togglePlayPause();
  seekBoth(Math.max(0, videoBase.currentTime - FRAME_DUR));
});

btnNextFrame.addEventListener('click', () => {
  if (!duration) return;
  if (isPlaying) togglePlayPause();
  seekBoth(Math.min(duration, videoBase.currentTime + FRAME_DUR));
});

playbackSpeed.addEventListener('change', () => {
  const rate = parseFloat(playbackSpeed.value);
  videoBase.playbackRate = rate;
  videoOverlay.playbackRate = rate;
  if (!isPlaying) videoOverlay.currentTime = videoBase.currentTime;
});

const updateSliderFill = (input) => {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 1;
  const val = parseFloat(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to right, #8bf236 0%, #8bf236 ${pct}%, #2a2a2a ${pct}%, #2a2a2a 100%)`;
};

volTrack1.addEventListener('input', (e) => {
  updateSliderFill(e.target);
  applySoloMute();
});

volTrack2.addEventListener('input', (e) => {
  updateSliderFill(e.target);
  applySoloMute();
});

updateSliderFill(volTrack1);
updateSliderFill(volTrack2);

const btnMute1 = document.getElementById('btn-mute-1');
const btnMute2 = document.getElementById('btn-mute-2');
const btnSolo1 = document.getElementById('btn-solo-1');
const btnSolo2 = document.getElementById('btn-solo-2');
const trackVu1 = document.getElementById('track-vu-1');
const trackVu2 = document.getElementById('track-vu-2');

const applySoloMute = () => {
  const anySolo = soloed1 || soloed2;
  const g1 = (!muted1 && (!anySolo || soloed1)) ? (gainNode1 ? parseFloat(volTrack1.value) : null) : 0;
  const g2 = (!muted2 && (!anySolo || soloed2)) ? (gainNode2 ? parseFloat(volTrack2.value) : null) : 0;
  if (gainNode1) gainNode1.gain.value = g1 ?? 0;
  else videoBase.volume = g1 ?? 0;
  if (gainNode2) gainNode2.gain.value = g2 ?? 0;
  else videoOverlay.volume = g2 ?? 0;
};

btnMute1.addEventListener('click', () => {
  muted1 = !muted1;
  btnMute1.classList.toggle('active', muted1);
  applySoloMute();
});

btnMute2.addEventListener('click', () => {
  muted2 = !muted2;
  btnMute2.classList.toggle('active', muted2);
  applySoloMute();
});

btnSolo1.addEventListener('click', () => {
  soloed1 = !soloed1;
  btnSolo1.classList.toggle('active', soloed1);
  applySoloMute();
});

btnSolo2.addEventListener('click', () => {
  soloed2 = !soloed2;
  btnSolo2.classList.toggle('active', soloed2);
  applySoloMute();
});

const drawTrackVu = (canvas, analyser, muted) => {
  const w = canvas.offsetWidth || 8;
  const h = canvas.offsetHeight || 40;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);
  if (!analyser || muted) return;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const minDb = -60, maxDb = 0;
  const level = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
  const fillH = Math.round(level * h);
  const y = h - fillH;
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#8bf236');
  grad.addColorStop(0.7, '#e8b040');
  grad.addColorStop(1, '#e84040');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, w, fillH);
};

const drawTrackVus = () => {
  drawTrackVu(trackVu1, analyser1, muted1);
  drawTrackVu(trackVu2, analyser2, muted2);
  requestAnimationFrame(drawTrackVus);
};

drawTrackVus();

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) {
    dropOverlay.classList.remove('active');
  }
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');
  dropLeft.classList.remove('drag-over');
  dropRight.classList.remove('drag-over');
});

const drawStaticWaveform = async (url, canvas) => {
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const step = Math.ceil(channelData.length / canvas.width);
    const amp = canvas.height / 2;

    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = channelData[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      const hue = Math.round((i / canvas.width) * 300);
      ctx.fillStyle = `hsl(${hue}, 100%, 55%)`;
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  } catch (error) {
    ctx.fillStyle = '#262626';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#555';
    ctx.font = '11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No audio', canvas.width / 2, canvas.height / 2);
  }
};

const handleDrop = (e, videoElement, canvas, nameElement) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    videoElement.src = url;
    videoElement.load();
    nameElement.textContent = file.name;
    drawStaticWaveform(url, canvas);
    if (isPlaying) togglePlayPause();
  }
};

dropLeft.addEventListener('dragenter', () => dropLeft.classList.add('drag-over'));
dropLeft.addEventListener('dragleave', () => dropLeft.classList.remove('drag-over'));
dropLeft.addEventListener('drop', (e) => handleDrop(e, videoBase, canvasWave1, track1Name));

dropRight.addEventListener('dragenter', () => dropRight.classList.add('drag-over'));
dropRight.addEventListener('dragleave', () => dropRight.classList.remove('drag-over'));
dropRight.addEventListener('drop', (e) => handleDrop(e, videoOverlay, canvasWave2, track2Name));

window.addEventListener('load', () => {
  drawStaticWaveform(videoBase.querySelector('source').src, canvasWave1);
  drawStaticWaveform(videoOverlay.querySelector('source').src, canvasWave2);
});

const btnToggleView = document.getElementById('btn-toggle-view');
let viewMode = 'slider';

const wipeToolbar = document.getElementById('wipe-toolbar');

btnToggleView.addEventListener('click', () => {
  if (viewMode === 'slider') {
    viewMode = 'sbs';
    viewerContainer.classList.add('sbs-mode');
    wipeToolbar.style.display = 'none';
    btnToggleView.textContent = 'Toggle View';
  } else {
    viewMode = 'slider';
    viewerContainer.classList.remove('sbs-mode');
    wipeToolbar.style.display = '';
    btnToggleView.textContent = 'Toggle View';
  }
});

const btnRender = document.getElementById('btn-render');
const renderSettingsModal = document.getElementById('render-settings-modal');
const renderModal = document.getElementById('render-modal');
const renderProgress = document.getElementById('render-progress');
const renderStatus = document.getElementById('render-status');
const hwStatus = document.getElementById('render-hw-status');
const renderQuality = document.getElementById('render-quality');
const renderCodec = document.getElementById('render-codec');
const renderFormatDisplay = document.getElementById('render-format-display');

const getMimeType = (codec) => {
  const candidates = {
    vp9: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm'],
    vp8: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'],
    h264: ['video/x-matroska;codecs=avc1,opus', 'video/x-matroska;codecs=avc1', 'video/webm;codecs=h264,opus', 'video/webm;codecs=h264', 'video/webm'],
    av1: ['video/webm;codecs=av01,opus', 'video/webm;codecs=av01', 'video/webm'],
  };
  for (const mime of (candidates[codec] || ['video/webm'])) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
};

const getExt = (mimeType) => {
  if (mimeType.startsWith('video/mp4')) return 'mp4';
  if (mimeType.startsWith('video/x-matroska')) return 'mkv';
  return 'webm';
};

const updateFormatDisplay = () => {
  const mime = getMimeType(renderCodec.value);
  const ext = getExt(mime);
  renderFormatDisplay.textContent = `${mime.split(';')[0]} → .${ext}`;
};

const checkHardwareAccel = async () => {
  hwStatus.textContent = '';
  updateFormatDisplay();
  if (!window.VideoEncoder) return;
  const codecMap = { vp9: 'vp09.00.10.08', vp8: 'vp8', h264: 'avc1.42001f', av1: 'av01.0.04M.08' };
  try {
    const result = await VideoEncoder.isConfigSupported({
      codec: codecMap[renderCodec.value] || 'avc1.42001f',
      width: 1920,
      height: 1080,
      hardwareAcceleration: 'prefer-hardware',
    });
    hwStatus.textContent = result.supported ? 'GPU acceleration: enabled' : 'Software encoding (CPU)';
  } catch {
    hwStatus.textContent = '';
  }
};

btnRender.addEventListener('click', () => {
  renderSettingsModal.classList.add('active');
  checkHardwareAccel();
});

renderCodec.addEventListener('change', checkHardwareAccel);
updateFormatDisplay();

document.getElementById('btn-render-cancel').addEventListener('click', () => {
  renderSettingsModal.classList.remove('active');
});

document.getElementById('btn-render-confirm').addEventListener('click', () => {
  renderSettingsModal.classList.remove('active');
  startRender();
});

const startRender = () => {
  if (!audioInitialized) initAudio();

  const qualityHeight = parseInt(renderQuality.value);
  const codec = renderCodec.value;
  const mimeType = getMimeType(codec);
  const ext = getExt(mimeType);
  const bitrateMap = { 2160: 40000000, 1080: 16000000, 720: 8000000, 480: 4000000 };
  const bitrate = bitrateMap[qualityHeight] || 8000000;

  if (isPlaying) togglePlayPause();
  videoBase.currentTime = 0;
  videoOverlay.currentTime = 0;

  const vbH = videoBase.videoHeight || 1080;
  const vbW = videoBase.videoWidth || 1920;
  const voH = videoOverlay.videoHeight || 1080;
  const voW = videoOverlay.videoWidth || 1920;
  const scale1 = qualityHeight / vbH;
  const scale2 = qualityHeight / voH;
  const fw1 = Math.round(vbW * scale1);
  const fw2 = Math.round(voW * scale2);
  const fw = fw1 + fw2;
  const fh = qualityHeight;

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = fw;
  renderCanvas.height = fh;
  const ctx = renderCanvas.getContext('2d');

  const stream = renderCanvas.captureStream(30);
  const audioDest = audioCtx.createMediaStreamDestination();
  masterAnalyser.disconnect(audioCtx.destination);
  masterGainNode.connect(audioDest);
  audioDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks = [];

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  renderModal.classList.add('active');
  renderStatus.textContent = 'Preparing...';
  renderProgress.style.width = '0%';

  const onRenderProgress = () => {
    const pct = (videoBase.currentTime / duration) * 100;
    renderProgress.style.width = `${pct}%`;
    renderStatus.textContent = `Rendering: ${Math.floor(pct)}%`;
  };

  const onRenderEnded = () => {
    if (recorder.state === 'recording') recorder.stop();
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `render.${ext}`;
    a.click();
    renderModal.classList.remove('active');
    masterGainNode.disconnect(audioDest);
    masterAnalyser.connect(audioCtx.destination);
    videoBase.removeEventListener('timeupdate', onRenderProgress);
    videoBase.removeEventListener('ended', onRenderEnded);
  };

  videoBase.addEventListener('timeupdate', onRenderProgress);
  videoBase.addEventListener('ended', onRenderEnded);

  const drawFrame = () => {
    if (recorder.state !== 'recording') return;
    const drift = Math.abs(videoBase.currentTime - videoOverlay.currentTime);
    if (drift > 0.033) videoOverlay.currentTime = videoBase.currentTime;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, fw, fh);
    ctx.drawImage(videoBase, 0, 0, fw1, fh);
    ctx.drawImage(videoOverlay, fw1, 0, fw2, fh);
    setTimeout(drawFrame, 0);
  };

  recorder.start();
  setTimeout(() => {
    playVideos();
    drawFrame();
  }, 200);
};
