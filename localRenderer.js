import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const FPS = 24;
const FRAME_DURATION_US = Math.round(1_000_000 / FPS);
const PLAYBACK_RATE = 2;

const CODEC_PROFILES = [
  'avc1.640033',
  'avc1.640032',
  'avc1.64002A',
  'avc1.640029',
  'avc1.640028',
  'avc1.4D4028',
  'avc1.424028',
  'avc1.42E01E',
];

async function pickSupportedCodec(width, height) {
  for (const codec of CODEC_PROFILES) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec, width, height,
        framerate: FPS,
        bitrate: 16_000_000,
        hardwareAcceleration: 'prefer-hardware',
      });
      if (result.supported) return result.config?.codec ?? codec;
    } catch {}
  }
  return 'avc1.640033';
}

function seekAndWait(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) { resolve(); return; }
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = time;
  });
}

function drawFrame(ctx, v1, v2, label1, label2, showLabels, outW, outH) {
  const halfW = outW / 2;
  ctx.drawImage(v1, 0, 0, halfW, outH);
  ctx.drawImage(v2, halfW, 0, halfW, outH);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(halfW, 0); ctx.lineTo(halfW, outH); ctx.stroke();
  if (!showLabels) return;
  const padX = 14;
  const padY = outH - 16;
  const fontSize = Math.max(14, Math.round(outH * 0.025));
  ctx.font = `bold ${fontSize}px "Inter","Segoe UI",sans-serif`;
  ctx.textBaseline = 'bottom';
  const m1 = ctx.measureText(label1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(padX - 4, padY - fontSize - 2, m1.width + 8, fontSize + 6);
  ctx.fillStyle = '#fff'; ctx.fillText(label1, padX, padY + 4);
  const m2 = ctx.measureText(label2);
  const x2 = outW - padX - m2.width;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x2 - 4, padY - fontSize - 2, m2.width + 8, fontSize + 6);
  ctx.fillStyle = '#fff'; ctx.fillText(label2, x2, padY + 4);
}

async function encodeVideoPhase({ videoBase, videoOverlay, startTime, endTime, outW, outH, label1, label2, showLabels, onProgress }) {
  const codec = await pickSupportedCodec(outW, outH);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: outW, height: outH },
    fastStart: 'in-memory',
  });

  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encoderError = e; },
  });

  encoder.configure({
    codec, width: outW, height: outH,
    framerate: FPS,
    bitrate: 16_000_000,
    bitrateMode: 'constant',
    hardwareAcceleration: 'prefer-hardware',
  });

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');

  await seekAndWait(videoBase, startTime);
  await seekAndWait(videoOverlay, startTime);

  const totalFrames = Math.round((endTime - startTime) * FPS);

  const useRVFC = typeof videoBase.requestVideoFrameCallback === 'function';

  if (useRVFC) {
    return new Promise((resolve, reject) => {
      let frameIndex = 0;
      let done = false;

      const stop = () => {
        done = true;
        videoBase.pause();
        videoOverlay.pause();
        videoBase.playbackRate = 1;
        videoOverlay.playbackRate = 1;
      };

      const processFrame = (now, metadata) => {
        if (done) return;
        if (encoderError) { stop(); reject(encoderError); return; }

        const mediaTime = metadata.mediaTime;

        if (mediaTime >= endTime || frameIndex >= totalFrames) {
          stop();
          encoder.flush()
            .then(() => { encoder.close(); muxer.finalize(); resolve(muxer.target.buffer); })
            .catch(reject);
          return;
        }

        const drift = videoOverlay.currentTime - mediaTime;
        if (Math.abs(drift) > 1.5 / FPS) videoOverlay.currentTime = mediaTime;

        drawFrame(ctx, videoBase, videoOverlay, label1, label2, showLabels, outW, outH);

        const timestamp = frameIndex * FRAME_DURATION_US;
        const vf = new VideoFrame(canvas, { timestamp, duration: FRAME_DURATION_US });
        try {
          encoder.encode(vf, { keyFrame: frameIndex % (FPS * 2) === 0 });
        } finally {
          vf.close();
        }

        if (encoderError) { stop(); reject(encoderError); return; }

        frameIndex++;
        onProgress({ phase: 'video', current: frameIndex, total: totalFrames });
        videoBase.requestVideoFrameCallback(processFrame);
      };

      videoBase.playbackRate = PLAYBACK_RATE;
      videoOverlay.playbackRate = PLAYBACK_RATE;
      videoBase.requestVideoFrameCallback(processFrame);
      videoBase.play().catch(reject);
      videoOverlay.play().catch(reject);
    });
  }

  for (let f = 0; f < totalFrames; f++) {
    if (encoderError) throw encoderError;
    const t = startTime + f / FPS;
    await seekAndWait(videoBase, t);
    if (encoderError) throw encoderError;
    await seekAndWait(videoOverlay, t);
    if (encoderError) throw encoderError;
    drawFrame(ctx, videoBase, videoOverlay, label1, label2, showLabels, outW, outH);
    const timestamp = f * FRAME_DURATION_US;
    const vf = new VideoFrame(canvas, { timestamp, duration: FRAME_DURATION_US });
    try { encoder.encode(vf, { keyFrame: f % (FPS * 2) === 0 }); } finally { vf.close(); }
    if (encoderError) throw encoderError;
    onProgress({ phase: 'video', current: f + 1, total: totalFrames });
    if (encoder.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 0));
  }

  if (encoderError) throw encoderError;
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  return muxer.target.buffer;
}

async function muxAudioPhase({ silentBuffer, audioSourceFile, onProgress }) {
  onProgress({ phase: 'audio', label: 'Cargando ffmpeg.wasm...' });
  const ffmpeg = new FFmpeg();
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  onProgress({ phase: 'audio', label: 'Muxeando audio...' });
  await ffmpeg.writeFile('silent.mp4', new Uint8Array(silentBuffer));
  await ffmpeg.writeFile('source.mp4', await fetchFile(audioSourceFile));
  await ffmpeg.exec(['-i', 'silent.mp4', '-i', 'source.mp4', '-c:v', 'copy', '-c:a', 'copy', '-map', '0:v:0', '-map', '1:a:0', '-shortest', 'output.mp4']);
  const data = await ffmpeg.readFile('output.mp4');
  return data.buffer;
}

export async function startLocalRender({ videoBase, videoOverlay, audioSourceFile, startTime, endTime, qualityHeight, label1, label2, showLabels, onProgress, onDone, onError }) {
  try {
    const aspect = videoBase.videoWidth / videoBase.videoHeight || 16 / 9;
    const outH = qualityHeight;
    const halfW = Math.round((outH * aspect) / 2) * 2;
    const outW = halfW * 2;

    videoBase.pause();
    videoOverlay.pause();

    const silentBuffer = await encodeVideoPhase({ videoBase, videoOverlay, startTime, endTime, outW, outH, label1, label2, showLabels, onProgress });

    let finalBuffer;
    if (audioSourceFile) {
      finalBuffer = await muxAudioPhase({ silentBuffer, audioSourceFile, onProgress });
    } else {
      finalBuffer = silentBuffer;
    }

    const blob = new Blob([finalBuffer], { type: 'video/mp4' });
    onDone(URL.createObjectURL(blob));
  } catch (err) {
    onError(err);
  }
}
