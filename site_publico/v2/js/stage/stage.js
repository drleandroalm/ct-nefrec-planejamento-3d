// Palco 3D: renderer, cena, luzes, câmera/controles, render sob demanda e quadro HQ ocioso (GTAO + MSAA).
import * as THREE from 'three';
import { CameraRig } from './rig.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';


export class Stage {
  constructor(host, { lowPower = false } = {}) {
    this.host = host;
    this.lowPower = lowPower;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 2 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping; // ACES é injetado nos materiais anatômicos (ver structures.js)
    r.localClippingEnabled = true;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.domElement.className = 'gl';
    host.append(r.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels2d';
    host.append(this.labels.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = makeBackground();
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;   // provisório até o HDRI carregar
    scene.environmentIntensity = 0.55;
    this.pmrem = pmrem;

    const cam = (this.camera = new THREE.PerspectiveCamera(32, 1, 2, 6000));
    cam.position.set(0, 0, -900);
    scene.add(cam);
    this.baseFov = 32;

    // luz-chave fixa no mundo (sombras suaves), preenchimento e contraluz presos à câmera
    this.key = new THREE.DirectionalLight(0xfff4e8, 1.9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.8;
    this.key.shadow.radius = 5;
    scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.75); fill.position.set(-1, 0.3, 1); cam.add(fill); fill.target.position.set(0, 0, -1); cam.add(fill.target);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(0.6, 0.8, -1.2); cam.add(rim); rim.target.position.set(0, 0, -1); cam.add(rim.target);
    scene.add(new THREE.HemisphereLight(0xeef3ff, 0x2a211c, 0.35));

    // câmera + gestos próprios (js/stage/rig.js): inércia, pinça no ponto médio, torção = rolagem, molas interrompíveis
    const c = (this.controls = new CameraRig(cam, r.domElement));
    c.minDistance = 30; c.maxDistance = 2600;

    this.clock = new THREE.Clock();
    this.dirty = true; this.hqDone = false; this.lastMove = performance.now();
    this.hqEnabled = true; this.hqDelay = 260;
    this.refiner = null; // { reset(), step(stage), converged } — ver HANDOFF.md (renderização cinematográfica futura)
    this.onRender = []; this.tickers = new Set();
    this.fps = { frames: 0, t0: performance.now(), value: 0, samples: [] };
    this._setupComposer();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _setupComposer() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    const comp = (this.composer = new EffectComposer(r, rt));
    comp.addPass(new RenderPass(this.scene, this.camera));
    const ao = (this.gtao = new GTAOPass(this.scene, this.camera, 4, 4));
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.85;
    ao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.4, thickness: 6, scale: 1.0, samples: this.lowPower ? 8 : 16, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // AO só de malhas opacas: transparentes/fantasma/linhas/planos de TC ficam fora do G-buffer
    ao.overrideVisibility = function () {
      const cache = this._visibilityCache;
      this.scene.traverse((o) => {
        cache.set(o, o.visible);
        if (o.isPoints || o.isLine || o.userData.noAO || (o.isMesh && o.material && (o.material.transparent || o.material.isShaderMaterial))) o.visible = false;
      });
    };
    comp.addPass(ao);
    comp.addPass(new OutputPass());
  }

  // HDRI Poly Haven (CC0, vendorizado) só como luz ambiente; fundo continua o gradiente escuro (HDRI invisível).
  // Com materiais foscos o PMREM usa os níveis mais borrados → luz suave, sem pontos quentes.
  loadHDRI(url, intensity) {
    return new RGBELoader().loadAsync(url).then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const env = this.pmrem.fromEquirectangular(tex).texture; this.hdrTex = tex;   // equiretangular mantido para o path tracing
      this.scene.environment = env; this.scene.environmentIntensity = intensity > 0 ? intensity : 0.7;
      this.scene.environmentRotation = new THREE.Euler(0, Math.PI * 0.75, 0);
      this.hdri = url; this.invalidate(true);
    }).catch((e) => { console.warn('HDRI indisponível, mantendo RoomEnvironment', e); });
  }

  setClipPlanes(planes) { this.clipActive = !!(planes && planes.length); this.gtao.normalMaterial.clippingPlanes = planes && planes.length ? planes : null; this.gtao.normalMaterial.needsUpdate = true; this.invalidate(true); }

  resize() {
    const w = Math.max(2, this.host.clientWidth), h = Math.max(2, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.labels.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.invalidate();
  }

  invalidate(shadows = false) { this.dirty = true; this.hqDone = false; if (shadows) { this.renderer.shadowMap.needsUpdate = true; this.refiner?.markScene?.(); } }

  fitShadow(box) {
    if (box.isEmpty()) return;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const k = this.key;
    k.target.position.copy(s.center);
    // luz de cima-direita-anterior do paciente (tela: alto-esquerda na vista anterior)
    k.position.copy(s.center).add(new THREE.Vector3(0.45, 0.8, -0.55).normalize().multiplyScalar(s.radius * 2.2));
    const sc = k.shadow.camera; const R = s.radius * 1.05;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = s.radius * 0.5; sc.far = s.radius * 4; sc.updateProjectionMatrix();
    this.sceneSphere = s;
    this.invalidate(true);
  }

  _loop(t) {
    requestAnimationFrame(this._loop);
    const dt = this.clock.getDelta();
    let moved = this.controls.update(dt);
    for (const fn of this.tickers) if (fn(dt)) moved = true;
    const now = performance.now();
    if (moved || this.dirty) {
      this.dirty = false; this.hqDone = false; this.lastMove = now;
      this.renderFast();
      this._countFps(now);
    } else if (this.hqEnabled && !this.hqDone && now - this.lastMove > this.hqDelay) {
      this.renderHQ(); this.hqDone = true;
      if (this.refiner) this.refiner.reset?.();
    } else if (this.hqDone && this.refiner && !this.refiner.converged) {
      // ponto de extensão: refinamento progressivo com a câmera parada (ex.: path tracing acumulado).
      // O refinador renderiza uma amostra por quadro e apresenta o acumulado; qualquer movimento/invalidate volta ao caminho rápido.
      this.refiner.step(this); this._post();
    }
  }
  _countFps(now) {
    const f = this.fps; f.frames++;
    if (now - f.t0 >= 1000) { f.value = (f.frames * 1000) / (now - f.t0); f.samples.push(f.value); if (f.samples.length > 60) f.samples.shift(); f.frames = 0; f.t0 = now; }
  }
  _post() { for (const fn of this.onRender) fn(); this.labels.render(this.scene, this.camera); }
  renderFast() { this.renderer.render(this.scene, this.camera); this.mode = 'fast'; this._post(); }
  renderHQ() { this.composer.render(); this.mode = 'hq'; this._post(); }
}

function makeBackground() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#1b2029'); gr.addColorStop(0.55, '#10131a'); gr.addColorStop(1, '#07080b');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
