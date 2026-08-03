import * as THREE from 'three';
import { PACK, RUN_SECONDS } from './config.js';
import type { Coin, Obstacle, World } from './world.js';
import type { HandCursors } from './hands.js';
import type { LaneModel } from './lanes.js';
import type { Point2 } from '../types.js';

/**
 * Bright, low-poly Three.js renderer.
 *
 * Pose inference and WebGL share the GPU on many laptops, so this scene is
 * deliberately cheap: shared geometry, pooled obstacle groups, instanced
 * collectibles, no shadows, no post-processing, and adaptive pixel density.
 * The simulation remains fixed at 60Hz even when visual resolution downshifts.
 */

const COLOR = {
  sky: 0xc9f4ff,
  haze: 0xe9fbff,
  ink: 0x12233f,
  road: 0xf7f2df,
  roadEdge: 0xffffff,
  grass: 0x67d391,
  grassDark: 0x24a86a,
  cobalt: 0x165dff,
  citrus: 0xffe34d,
  coral: 0xff6655,
  orange: 0xffa62b,
  teal: 0x26c6b8,
  white: 0xfbfeff,
  danger: 0xe83d4f,
} as const;

const LANE_X = 2.75;
const MAX_OBSTACLES = 24;
const MAX_COINS = 64;
const SCENERY_SPAN = 150;

type ObstacleSlot = {
  root: THREE.Group;
  hurdle: THREE.Group;
  beam: THREE.Group;
  wall: THREE.Group;
};

type TextSprite = THREE.Sprite & {
  userData: {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
    value: string;
    fontSize: number;
    weight: number;
    align: CanvasTextAlign;
  };
};

