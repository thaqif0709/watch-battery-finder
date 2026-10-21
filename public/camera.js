// Camera preview, spirit level, zoom and capture.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can\'t open the camera here (it needs HTTPS). Use "Phone cam" or "Upload" instead.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.track = this.stream.getVideoTracks()[0];
    // Continuous autofocus where supported; helps with close caseback shots.
    try {
      const caps = this.track.getCapabilities?.() ?? {};
      if (caps.focusMode?.includes('continuous')) await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {}
    return this;
  }

  zoomRange() {
    const caps = this.track?.getCapabilities?.() ?? {};
    return caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : null;
  }

  async setZoom(z) {
    try {
      await this.track.applyConstraints({ advanced: [{ zoom: z }] });
    } catch {}
  }

  // Grabs the full-resolution frame, cropped to the square the user sees.
  capture() {
    const v = this.video;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) throw new Error('Camera not ready yet.');
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    canvas.getContext('2d').drawImage(v, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
    return canvas;
  }
}

// Phone lying flat, screen up, camera pointing down at the table: beta ≈ 0 and gamma ≈ 0.
export function watchLevel(onChange) {
  let active = false;
  const handler = (e) => {
    if (e.beta == null || e.gamma == null) return;
    active = true;
    const beta = e.beta;
    const gamma = e.gamma;
    onChange({ beta, gamma, tilt: Math.hypot(beta, gamma) });
  };
  const start = async () => {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    // iOS asks for permission, and only from a tap.
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    window.addEventListener('deviceorientation', handler);
    return true;
  };
  return { start, isActive: () => active, stop: () => window.removeEventListener('deviceorientation', handler) };
}

// Image (canvas, File, or Blob) -> resized JPEG base64 (without the data: prefix) + preview URL.
export async function toJpeg(source, maxSide = 1600, quality = 0.88) {
  const img = source instanceof HTMLCanvasElement ? source : await loadImage(source);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  return { dataUrl, base64: dataUrl.split(',')[1], width: c.width, height: c.height, canvas: c };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}
