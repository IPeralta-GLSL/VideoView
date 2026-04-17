const slider = document.getElementById('comparison-slider');
const overlayContainer = document.getElementById('video-overlay-container');
const sliderHandle = document.getElementById('slider-handle');
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

let isPlaying = false;
let duration = 0;
let dragCounter = 0;
let isDraggingTimeline = false;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

slider.addEventListener('input', (e) => {
  const val = e.target.value;
  overlayContainer.style.clipPath = `polygon(0% 0%, ${val}% 0%, ${val}% 100%, 0% 100%)`;
  sliderHandle.style.left = `${val}%`;
});

const formatTime = (timeInSeconds) => {
  if (isNaN(timeInSeconds)) return "00:00:00:00";
  const h = Math.floor(timeInSeconds / 3600);
  const m = Math.floor((timeInSeconds % 3600) / 60);
  const s = Math.floor(timeInSeconds % 60);
  const f = Math.floor((timeInSeconds % 1) * 24);
  const pad = (num) => num.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
};

const updateTimeline = () => {
  if (videoBase.readyState > 0) {
    const current = isDraggingTimeline ? parseFloat(timelineSlider.value) : videoBase.currentTime;
    const pct = (current / duration) * 100;
    playhead.style.left = `${pct}%`;
    if (!isDraggingTimeline) {
      timelineSlider.value = current;
    }
    currentTimeDisplay.textContent = formatTime(current);
  }
};

videoBase.addEventListener('loadedmetadata', () => {
  duration = videoBase.duration;
  durationTimeDisplay.textContent = formatTime(duration);
  timelineSlider.max = duration;
  updateTimeline();
});

videoBase.addEventListener('timeupdate', () => {
  if (!isDraggingTimeline) {
    updateTimeline();
    if (Math.abs(videoBase.currentTime - videoOverlay.currentTime) > 0.1) {
      videoOverlay.currentTime = videoBase.currentTime;
    }
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
  const t = parseFloat(timelineSlider.value);
  videoBase.currentTime = t;
  videoOverlay.currentTime = t;
});

timelineSlider.addEventListener('touchend', () => {
  isDraggingTimeline = false;
  const t = parseFloat(timelineSlider.value);
  videoBase.currentTime = t;
  videoOverlay.currentTime = t;
});

timelineSlider.addEventListener('input', () => {
  updateTimeline();
});

const togglePlayPause = () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  if (isPlaying) {
    videoBase.pause();
    videoOverlay.pause();
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  } else {
    videoBase.play();
    videoOverlay.play();
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
  }
  isPlaying = !isPlaying;
};

btnPlayPause.addEventListener('click', togglePlayPause);

btnStart.addEventListener('click', () => {
  videoBase.currentTime = 0;
  videoOverlay.currentTime = 0;
  updateTimeline();
});

volTrack1.addEventListener('input', (e) => {
  videoBase.volume = e.target.value;
});

volTrack2.addEventListener('input', (e) => {
  videoOverlay.volume = e.target.value;
});

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
    
    ctx.fillStyle = '#8bf236';
    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = channelData[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  } catch (error) {
    ctx.fillStyle = '#444';
    ctx.fillRect(0, canvas.height / 2, canvas.width, 1);
  }
};

const handleDrop = (e, videoElement, canvas) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    videoElement.src = url;
    videoElement.load();
    drawStaticWaveform(url, canvas);
    if (isPlaying) togglePlayPause();
  }
};

dropLeft.addEventListener('dragenter', () => dropLeft.classList.add('drag-over'));
dropLeft.addEventListener('dragleave', () => dropLeft.classList.remove('drag-over'));
dropLeft.addEventListener('drop', (e) => handleDrop(e, videoBase, canvasWave1));

dropRight.addEventListener('dragenter', () => dropRight.classList.add('drag-over'));
dropRight.addEventListener('dragleave', () => dropRight.classList.remove('drag-over'));
dropRight.addEventListener('drop', (e) => handleDrop(e, videoOverlay, canvasWave2));

window.addEventListener('load', () => {
  drawStaticWaveform(videoBase.querySelector('source').src, canvasWave1);
  drawStaticWaveform(videoOverlay.querySelector('source').src, canvasWave2);
});
