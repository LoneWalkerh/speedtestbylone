/**
 * Speedtest Pro - Web Showcase Simulator & Interactive Dial Engine
 * Replicates the desktop app's 60 FPS Canvas Dial with exact geometry,
 * multi-tier scaling, analog flutter, and Web Audio SFX.
 */

class WebSpeedometer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Scale for high-DPI retina displays
    this.dpr = window.devicePixelRatio || 1;
    this.width = 380;
    this.height = 360;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    // Geometry matching desktop speedometer.py
    this.cx = this.width / 2;
    this.cy = this.height / 2 - 16;
    this.gaugeRadius = 132;
    this.baseMainRadius = 118;
    this.baseInnerRadius = 110;

    // Scales
    this.SCALE_500 = [
      [0.0, 0.00], [2.0, 0.10], [5.0, 0.22], [10.0, 0.35],
      [20.0, 0.50], [50.0, 0.65], [150.0, 0.78], [300.0, 0.89], [500.0, 1.00]
    ];
    this.LABELS_500 = [0, 2, 5, 10, 20, 50, 150, 300, 500];

    this.SCALE_1000 = [
      [0.0, 0.00], [10.0, 0.12], [50.0, 0.26], [100.0, 0.40],
      [250.0, 0.58], [500.0, 0.76], [750.0, 0.89], [1000.0, 1.00]
    ];
    this.LABELS_1000 = [0, 10, 50, 100, 250, 500, 750, 1000];

    this.maxScaleVal = 500.0;

    // State
    this.state = 'idle'; // 'idle' | 'testing' | 'finished'
    this.phase = 'DOWNLOAD'; // 'PING' | 'DOWNLOAD' | 'UPLOAD'
    this.currentValue = 0.0;
    this.targetValue = 0.0;
    this.peakValue = 0.0;

    this.idlePhase = 0.0;
    this.rotAngle1 = 0.0;
    this.rotAngle2 = 0.0;
    this.hoverProgress = 0.0;
    this.isHovered = false;
    this.flutterPhase = 0.0;

    this.speedHistory = [];
    this.maxHistory = 36;

    // Particles
    this.particles = [];
    for (let i = 0; i < 36; i++) {
      this.particles.push(this.createParticle());
    }

    // Audio SFX Synthesis
    this.audioEnabled = true;
    this.audioCtx = null;

    this.bindEvents();
    this.startLoop();
  }

  createParticle(isWarp = false) {
    const angle = Math.random() * Math.PI * 2;
    let vx, vy, maxLife, dist;
    if (isWarp) {
      dist = 10 + Math.random() * 50;
      const speed = 2.5 + Math.random() * 3.5;
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed;
      maxLife = 20 + Math.floor(Math.random() * 25);
    } else {
      dist = 40 + Math.random() * 90;
      const speed = 0.3 + Math.random() * 0.7;
      vx = -Math.sin(angle) * speed + (Math.random() - 0.5) * 0.4;
      vy = Math.cos(angle) * speed + (Math.random() - 0.5) * 0.4;
      maxLife = 50 + Math.floor(Math.random() * 60);
    }
    return {
      x: this.cx + Math.cos(angle) * dist,
      y: this.cy + Math.sin(angle) * dist,
      vx, vy,
      life: maxLife,
      maxLife,
      size: 1.2 + Math.random() * 1.6,
      colorType: Math.random() > 0.6 ? 'gold' : 'cyan'
    };
  }

  getActiveScale() {
    if (this.maxScaleVal > 500) {
      return { pts: this.SCALE_1000, labels: this.LABELS_1000 };
    }
    return { pts: this.SCALE_500, labels: this.LABELS_500 };
  }

  valToFraction(val) {
    if (val <= 0.0) return 0.0;
    const { pts } = this.getActiveScale();
    if (val >= pts[pts.length - 1][0]) return 1.0;

    for (let i = 0; i < pts.length - 1; i++) {
      const [v0, f0] = pts[i];
      const [v1, f1] = pts[i + 1];
      if (val >= v0 && val <= v1) {
        const ratio = (val - v0) / Math.max(0.0001, v1 - v0);
        return f0 + ratio * (f1 - f0);
      }
    }
    return 1.0;
  }

  fractionToPolar(frac) {
    // 225 deg (bottom-left) to -45 deg (bottom-right)
    const angleDeg = 225.0 - frac * 270.0;
    const rad = (angleDeg * Math.PI) / 180.0;
    return { x: Math.cos(rad), y: -Math.sin(rad) };
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playBeep(freq = 880, duration = 0.08, type = 'sine', gainVal = 0.15) {
    if (!this.audioEnabled || !this.audioCtx) return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {}
  }

  playCompleteChime() {
    if (!this.audioEnabled || !this.audioCtx) return;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playBeep(freq, 0.25, 'triangle', 0.12), idx * 100);
    });
  }

  bindEvents() {
    const checkHover = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dist = Math.hypot(mx - this.cx, my - this.cy);
      this.isHovered = dist <= this.baseMainRadius;
      this.canvas.style.cursor = (this.state === 'idle' && this.isHovered) ? 'pointer' : 'default';
    };

    this.canvas.addEventListener('mousemove', checkHover);
    this.canvas.addEventListener('mouseleave', () => {
      this.isHovered = false;
      this.canvas.style.cursor = 'default';
    });

    this.canvas.addEventListener('click', (e) => {
      this.initAudio();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dist = Math.hypot(mx - this.cx, my - this.cy);

      if (this.state === 'idle' && dist <= this.baseMainRadius + 15) {
        this.startSimulatedTest();
      } else if (this.state === 'finished') {
        this.resetToIdle();
      }
    });

    // Sound toggle button if present
    const sfxBtn = document.getElementById('toggleSfxBtn');
    if (sfxBtn) {
      sfxBtn.addEventListener('click', () => {
        this.audioEnabled = !this.audioEnabled;
        sfxBtn.textContent = this.audioEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
        if (this.audioEnabled) this.initAudio();
      });
    }

    // Secondary Demo trigger button
    const heroDemoBtn = document.getElementById('runDemoBtn');
    if (heroDemoBtn) {
      heroDemoBtn.addEventListener('click', () => {
        this.initAudio();
        if (this.state === 'idle') {
          this.startSimulatedTest();
        } else {
          this.resetToIdle();
          setTimeout(() => this.startSimulatedTest(), 200);
        }
      });
    }
  }

  startSimulatedTest() {
    this.state = 'testing';
    this.phase = 'PING';
    this.currentValue = 0.0;
    this.targetValue = 0.0;
    this.peakValue = 0.0;
    this.maxScaleVal = 500.0;
    this.speedHistory = [];
    this.playBeep(440, 0.12, 'sine');

    const pingValEl = document.getElementById('simPingVal');
    const dlValEl = document.getElementById('simDlVal');
    const ulValEl = document.getElementById('simUlVal');
    const gradeBadge = document.getElementById('simGradeBadge');
    if (gradeBadge) gradeBadge.textContent = 'Testing Latency & Jitter...';

    // Step 1: Ping sequence (1.2s)
    let pingTicks = 0;
    const pingInterval = setInterval(() => {
      pingTicks++;
      const p = (9 + Math.random() * 3).toFixed(0);
      if (pingValEl) pingValEl.textContent = `${p} ms`;
      this.playBeep(880 + Math.random() * 100, 0.04, 'sine', 0.05);

      if (pingTicks >= 6) {
        clearInterval(pingInterval);
        if (pingValEl) pingValEl.textContent = '11 ms';
        this.startDownloadPhase(dlValEl, ulValEl, gradeBadge);
      }
    }, 200);
  }

  startDownloadPhase(dlValEl, ulValEl, gradeBadge) {
    this.phase = 'DOWNLOAD';
    if (gradeBadge) gradeBadge.textContent = 'Testing Download Speed...';
    let elapsed = 0;
    const duration = 6500; // 6.5s
    const targetPeak = 848.5; // High speed gigabit demonstration
    if (targetPeak > 500) this.maxScaleVal = 1000.0;

    const dlInterval = setInterval(() => {
      elapsed += 80;
      const progress = Math.min(1.0, elapsed / duration);

      // S-curve ramp up with micro burst oscillations
      let curTarget = 0;
      if (progress < 0.25) {
        curTarget = Math.pow(progress / 0.25, 2) * 350;
      } else if (progress < 0.85) {
        const pMid = (progress - 0.25) / 0.6;
        curTarget = 350 + pMid * (targetPeak - 350) + Math.sin(elapsed * 0.02) * 18;
      } else {
        curTarget = targetPeak + Math.sin(elapsed * 0.03) * 8;
      }

      this.targetValue = Math.max(0, curTarget);
      this.peakValue = Math.max(this.peakValue, this.targetValue);
      this.speedHistory.push(this.targetValue);
      if (this.speedHistory.length > this.maxHistory) this.speedHistory.shift();

      if (dlValEl) dlValEl.textContent = this.currentValue.toFixed(1);

      if (elapsed >= duration) {
        clearInterval(dlInterval);
        if (dlValEl) dlValEl.textContent = targetPeak.toFixed(2);
        this.startUploadPhase(ulValEl, gradeBadge);
      }
    }, 80);
  }

  startUploadPhase(ulValEl, gradeBadge) {
    this.phase = 'UPLOAD';
    if (gradeBadge) gradeBadge.textContent = 'Testing Upload Speed...';
    this.currentValue = 0.0;
    this.targetValue = 0.0;
    this.speedHistory = [];
    this.playBeep(587.33, 0.15, 'sine');

    let elapsed = 0;
    const duration = 5500; // 5.5s
    const targetUlPeak = 742.8;

    const ulInterval = setInterval(() => {
      elapsed += 80;
      const progress = Math.min(1.0, elapsed / duration);

      let curTarget = 0;
      if (progress < 0.3) {
        curTarget = Math.pow(progress / 0.3, 2) * 280;
      } else if (progress < 0.85) {
        const pMid = (progress - 0.3) / 0.55;
        curTarget = 280 + pMid * (targetUlPeak - 280) + Math.cos(elapsed * 0.02) * 15;
      } else {
        curTarget = targetUlPeak + Math.sin(elapsed * 0.03) * 6;
      }

      this.targetValue = Math.max(0, curTarget);
      this.peakValue = Math.max(this.peakValue, this.targetValue);
      this.speedHistory.push(this.targetValue);
      if (this.speedHistory.length > this.maxHistory) this.speedHistory.shift();

      if (ulValEl) ulValEl.textContent = this.currentValue.toFixed(1);

      if (elapsed >= duration) {
        clearInterval(ulInterval);
        if (ulValEl) ulValEl.textContent = targetUlPeak.toFixed(2);
        this.finishTest(gradeBadge);
      }
    }, 80);
  }

  finishTest(gradeBadge) {
    this.state = 'finished';
    this.targetValue = 0.0;
    this.playCompleteChime();

    if (gradeBadge) {
      gradeBadge.innerHTML = '✨ <strong style="color:#00E5FF">Grade A+</strong> • Ultra-Fast Gigabit Fiber (Click Dial to Retest)';
    }
  }

  resetToIdle() {
    this.state = 'idle';
    this.phase = 'DOWNLOAD';
    this.currentValue = 0.0;
    this.targetValue = 0.0;
    this.peakValue = 0.0;
    this.maxScaleVal = 500.0;
    this.speedHistory = [];

    const gradeBadge = document.getElementById('simGradeBadge');
    if (gradeBadge) gradeBadge.textContent = 'Click "GO" to start benchmark simulation';
  }

  startLoop() {
    const render = () => {
      this.updatePhysics();
      this.draw();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  updatePhysics() {
    // Rotation angles for outer orbital tech rings
    const rotSpeed = !this.isHovered ? 0.025 : 0.065;
    this.rotAngle1 = (this.rotAngle1 + rotSpeed) % (Math.PI * 2);
    this.rotAngle2 = (this.rotAngle2 - rotSpeed * 1.3) % (Math.PI * 2);

    // Damped needle movement
    const diff = this.targetValue - this.currentValue;
    this.currentValue += diff * 0.22;

    // Hover animation progress
    const targetHover = this.isHovered ? 1.0 : 0.0;
    this.hoverProgress += (targetHover - this.hoverProgress) * 0.2;

    // Idle breathing pulse
    this.idlePhase = (this.idlePhase + 0.035) % (Math.PI * 2);

    // Micro-flutter
    this.flutterPhase = (this.flutterPhase + 0.18) % (Math.PI * 2);

    // Particle update
    const isTesting = this.state === 'testing';
    const speedRatio = Math.min(1.0, this.currentValue / Math.max(1.0, this.maxScaleVal));
    for (const p of this.particles) {
      if (isTesting) {
        p.x += p.vx * (1.0 + speedRatio * 2.0);
        p.y += p.vy * (1.0 + speedRatio * 2.0);
      } else {
        p.x += p.vx;
        p.y += p.vy;
      }
      p.life--;
      if (p.life <= 0) {
        Object.assign(p, this.createParticle(isTesting));
      }
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. Warp Particles Background
    this.drawParticles();

    if (this.state === 'idle') {
      this.drawIdle();
    } else {
      this.drawTesting();
    }
  }

  drawParticles() {
    for (const p of this.particles) {
      const alpha = Math.sin((p.life / p.maxLife) * Math.PI);
      if (alpha <= 0.01) continue;

      let color = (p.colorType === 'gold') ? `rgba(250, 204, 21, ${alpha * 0.7})` : `rgba(0, 229, 255, ${alpha * 0.7})`;
      if (this.state === 'testing' && this.phase === 'UPLOAD') {
        color = `rgba(192, 132, 252, ${alpha * 0.7})`;
      }

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.fill();
    }
  }

  drawIdle() {
    const mainR = this.baseMainRadius + 6.0 * this.hoverProgress;
    const innerR = this.baseInnerRadius + 5.0 * this.hoverProgress;

    // Outer Dashed Orbital Ring 1 (Clockwise)
    this.ctx.save();
    this.ctx.translate(this.cx, this.cy);
    this.ctx.rotate(this.rotAngle1);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, mainR + 26, 0, Math.PI * 2);
    this.ctx.setLineDash([5, 9]);
    this.ctx.strokeStyle = !this.isHovered ? '#382E14' : '#61501D';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();

    // Outer Dashed Orbital Ring 2 (Counter-Clockwise)
    this.ctx.save();
    this.ctx.translate(this.cx, this.cy);
    this.ctx.rotate(this.rotAngle2);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, mainR + 16, 0, Math.PI * 2);
    this.ctx.setLineDash([3, 6]);
    this.ctx.strokeStyle = !this.isHovered ? '#594719' : '#8A7023';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.restore();

    // Breathing Golden Ripple Waves
    for (const offset of [0.0, 0.5]) {
      const p = ((this.idlePhase / (Math.PI * 2)) + offset) % 1.0;
      const rippleR = mainR + 4.0 + (p * 32.0);
      const alpha = (1.0 - p) * (0.35 + 0.25 * this.hoverProgress);
      if (alpha > 0.05) {
        this.ctx.beginPath();
        this.ctx.arc(this.cx, this.cy, rippleR, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
        this.ctx.lineWidth = Math.max(1, (1.0 - p) * 3);
        this.ctx.stroke();
      }
    }

    // Outer Soft Neon Bloom
    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, mainR + 3, 0, Math.PI * 2);
    this.ctx.strokeStyle = !this.isHovered ? '#3D3214' : '#66521A';
    this.ctx.lineWidth = 8;
    this.ctx.stroke();

    // Mid Glow
    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, mainR + 1, 0, Math.PI * 2);
    this.ctx.strokeStyle = !this.isHovered ? '#D97706' : '#EAB308';
    this.ctx.lineWidth = 4;
    this.ctx.stroke();

    // Sharp Core Golden Ring
    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, mainR, 0, Math.PI * 2);
    this.ctx.strokeStyle = !this.isHovered ? '#FACC15' : '#FEF08A';
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // Laser Shimmer Arc
    const shimmerAngle = (this.rotAngle1 * 1.8) % (Math.PI * 2);
    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, mainR, shimmerAngle, shimmerAngle + 0.7);
    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 4 + this.hoverProgress;
    this.ctx.stroke();

    // Deep Dark Reactor Core
    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, innerR, 0, Math.PI * 2);
    this.ctx.fillStyle = '#0B0E14';
    this.ctx.fill();

    // Center "GO" Button Text
    const fontSize = 38 + Math.round(4.0 * this.hoverProgress);
    this.ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
    this.ctx.fillStyle = this.isHovered ? '#FFFDE7' : '#FACC15';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('GO', this.cx, this.cy);
  }

  drawTesting() {
    const flutter = (this.currentValue > 5.0) ? Math.sin(this.flutterPhase) * 0.35 : 0.0;
    const effectiveVal = Math.max(0.0, this.currentValue + flutter);
    const currentFrac = Math.min(1.0, Math.max(0.0, this.valToFraction(effectiveVal)));

    // 1. Live Bandwidth Sparkline Waveform behind needle
    if (this.speedHistory.length >= 2) {
      const graphW = 160.0;
      const graphH = 36.0;
      const graphX0 = this.cx - graphW / 2;
      const graphY0 = this.cy + 18.0;

      this.ctx.beginPath();
      this.ctx.moveTo(graphX0, graphY0 + graphH);
      for (let i = 0; i < this.speedHistory.length; i++) {
        const gx = graphX0 + (i / (this.speedHistory.length - 1)) * graphW;
        const ratio = Math.min(1.0, Math.max(0.0, this.speedHistory[i] / Math.max(1.0, this.maxScaleVal)));
        const gy = graphY0 + graphH - (ratio * graphH);
        this.ctx.lineTo(gx, gy);
      }
      this.ctx.lineTo(graphX0 + graphW, graphY0 + graphH);
      this.ctx.closePath();
      this.ctx.fillStyle = (this.phase === 'DOWNLOAD') ? 'rgba(11, 42, 54, 0.7)' : 'rgba(37, 18, 56, 0.7)';
      this.ctx.fill();

      // Top line
      this.ctx.beginPath();
      for (let i = 0; i < this.speedHistory.length; i++) {
        const gx = graphX0 + (i / (this.speedHistory.length - 1)) * graphW;
        const ratio = Math.min(1.0, Math.max(0.0, this.speedHistory[i] / Math.max(1.0, this.maxScaleVal)));
        const gy = graphY0 + graphH - (ratio * graphH);
        if (i === 0) this.ctx.moveTo(gx, gy);
        else this.ctx.lineTo(gx, gy);
      }
      this.ctx.strokeStyle = (this.phase === 'DOWNLOAD') ? '#00E5FF' : '#C084FC';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    // 2. Background Gauge Track
    const startRad = (225.0 * Math.PI) / 180.0;
    const endRad = (-45.0 * Math.PI) / 180.0;

    this.ctx.beginPath();
    // In Canvas, 225 deg is bottom-left, -45 (or 315) is bottom-right. Sweep clockwise (anticlockwise = false)
    this.ctx.arc(this.cx, this.cy, this.gaugeRadius, Math.PI * 0.75, Math.PI * 2.25, false);
    this.ctx.strokeStyle = '#161E2E';
    this.ctx.lineWidth = 18;
    this.ctx.lineCap = 'round';
    this.ctx.stroke();

    // 3. Multi-Layer Neon Bloom Active Arc (Bounded Slicing)
    const totalSweep = 270.0 * currentFrac;
    if (totalSweep >= 2.0) {
      const sliceDeg = 5.0;
      let accumDeg = 0.0;

      while (accumDeg < totalSweep) {
        const rem = totalSweep - accumDeg;
        if (rem < 2.0) break;

        let currentSlice = Math.min(sliceDeg, rem);
        if (rem - currentSlice > 0 && rem - currentSlice < 2.0) {
          currentSlice = rem;
        }

        const sAngleDeg = 225.0 - accumDeg;
        const eAngleDeg = sAngleDeg - currentSlice;

        // Convert to canvas radians
        const sRad = (-sAngleDeg * Math.PI) / 180.0;
        const eRad = (-eAngleDeg * Math.PI) / 180.0;

        const sliceFrac = accumDeg / 270.0;
        const color = this.getGradientColor(sliceFrac);

        // Soft outer glow
        this.ctx.beginPath();
        this.ctx.arc(this.cx, this.cy, this.gaugeRadius, sRad, eRad, false);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 24;
        this.ctx.globalAlpha = 0.35;
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;

        // Main vibrant stroke
        this.ctx.beginPath();
        this.ctx.arc(this.cx, this.cy, this.gaugeRadius, sRad, eRad, false);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 18;
        this.ctx.stroke();

        // Laser core
        const isLast = (accumDeg + currentSlice >= totalSweep - 0.01);
        this.ctx.beginPath();
        this.ctx.arc(this.cx, this.cy, this.gaugeRadius, sRad, eRad, false);
        this.ctx.strokeStyle = isLast ? '#FFFFFF' : color;
        this.ctx.lineWidth = 6;
        this.ctx.stroke();

        accumDeg += currentSlice;
      }

      // Leading plasma tip orb
      const polar = this.fractionToPolar(currentFrac);
      const leadX = this.cx + this.gaugeRadius * polar.x;
      const leadY = this.cy + this.gaugeRadius * polar.y;

      this.ctx.beginPath();
      this.ctx.arc(leadX, leadY, 7, 0, Math.PI * 2);
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.fill();
      this.ctx.strokeStyle = this.getGradientColor(currentFrac);
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    }

    // 4. Scale Numbers
    const { labels } = this.getActiveScale();
    const lblRadius = this.gaugeRadius - 30;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (const val of labels) {
      const frac = this.valToFraction(val);
      const polar = this.fractionToPolar(frac);
      const lx = this.cx + lblRadius * polar.x;
      const ly = this.cy + lblRadius * polar.y;

      const isReached = this.currentValue >= val;
      this.ctx.fillStyle = isReached ? '#FFFFFF' : '#475569';
      this.ctx.font = `${isReached ? 'bold ' : ''}${val >= 1000 ? 9 : 10}px 'Segoe UI', sans-serif`;
      this.ctx.fillText(val.toString(), lx, ly);
    }

    // 5. Light-Saber Laser Needle
    const needleLen = this.gaugeRadius - 10;
    const needlePolar = this.fractionToPolar(currentFrac);
    const tipX = this.cx + needleLen * needlePolar.x;
    const tipY = this.cy + needleLen * needlePolar.y;

    const perpX = -needlePolar.y;
    const perpY = needlePolar.x;
    const bWidth = 5.5;

    const bx1 = this.cx + bWidth * perpX;
    const by1 = this.cy + bWidth * perpY;
    const bx2 = this.cx - bWidth * perpX;
    const by2 = this.cy - bWidth * perpY;

    const bladeColor = (this.phase === 'DOWNLOAD') ? '#00E5FF' : '#E879F9';

    this.ctx.beginPath();
    this.ctx.moveTo(bx1, by1);
    this.ctx.lineTo(tipX, tipY);
    this.ctx.lineTo(bx2, by2);
    this.ctx.closePath();
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fill();
    this.ctx.strokeStyle = bladeColor;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Center glowing LED Reactor
    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, 11, 0, Math.PI * 2);
    this.ctx.fillStyle = '#0F172A';
    this.ctx.fill();
    this.ctx.strokeStyle = bladeColor;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.arc(this.cx, this.cy, 5, 0, Math.PI * 2);
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fill();

    // 6. Live Digital Readout
    const displayVal = this.currentValue < 100 ? this.currentValue.toFixed(2) : this.currentValue.toFixed(1);
    this.ctx.font = "bold 36px 'Segoe UI', sans-serif";
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(displayVal, this.cx, this.cy + this.gaugeRadius + 20);

    // 7. Direction Arrow & Mbps Subtitle
    const arrow = (this.phase === 'DOWNLOAD') ? '⬇' : '⬆';
    const arrowColor = (this.phase === 'DOWNLOAD') ? '#00E5FF' : '#E879F9';
    const subY = this.cy + this.gaugeRadius + 46;

    this.ctx.font = "bold 13px 'Segoe UI', sans-serif";
    this.ctx.fillStyle = arrowColor;
    this.ctx.fillText(arrow, this.cx - 20, subY);

    this.ctx.font = "12px 'Segoe UI', sans-serif";
    this.ctx.fillStyle = '#94A3B8';
    this.ctx.fillText("Mbps", this.cx + 10, subY);
  }

  getGradientColor(frac) {
    const s = Math.min(1.0, Math.max(0.0, frac));
    if (this.phase === 'UPLOAD') {
      const r = Math.round(192 + (244 - 192) * s);
      const g = Math.round(132 + (63 - 132) * s);
      const b = Math.round(252 + (94 - 252) * s);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const r = Math.round(34 + (74 - 34) * s);
      const g = Math.round(211 + (222 - 211) * s);
      const b = Math.round(238 + (128 - 238) * s);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.speedometer = new WebSpeedometer('speedometerCanvas');

  // FAQ Accordion Handlers
  document.querySelectorAll('.faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const answer = q.nextElementSibling;
      const isVisible = answer.style.display === 'block';
      document.querySelectorAll('.faq-answer').forEach(a => a.style.display = 'none');
      document.querySelectorAll('.faq-question span').forEach(s => s.textContent = '+');
      if (!isVisible) {
        answer.style.display = 'block';
        q.querySelector('span').textContent = '−';
      }
    });
  });

  // Smooth scroll links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});