function material(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

function mesh(
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, surface);
  result.castShadow = false;
  result.receiveShadow = false;
  return result;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export class Scene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.1, 220);
  private readonly hud = new THREE.Scene();
  private readonly hudCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private readonly clockVector = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();

  private readonly trackMarks: THREE.Mesh[] = [];
  private readonly scenery: THREE.Group[] = [];
  private readonly obstacleSlots: ObstacleSlot[] = [];
  private readonly coins: THREE.InstancedMesh;
  private readonly avatar: THREE.Group;
  private readonly avatarParts: {
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Group;
    rightLeg: THREE.Group;
    torso: THREE.Mesh;
  };
  private readonly paceCrew: THREE.Group;

  private readonly timeText: TextSprite;
  private readonly scoreText: TextSprite;
  private readonly comboText: TextSprite;
  private readonly flashText: TextSprite;
  private readonly phaseText: TextSprite;
  private readonly burnBack: THREE.Mesh;
  private readonly burnFill: THREE.Mesh;
  private readonly gapBack: THREE.Mesh;
  private readonly gapFill: THREE.Mesh;
  private readonly handRings: THREE.Mesh[];

  private pixelRatio = 1;
  private frameCost = 7;
  private cheapFrames = 0;
  private lastAdaptiveCheck = 0;
  private reducedMotion = false;
  w = 1;
  h = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The palette is authored as display colors; filmic mapping washed the
    // yellow sun and coral hazards toward white, reducing glance readability.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;

    this.scene.background = new THREE.Color(COLOR.sky);
    this.scene.fog = new THREE.Fog(COLOR.haze, 66, 155);
    this.camera.position.set(0, 6.1, 12.5);
    this.camera.lookAt(0, 2.2, -32);

    this.buildLights();
    this.buildWorld();
    this.avatarParts = this.buildAvatar();
    this.avatar = this.avatarParts.torso.parent!.parent as THREE.Group;
    this.scene.add(this.avatar);
    this.paceCrew = this.buildPaceCrew();
    this.scene.add(this.paceCrew);

    const coinGeometry = new THREE.IcosahedronGeometry(0.2, 1);
    const coinMaterial = new THREE.MeshStandardMaterial({
      color: COLOR.citrus,
      emissive: 0xd99000,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    });
    this.coins = new THREE.InstancedMesh(coinGeometry, coinMaterial, MAX_COINS);
    this.coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coins.count = 0;
    this.coins.frustumCulled = false;
    this.scene.add(this.coins);

    for (let i = 0; i < MAX_OBSTACLES; i += 1) {
      const slot = this.buildObstacleSlot();
      slot.root.visible = false;
      this.obstacleSlots.push(slot);
      this.scene.add(slot.root);
    }

    this.timeText = this.makeText('', 64, 700, 'left');
    this.scoreText = this.makeText('', 64, 700, 'right');
    this.comboText = this.makeText('', 82, 800, 'center');
    this.flashText = this.makeText('', 96, 900, 'center');
    this.phaseText = this.makeText('', 34, 800, 'center');
    this.hud.add(this.timeText, this.scoreText, this.comboText, this.flashText, this.phaseText);

    this.burnBack = this.hudRect(COLOR.ink, 0.12);
    this.burnFill = this.hudRect(COLOR.teal, 1);
    this.gapBack = this.hudRect(COLOR.ink, 0.14);
    this.gapFill = this.hudRect(COLOR.citrus, 1);
    this.hud.add(this.burnBack, this.burnFill, this.gapBack, this.gapFill);

    const ringGeometry = new THREE.RingGeometry(21, 26, 32);
    this.handRings = [0, 1].map(() => {
      const ring = mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: COLOR.cobalt,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      ring.renderOrder = 100;
      this.hud.add(ring);
      return ring;
    });

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.w, this.h, false);

    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.hudCamera.left = 0;
    this.hudCamera.right = this.w;
    this.hudCamera.top = this.h;
    this.hudCamera.bottom = 0;
    this.hudCamera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.dispose();
  }

  draw(world: World, lanes: LaneModel, hands: HandCursors): void {
    const started = performance.now();
    this.updateTrack(world);
    this.updateScenery(world);
    this.updateObstacles(world.obstacles);
    this.updateCoins(world);
    this.updateAvatar(world, lanes);
    this.updatePaceCrew(world);
    this.updateCamera(world, lanes);
    this.updateHud(world, hands);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.hud, this.hudCamera);

    this.adaptResolution(performance.now() - started);
  }

  coinNormalised(coin: Coin): Point2 {
    const p = this.coinWorldPoint(coin, this.clockVector);
    p.project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xf6fdff, 0x7dc982, 2.25));
    const sun = new THREE.DirectionalLight(0xfff4c2, 2.7);
    sun.position.set(-8, 18, 6);
    this.scene.add(sun);
  }

  private buildWorld(): void {
    const ground = mesh(new THREE.PlaneGeometry(90, 170), material(COLOR.grass, 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.04, -72);
    this.scene.add(ground);

    const road = mesh(new THREE.PlaneGeometry(9.5, 160), material(COLOR.road, 0.95));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -68);
    this.scene.add(road);

    const edgeGeometry = new THREE.BoxGeometry(0.14, 0.07, 160);
    const edgeMaterial = material(COLOR.roadEdge);
    for (const x of [-4.72, 4.72]) {
      const edge = mesh(edgeGeometry, edgeMaterial);
      edge.position.set(x, 0.05, -68);
      this.scene.add(edge);
    }

    const stripeGeometry = new THREE.BoxGeometry(0.075, 0.025, 2.1);
    const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xbadfe7 });
    for (let i = 0; i < 44; i += 1) {
      for (const x of [-LANE_X / 2, LANE_X / 2]) {
        const stripe = mesh(stripeGeometry, stripeMaterial);
        stripe.position.set(x, 0.03, -i * 4);
        this.trackMarks.push(stripe);
        this.scene.add(stripe);
      }
    }

    const sunMaterial = new THREE.MeshBasicMaterial({
      color: COLOR.citrus,
      side: THREE.DoubleSide,
      fog: false,
    });
    const sun = mesh(new THREE.CircleGeometry(9, 48), sunMaterial);
    sun.position.set(-22, 22, -135);
    this.scene.add(sun);

    const cloudMaterial = new THREE.MeshBasicMaterial({ color: COLOR.white });
    const cloudGeometry = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 5; i += 1) {
      const cloud = new THREE.Group();
      for (const [x, y, s] of [[-1.3, 0, 1.2], [0, 0.3, 1.6], [1.4, 0, 1]] as const) {
        const puff = mesh(cloudGeometry, cloudMaterial);
        puff.position.set(x, y, 0);
        puff.scale.setScalar(s);
        cloud.add(puff);
      }
      cloud.position.set(-22 + i * 12, 15 + (i % 2) * 4, -112 - i * 4);
      this.scene.add(cloud);
    }

    const trunkGeometry = new THREE.CylinderGeometry(0.17, 0.26, 2.2, 6);
    const crownGeometry = new THREE.IcosahedronGeometry(1.2, 1);
    const trunkMaterial = material(0x8d7040);
    const crownMaterials = [material(COLOR.grassDark), material(0x3cbf78), material(0x7cd98d)];
    for (let i = 0; i < 18; i += 1) {
      const plant = new THREE.Group();
      const trunk = mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = 1.1;
      const crown = mesh(crownGeometry, crownMaterials[i % crownMaterials.length]!);
      crown.position.y = 2.65;
      crown.scale.set(1.15, 0.88, 1.15);
      plant.add(trunk, crown);
      plant.userData.seed = 8 + i * (SCENERY_SPAN / 18);
      plant.userData.side = i % 2 === 0 ? -1 : 1;
      this.scenery.push(plant);
      this.scene.add(plant);
    }
  }

  private buildObstacleSlot(): ObstacleSlot {
    const root = new THREE.Group();

    const hurdle = new THREE.Group();
    const log = mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.25, 10), material(COLOR.orange));
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.38;
    const logBand = mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.22, 10), material(0xffd166));
    logBand.rotation.z = Math.PI / 2;
    logBand.position.set(0.72, 0.38, 0);
    hurdle.add(log, logBand);

    const beam = new THREE.Group();
    const beamMaterial = material(COLOR.teal);
    const postGeometry = new THREE.BoxGeometry(0.18, 2.7, 0.18);
    for (const x of [-4.1, 4.1]) {
      const post = mesh(postGeometry, beamMaterial);
      post.position.set(x, 1.35, 0);
      beam.add(post);
    }
    const top = mesh(new THREE.BoxGeometry(8.4, 0.34, 0.34), beamMaterial);
    top.position.y = 2.55;
    beam.add(top);
    for (let i = -3; i <= 3; i += 1) {
      const flag = mesh(new THREE.ConeGeometry(0.22, 0.65, 5), material(0x86eee2));
      flag.position.set(i * 1.05, 2.13, 0);
      flag.rotation.z = Math.PI;
      beam.add(flag);
    }

    const wall = new THREE.Group();
    const block = mesh(new THREE.BoxGeometry(2.05, 2.2, 0.72), material(COLOR.coral));
    block.position.y = 1.1;
    const cap = mesh(new THREE.BoxGeometry(2.2, 0.22, 0.84), material(0xffb19f));
    cap.position.y = 2.18;
    const arrow = mesh(new THREE.ConeGeometry(0.35, 0.8, 3), material(COLOR.white));
    arrow.position.set(0, 1.2, 0.4);
    arrow.rotation.z = Math.PI;
    wall.add(block, cap, arrow);

    root.add(hurdle, beam, wall);
    return { root, hurdle, beam, wall };
  }

  private buildAvatar(): {
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Group;
    rightLeg: THREE.Group;
    torso: THREE.Mesh;
  } {
    const root = new THREE.Group();
    root.name = 'avatar';
    const body = new THREE.Group();
    root.add(body);

    const torso = mesh(new THREE.CapsuleGeometry(0.48, 0.85, 4, 8), material(COLOR.cobalt, 0.55));
    torso.position.y = 2.25;
    body.add(torso);

    const head = mesh(new THREE.SphereGeometry(0.42, 12, 10), material(0xffc89a, 0.7));
    head.position.set(0, 3.38, -0.05);
    body.add(head);

    const hair = mesh(new THREE.SphereGeometry(0.43, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.48), material(COLOR.ink));
    hair.position.set(0, 3.55, -0.05);
    body.add(hair);

    const shorts = mesh(new THREE.BoxGeometry(1.05, 0.48, 0.62), material(COLOR.coral));
    shorts.position.set(0, 1.5, 0);
    body.add(shorts);

    const limbGeometry = new THREE.CapsuleGeometry(0.13, 0.82, 3, 7);
    const limbMaterial = material(0xffc89a, 0.75);
    const makeLimb = (x: number, y: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const part = mesh(limbGeometry, limbMaterial);
      part.position.y = -0.58;
      pivot.add(part);
      body.add(pivot);
      return pivot;
    };

    const leftArm = makeLimb(-0.6, 2.7);
    const rightArm = makeLimb(0.6, 2.7);
    const leftLeg = makeLimb(-0.3, 1.35);
    const rightLeg = makeLimb(0.3, 1.35);
    return { leftArm, rightArm, leftLeg, rightLeg, torso };
  }

  private buildPaceCrew(): THREE.Group {
    const crew = new THREE.Group();
    const bodyGeometry = new THREE.CapsuleGeometry(0.34, 0.65, 3, 6);
    const headGeometry = new THREE.SphereGeometry(0.28, 8, 6);
    const crewMaterial = new THREE.MeshStandardMaterial({
      color: COLOR.danger,
      transparent: true,
      opacity: 0.82,
      roughness: 0.7,
    });
    for (let i = 0; i < 5; i += 1) {
      const runner = new THREE.Group();
      const body = mesh(bodyGeometry, crewMaterial);
      body.position.y = 1.05;
      const head = mesh(headGeometry, crewMaterial);
      head.position.y = 1.86;
      runner.add(body, head);
      runner.position.x = (i - 2) * 1.55;
      runner.position.z = Math.abs(i - 2) * 0.35;
      crew.add(runner);
    }
    crew.position.set(0, 0, 5);
    crew.visible = false;
    return crew;
  }

  private updateTrack(world: World): void {
    const stride = 4;
    const offset = world.distance % stride;
    for (let i = 0; i < this.trackMarks.length; i += 1) {
      const row = Math.floor(i / 2);
      this.trackMarks[i]!.position.z = -(row * stride + offset);
    }
  }

  private updateScenery(world: World): void {
    for (const plant of this.scenery) {
      const seed = plant.userData.seed as number;
      const side = plant.userData.side as number;
      const distance = positiveMod(seed - world.distance, SCENERY_SPAN);
      plant.position.set(side * (7.2 + (seed % 4)), 0, -distance);
      const scale = 0.8 + (seed % 5) * 0.08;
      plant.scale.setScalar(scale);
    }
  }

  private updateObstacles(obstacles: Obstacle[]): void {
    for (let i = 0; i < this.obstacleSlots.length; i += 1) {
      const slot = this.obstacleSlots[i]!;
      const obstacle = obstacles[i];
      if (!obstacle) {
        slot.root.visible = false;
        continue;
      }
      slot.root.visible = true;
      slot.root.position.set(obstacle.lane * LANE_X, 0, -obstacle.z);
      slot.root.rotation.y = 0;
      slot.root.scale.setScalar(obstacle.hit ? 0.86 : 1);
      slot.hurdle.visible = obstacle.type === 'hurdle';
      slot.beam.visible = obstacle.type === 'beam';
      slot.wall.visible = obstacle.type === 'wall';
      if (obstacle.hit) slot.root.rotation.z = 0.22;
    }
  }

  private coinWorldPoint(coin: Coin, target: THREE.Vector3): THREE.Vector3 {
    const height = 0.72 + (1 - coin.y) * 3.55;
    return target.set(coin.x * 3.1, height, -coin.z);
  }

  private updateCoins(world: World): void {
    let visible = 0;
    for (const coin of world.coins) {
      if (coin.taken || visible >= MAX_COINS) continue;
      const position = this.coinWorldPoint(coin, this.clockVector);
      const pulse = this.reducedMotion ? 1 : 0.9 + Math.sin(world.elapsed * 7 + visible) * 0.13;
      this.matrix.compose(
        position,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, world.elapsed * 2 + visible, 0)),
        new THREE.Vector3(pulse, pulse, pulse),
      );
      this.coins.setMatrixAt(visible, this.matrix);
      visible += 1;
    }
    this.coins.count = visible;
    this.coins.instanceMatrix.needsUpdate = true;
  }

  private updateAvatar(world: World, lanes: LaneModel): void {
    const jump = world.airborne > 0 ? Math.sin((1 - world.airborne / 0.62) * Math.PI) : 0;
    const surging = world.surge > 0;
    const ducking = world.ducking > 0;
    const hover = surging && !this.reducedMotion ? 1.1 + Math.sin(world.elapsed * 5) * 0.12 : 0;
    this.avatar.position.set(lanes.visual * LANE_X, jump * 1.75 + hover, 0.2);
    this.avatar.rotation.z = this.reducedMotion ? 0 : (lanes.lane - lanes.visual) * -0.16;
    this.avatar.scale.set(1, ducking ? 0.64 : 1, 1);

    const stride = this.reducedMotion ? 0 : Math.sin(world.distance * 0.33) * 0.78;
    const tuck = jump > 0 || surging ? -0.75 : 0;
    this.avatarParts.leftLeg.rotation.x = tuck || stride;
    this.avatarParts.rightLeg.rotation.x = tuck || -stride;
    this.avatarParts.leftArm.rotation.x = -stride * 0.8;
    this.avatarParts.rightArm.rotation.x = stride * 0.8;
  }

  private updatePaceCrew(world: World): void {
    const pressure = THREE.MathUtils.clamp(1 - world.gap / 55, 0, 1);
    this.paceCrew.visible = pressure > 0.03;
    this.paceCrew.position.z = 6.6 - pressure * 3.2;
    this.paceCrew.position.y = -0.4 + pressure * 0.4;
    this.paceCrew.scale.setScalar(0.72 + pressure * 0.4);
    for (let i = 0; i < this.paceCrew.children.length; i += 1) {
      const runner = this.paceCrew.children[i]!;
      runner.position.y = this.reducedMotion ? 0 : Math.abs(Math.sin(world.elapsed * 7 + i)) * 0.12;
    }
  }

  private updateCamera(world: World, lanes: LaneModel): void {
    const hit = world.flash?.text === 'HIT' && !this.reducedMotion;
    const nudge = hit ? Math.sin(world.elapsed * 80) * 0.12 : 0;
    this.camera.position.x = lanes.visual * 0.2 + nudge;
    this.camera.position.y = world.surge > 0 ? 6.8 : 6.1;
    this.camera.rotation.z = this.reducedMotion ? 0 : (lanes.lane - lanes.visual) * 0.015;
    this.camera.lookAt(lanes.visual * 0.12, world.surge > 0 ? 2.8 : 2.2, -32);
  }

  private updateHud(world: World, hands: HandCursors): void {
    const remaining = Math.max(0, RUN_SECONDS - world.elapsed);
    const mm = Math.floor(remaining / 60);
    const ss = Math.floor(remaining % 60).toString().padStart(2, '0');
    this.setText(this.timeText, `${mm}:${ss}`, COLOR.ink);
    this.setText(this.scoreText, Math.floor(world.score).toLocaleString(), COLOR.ink);
    this.setText(this.comboText, world.combo > 1 ? `×${world.combo}` : '', COLOR.cobalt);
    this.setText(this.flashText, world.flash?.text ?? '', this.flashColor(world.flash?.text));
    this.setText(this.phaseText, world.surge > 0 ? 'SURGE · ARMS ONLY' : world.phase.id.toUpperCase(), COLOR.ink);

    this.placeText(this.timeText, 24, this.h - 48, 210, 54, 'left');
    this.placeText(this.scoreText, this.w - 24, this.h - 48, 240, 54, 'right');
    this.placeText(this.comboText, this.w / 2, this.h - 56, 180, 70, 'center');
    this.placeText(this.phaseText, this.w / 2, this.h - 104, 250, 34, 'center');
    this.placeText(this.flashText, this.w / 2, this.h * 0.66, 520, 88, 'center');

    const burn = world.surge > 0 ? world.surge / 12 : world.burnFill;
    this.placeRect(this.burnBack, this.w / 2, this.h - 5, this.w, 10);
    this.placeRect(this.burnFill, this.w / 2, this.h - 5, this.w * burn, 10);
    (this.burnFill.material as THREE.MeshBasicMaterial).color.setHex(
      world.surge > 0 ? COLOR.citrus : COLOR.teal,
    );

    const gapHeight = Math.max(0, this.h * 0.42 * (world.gap / PACK.MAX_GAP));
    this.placeRect(this.gapBack, 13, this.h * 0.47, 10, this.h * 0.42);
    this.placeRect(this.gapFill, 13, this.h * 0.26 + gapHeight / 2, 10, gapHeight);
    (this.gapFill.material as THREE.MeshBasicMaterial).color.setHex(
      world.gap < 25 ? COLOR.danger : COLOR.citrus,
    );

    for (let i = 0; i < this.handRings.length; i += 1) {
      const hand = i === 0 ? hands.left : hands.right;
      const ring = this.handRings[i]!;
      ring.position.set(hand.x * this.w, (1 - hand.y) * this.h, 1);
      ring.visible = hand.visible;
      (ring.material as THREE.MeshBasicMaterial).opacity = hand.visible ? 0.95 : 0.25;
    }
  }

  /** Reduce GPU fill-rate before it can steal time from MediaPipe. */
  private adaptResolution(cost: number): void {
    this.frameCost = this.frameCost * 0.93 + cost * 0.07;
    const now = performance.now();
    if (now - this.lastAdaptiveCheck < 750) return;
    this.lastAdaptiveCheck = now;

    if (this.frameCost > 11.5 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.12);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(this.w, this.h, false);
      this.cheapFrames = 0;
    } else if (this.frameCost < 6.5) {
      this.cheapFrames += 1;
      const ceiling = Math.min(window.devicePixelRatio || 1, 1.25);
      if (this.cheapFrames >= 6 && this.pixelRatio < ceiling) {
        this.pixelRatio = Math.min(ceiling, this.pixelRatio + 0.08);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(this.w, this.h, false);
        this.cheapFrames = 0;
      }
    } else {
      this.cheapFrames = 0;
    }
  }

  private hudRect(color: number, opacity: number): THREE.Mesh {
    const result = mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        transparent: opacity < 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    result.renderOrder = 90;
    return result;
  }

  private placeRect(target: THREE.Mesh, x: number, y: number, w: number, h: number): void {
    target.position.set(x, y, 0);
    target.scale.set(Math.max(0.001, w), Math.max(0.001, h), 1);
  }

  private makeText(value: string, fontSize: number, weight: number, align: CanvasTextAlign): TextSprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }),
    ) as TextSprite;
    sprite.renderOrder = 110;
    sprite.userData = { canvas, context, texture, value: '', fontSize, weight, align };
    this.setText(sprite, value, COLOR.ink);
    return sprite;
  }

  private setText(sprite: TextSprite, value: string, color: number): void {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const cacheKey = `${value}:${hex}`;
    if (sprite.userData.value === cacheKey) return;
    sprite.userData.value = cacheKey;
    const { context, canvas, texture } = sprite.userData;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = hex;
    context.textBaseline = 'middle';
    context.textAlign = (sprite.userData.align as CanvasTextAlign) ?? 'center';
    const size = (sprite.userData.fontSize as number) ?? 40;
    const weight = (sprite.userData.weight as number) ?? 700;
    context.font = `${weight} ${size}px "Avenir Next", "Segoe UI", sans-serif`;
    const x = context.textAlign === 'left' ? 12 : context.textAlign === 'right' ? canvas.width - 12 : canvas.width / 2;
    context.fillText(value, x, canvas.height / 2);
    texture.needsUpdate = true;
    sprite.visible = value.length > 0;
  }

  private placeText(
    target: TextSprite,
    x: number,
    y: number,
    w: number,
    h: number,
    align: 'left' | 'right' | 'center',
  ): void {
    target.position.set(align === 'left' ? x + w / 2 : align === 'right' ? x - w / 2 : x, y, 2);
    target.scale.set(w, h, 1);
  }

  private flashColor(text?: string): number {
    if (!text) return COLOR.cobalt;
    if (text === 'HIT') return COLOR.danger;
    if (text.includes('SURGE') || text.includes('CLOSE') || text.includes('SWEEP')) return COLOR.citrus;
    return COLOR.teal;
  }
}
