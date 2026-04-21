import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const storage = multer.diskStorage({
  destination: tempDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '')}`)
});
const upload = multer({ storage });

const jobs = new Map();

app.post('/api/render', upload.fields([{ name: 'video1', maxCount: 1 }, { name: 'video2', maxCount: 1 }]), (req, res) => {
  const jobId = Date.now().toString();
  
  if (!req.files || !req.files.video1 || !req.files.video2) {
    return res.status(400).json({ error: 'Missing videos' });
  }

  const v1Path = req.files.video1[0].path;
  const v2Path = req.files.video2[0].path;
  const outPath = path.join(tempDir, `${jobId}-out.mp4`);

  const { qualityHeight, vol1, vol2, masterVol, showLabels, label1, label2, isLinux, totalDuration } = req.body;
  const qH = parseInt(qualityHeight) || 1080;
  const fw1 = Math.round(qH * (1920/1080));
  const fw2 = Math.round(qH * (1920/1080));
  const totalW = fw1 + fw2;
  const labelH = showLabels === 'true' ? Math.round(qH * 0.055) : 0;
  const totalH = qH + labelH;

  const isLinuxServer = process.platform === 'linux';
  const fontFile = isLinuxServer ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : '/Windows/Fonts/arialbd.ttf';
  const v1Vol = parseFloat(vol1) || 1.0;
  const v2Vol = parseFloat(vol2) || 1.0;
  const mVol = parseFloat(masterVol) || 1.0;
  const dur = parseFloat(totalDuration) || 0;

  let filter = `[0:v]scale=-1:${qH}[v0];[1:v]scale=-1:${qH}[v1];[v0][v1]hstack=inputs=2[v_stack];`;
  
  if (showLabels === 'true') {
    filter += `[v_stack]pad=width=${totalW}:height=${totalH}:x=0:y=0:color=black[padded];`;
    filter += `[padded]drawtext=fontfile='${fontFile}':text='${label1}':x=(${fw1}-tw)/2:y=${qH}+(${labelH}-th)/2:fontcolor=white:fontsize=${Math.round(labelH*0.55)},`;
    filter += `drawtext=fontfile='${fontFile}':text='${label2}':x=${fw1}+(${fw2}-tw)/2:y=${qH}+(${labelH}-th)/2:fontcolor=white:fontsize=${Math.round(labelH*0.55)}[v_final];`;
  } else {
    filter += `[v_stack]copy[v_final];`;
  }

  filter += `[0:a]volume=${v1Vol}[a0];[1:a]volume=${v2Vol}[a1];[a0][a1]amix=inputs=2:duration=longest[amixed];[amixed]volume=${mVol}[a_final]`;

  let args = [];
  let hasVaapi = false;
  if (isLinuxServer) {
    try {
      fs.accessSync('/dev/dri/renderD128', fs.constants.R_OK | fs.constants.W_OK);
      hasVaapi = true;
    } catch (e) {
      console.log('[Info] /dev/dri/renderD128 is missing or inaccessible. Falling back to CPU.');
    }
  }
  
  if (hasVaapi) {
    filter += `;[v_final]format=nv12,hwupload[v_hw]`;
    args = [
      '-y',
      '-vaapi_device', '/dev/dri/renderD128',
      '-i', v1Path,
      '-i', v2Path,
      '-filter_complex', filter,
      '-map', '[v_hw]',
      '-map', '[a_final]',
      '-c:v', 'h264_vaapi',
      '-b:v', '16M',
      '-c:a', 'aac',
      outPath
    ];
  } else if (isLinuxServer) {
    args = [
      '-y',
      '-i', v1Path,
      '-i', v2Path,
      '-filter_complex', filter,
      '-map', '[v_final]',
      '-map', '[a_final]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', '16M',
      '-c:a', 'aac',
      outPath
    ];
  } else {
    args = [
      '-y',
      '-hwaccel', 'auto',
      '-i', v1Path,
      '-i', v2Path,
      '-filter_complex', filter,
      '-map', '[v_final]',
      '-map', '[a_final]',
      '-c:v', 'h264_amf',
      '-b:v', '16M',
      '-c:a', 'aac',
      outPath
    ];
  }

  jobs.set(jobId, { status: 'rendering', progress: 0, totalDuration: dur });
  res.json({ jobId });

  const ffmpeg = spawn('ffmpeg', args);

  ffmpeg.on('error', (err) => {
    console.error('\n[FFmpeg Spawn Error]', err.message);
    console.error('VERIFY THAT FFMPEG IS INSTALLED AND IN THE SYSTEM PATH!\n');
    jobs.set(jobId, { status: 'error' });
  });

  ffmpeg.stderr.on('data', (data) => {
    const text = data.toString();
    console.log('[FFmpeg Log]', text.trim());
    const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1]);
      const m = parseInt(timeMatch[2]);
      const s = parseFloat(timeMatch[3]);
      const sec = (h * 3600) + (m * 60) + s;
      jobs.get(jobId).progress = sec;
    }
  });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      jobs.set(jobId, { status: 'done', url: `/api/download/${jobId}` });
    } else {
      jobs.set(jobId, { status: 'error' });
    }
    setTimeout(() => {
      if (fs.existsSync(v1Path)) fs.unlinkSync(v1Path);
      if (fs.existsSync(v2Path)) fs.unlinkSync(v2Path);
    }, 5000);
  });
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) res.json(job);
  else res.status(404).json({ error: 'Not found' });
});

app.get('/api/download/:id', (req, res) => {
  const outPath = path.join(tempDir, `${req.params.id}-out.mp4`);
  if (fs.existsSync(outPath)) {
    res.download(outPath, 'render.mp4', () => {
      setTimeout(() => {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        jobs.delete(req.params.id);
      }, 5000);
    });
  } else {
    res.status(404).end();
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
