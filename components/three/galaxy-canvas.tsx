'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import gsap from 'gsap';

export interface GalaxyCanvasHandle {
  resetCameraView: () => void;
}

const GalaxyCanvas = forwardRef<GalaxyCanvasHandle>(function GalaxyCanvas(_props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js object refs so cleanup can access them without stale closures
  const threeState = useRef<{
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
    controls: OrbitControls | null;
    composer: EffectComposer | null;
    animationId: number | null;
  }>({
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    composer: null,
    animationId: null,
  });

  // Mutable state shared across all functions inside useEffect
  const mutableState = useRef<{
    allNodes: THREE.Group[];
    allLinks: THREE.Line[];
    adjMap: Map<THREE.Group, Set<THREE.Group>>;
    clusterNodes: Map<number, THREE.Group[]>;
    clusterSuns: Map<number, THREE.Group>;
    nodesGroup: THREE.Group | null;
    linksGroup: THREE.Group | null;
    bloomPass: UnrealBloomPass | null;
    frames: number;
    lastTime: number;
    cometSpeedMultiplier: number;
  }>({
    allNodes: [],
    allLinks: [],
    adjMap: new Map(),
    clusterNodes: new Map(),
    clusterSuns: new Map(),
    nodesGroup: null,
    linksGroup: null,
    bloomPass: null,
    frames: 0,
    lastTime: 0,
    cometSpeedMultiplier: 1.0,
  });

  useImperativeHandle(ref, () => ({
    resetCameraView() {
      // Will be overwritten inside useEffect once the scene is ready
      if ((window as unknown as Record<string, unknown>).__resetCameraView) {
        (window as unknown as Record<string, () => void>).__resetCameraView();
      }
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;
    let controls: OrbitControls;
    let composer: EffectComposer;
    let bloomPass: UnrealBloomPass;
    let nodesGroup: THREE.Group;
    let linksGroup: THREE.Group;
    let animationId: number = 0;

    const allNodes: THREE.Group[] = [];
    const allLinks: THREE.Line[] = [];
    const adjMap = new Map<THREE.Group, Set<THREE.Group>>();
    const clusterNodes = new Map<number, THREE.Group[]>();
    const clusterSuns = new Map<number, THREE.Group>();
    const clusterBaseColors = [0xa855f7, 0x22d3ee, 0xf472b6, 0x818cf8, 0x34d399, 0xfbbf24];
    // clusterColors was defined in the original but only clusterBaseColors is used
    const _clusterColors = [0xa855f7, 0x22d3ee, 0xf472b6, 0xa855f7, 0x22d3ee, 0xf472b6];

    let frames = 0;
    let lastTime = performance.now();
    let cometSpeedMultiplier = 1.0;

    // --- Learning Path State ---
    const learningPath = {
      visible: false,
      steps: [] as { node: THREE.Group; stepIndex: number }[],
      curve: null as THREE.CatmullRomCurve3 | null,
      group: new THREE.Group(),
      flowParticles: null as THREE.Points | null,
      stepLabels: [] as THREE.Sprite[],
      flowOffset: 0,
    };

    // Store refs for cleanup
    mutableState.current.allNodes = allNodes;
    mutableState.current.allLinks = allLinks;
    mutableState.current.adjMap = adjMap;
    mutableState.current.clusterNodes = clusterNodes;
    mutableState.current.clusterSuns = clusterSuns;

    // --- Helper functions ---

    function createGlowTexture(color: number): THREE.CanvasTexture {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const c = new THREE.Color(color);
      const r = Math.round(c.r * 255),
        g = Math.round(c.g * 255),
        b = Math.round(c.b * 255);
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.2, `rgba(${r},${g},${b},0.5)`);
      grad.addColorStop(0.5, `rgba(${r},${g},${b},0.1)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(canvas);
    }

    function createStepLabel(stepNumber: number): THREE.Sprite {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.beginPath();
      ctx.arc(64, 64, 50, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 34, 68, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 102, 136, 0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 56px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(stepNumber), 64, 64);
      const texture = new THREE.CanvasTexture(canvas);
      return new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
      );
    }

    function createGlowNode(
      color: number,
      size: number,
      name: string
    ): THREE.Group {
      const group = new THREE.Group();
      const coreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.4, 16, 16),
        new THREE.MeshBasicMaterial({ color: color })
      );
      group.add(coreMesh);
      const spriteMat = new THREE.SpriteMaterial({
        map: createGlowTexture(color),
        transparent: true,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(size * 7, size * 7, 1);
      group.add(sprite);
      if (size > 4) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.5, size * 1.6, 64),
          new THREE.MeshBasicMaterial({
            color: color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.2,
          })
        );
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }
      group.userData = { name, color, baseSize: size, baseGlowSize: size };
      allNodes.push(group);
      return group;
    }

    function createCurve(
      sourceNode: THREE.Group,
      targetNode: THREE.Group,
      color: number,
      opacity: number,
      isInternal?: boolean,
      trueColor?: number
    ): void {
      const start = sourceNode.position;
      const end = targetNode.position;
      const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
      mid.add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100
        )
      );
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: color,
          transparent: true,
          opacity: opacity || 0.2,
        })
      );
      line.userData = {
        source: sourceNode,
        target: targetNode,
        baseOpacity: opacity || 0.2,
        isInternal: !!isInternal,
        clusterColor: color,
        trueColor: trueColor || color,
      };
      if (isInternal) line.visible = false;
      linksGroup.add(line);
      allLinks.push(line);
      if (!adjMap.has(sourceNode)) adjMap.set(sourceNode, new Set());
      if (!adjMap.has(targetNode)) adjMap.set(targetNode, new Set());
      adjMap.get(sourceNode)!.add(targetNode);
      adjMap.get(targetNode)!.add(sourceNode);
    }

    function setNodeColor(node: THREE.Group, color: number): void {
      node.children.forEach((child) => {
        if ((child as THREE.Mesh).isMesh) {
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
        }
        if ((child as THREE.Sprite).isSprite) {
          ((child as THREE.Sprite).material as THREE.SpriteMaterial).map = createGlowTexture(color);
          ((child as THREE.Sprite).material as THREE.SpriteMaterial).needsUpdate = true;
        }
      });
    }

    function createCore(): void {
      const core = createGlowNode(0xffffff, 8, 'CENTRAL_INTELLIGENCE');
      nodesGroup.add(core);
    }

    function createClusters(): void {
      const clusterCount = 6;
      const nodesPerCluster = 80;
      const mixColors = [0xa855f7, 0x22d3ee, 0xf472b6];

      for (let i = 0; i < clusterCount; i++) {
        const clusterColor = clusterBaseColors[i];
        const phi = Math.acos(1 - (2 * (i + 0.5)) / clusterCount);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const dist = 250 + Math.random() * 100;
        const cx = dist * Math.sin(phi) * Math.cos(theta);
        const cy = dist * Math.cos(phi) * 1.2;
        const cz = dist * Math.sin(phi) * Math.sin(theta);

        const sun = createGlowNode(clusterColor, 6, `CLUSTER_0${i + 1}`);
        sun.position.set(cx, cy, cz);
        sun.userData.isSun = true;
        sun.userData.clusterId = i;
        sun.userData.clusterColor = clusterColor;
        nodesGroup.add(sun);
        clusterSuns.set(i, sun);

        const core = allNodes.find(
          (n) => n.userData.name === 'CENTRAL_INTELLIGENCE'
        )!;
        createCurve(core, sun, clusterColor, 0.1);

        const subNodes: THREE.Group[] = [];
        for (let j = 0; j < nodesPerCluster; j++) {
          const radius = 40 + Math.pow(Math.random(), 0.7) * 160;
          const t = Math.random() * Math.PI * 2;
          const p = Math.acos(Math.random() * 2 - 1);
          const x = cx + radius * Math.sin(p) * Math.cos(t);
          const y = cy + radius * Math.sin(p) * Math.sin(t) * 0.7;
          const z = cz + radius * Math.cos(p);
          const distToSun = Math.sqrt(
            (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
          );
          const sizeFactor = Math.max(0.4, 1 - distToSun / 250);
          const trueColor = mixColors[Math.floor(Math.random() * 3)];
          const node = createGlowNode(
            clusterColor,
            sizeFactor * 2.5 + 0.5,
            `NODE_${i}_${j}`
          );
          node.position.set(x, y, z);
          node.userData.clusterId = i;
          node.userData.clusterColor = clusterColor;
          node.userData.trueColor = trueColor;
          nodesGroup.add(node);
          subNodes.push(node);
          createCurve(sun, node, clusterColor, 0.06, false, trueColor);
        }
        clusterNodes.set(i, subNodes);

        for (let j = 0; j < subNodes.length; j++) {
          const connCount = 2 + Math.floor(Math.random() * 3);
          for (let k = 0; k < connCount; k++) {
            const targetIdx = Math.floor(Math.random() * subNodes.length);
            if (targetIdx !== j) {
              const linkColor = mixColors[Math.floor(Math.random() * 3)];
              createCurve(
                subNodes[j],
                subNodes[targetIdx],
                clusterColor,
                0,
                true,
                linkColor
              );
            }
          }
        }
      }
    }

    function focusNode(node: THREE.Group): void {
      const resetBtn = document.getElementById('reset-view-btn');
      if (resetBtn) resetBtn.classList.add('visible');
      gsap.to(controls.target, {
        x: node.position.x,
        y: node.position.y,
        z: node.position.z,
        duration: 1.2,
        ease: 'expo.out',
      });
      gsap.to(camera.position, {
        x: node.position.x + 200,
        y: node.position.y + 100,
        z: node.position.z + 200,
        duration: 1.5,
        ease: 'expo.out',
      });

      if (node.userData.isSun) {
        const cid = node.userData.clusterId;
        const mySubNodes = clusterNodes.get(cid) || [];
        const myClusterSet = new Set<THREE.Group>([node, ...mySubNodes]);
        allNodes.forEach((n) => {
          const inCluster = myClusterSet.has(n);
          gsap.to(n.scale, {
            x: inCluster ? 1 : 0.15,
            y: inCluster ? 1 : 0.15,
            z: inCluster ? 1 : 0.15,
            duration: 0.5,
          });
          if (inCluster && n.userData.trueColor) setNodeColor(n, n.userData.trueColor);
        });
        allLinks.forEach((l) => {
          const s = l.userData.source as THREE.Group;
          const t = l.userData.target as THREE.Group;
          const inCluster = myClusterSet.has(s) && myClusterSet.has(t);
          if (l.userData.isInternal) {
            l.visible = inCluster;
            if (inCluster) {
              (l.material as THREE.LineBasicMaterial).color.set(l.userData.trueColor);
              gsap.to(l.material, { opacity: 0.3, duration: 0.5 });
            }
          } else {
            if (
              inCluster &&
              l.userData.trueColor !== l.userData.clusterColor
            )
              (l.material as THREE.LineBasicMaterial).color.set(l.userData.trueColor);
            gsap.to(l.material, {
              opacity: inCluster ? 0.5 : 0.01,
              duration: 0.5,
            });
          }
        });
      } else {
        const neighbors = adjMap.get(node) || new Set<THREE.Group>();
        const visibleSet = new Set<THREE.Group>([node, ...neighbors]);
        allNodes.forEach((n) => {
          const isVisible = visibleSet.has(n);
          gsap.to(n.scale, {
            x: isVisible ? (n === node ? 1.5 : 1) : 0.1,
            y: isVisible ? (n === node ? 1.5 : 1) : 0.1,
            z: isVisible ? (n === node ? 1.5 : 1) : 0.1,
            duration: 0.5,
          });
          if (isVisible && n.userData.trueColor)
            setNodeColor(n, n.userData.trueColor);
        });
        allLinks.forEach((l) => {
          const s = l.userData.source as THREE.Group;
          const t = l.userData.target as THREE.Group;
          const isRelated = s === node || t === node;
          if (l.userData.isInternal) {
            l.visible = isRelated;
            if (isRelated) {
              (l.material as THREE.LineBasicMaterial).color.set(l.userData.trueColor);
              gsap.to(l.material, { opacity: 0.6, duration: 0.5 });
            }
          } else {
            if (
              isRelated &&
              l.userData.trueColor !== l.userData.clusterColor
            )
              (l.material as THREE.LineBasicMaterial).color.set(l.userData.trueColor);
            gsap.to(l.material, {
              opacity: isRelated ? 0.8 : 0.01,
              duration: 0.5,
            });
          }
        });
      }
    }

    // --- Learning Path ---
    function buildDemoLearningPath(): void {
      const steps: { node: THREE.Group; stepIndex: number }[] = [];
      const c0 = clusterNodes.get(0) || [];
      const c1 = clusterNodes.get(1) || [];
      const c2 = clusterNodes.get(2) || [];
      if (clusterSuns.get(0)) steps.push({ node: clusterSuns.get(0)!, stepIndex: 0 });
      if (c0.length > 10) steps.push({ node: c0[10], stepIndex: 1 });
      if (c0.length > 25) steps.push({ node: c0[25], stepIndex: 2 });
      if (clusterSuns.get(1)) steps.push({ node: clusterSuns.get(1)!, stepIndex: 3 });
      if (c1.length > 15) steps.push({ node: c1[15], stepIndex: 4 });
      if (c1.length > 40) steps.push({ node: c1[40], stepIndex: 5 });
      if (clusterSuns.get(2)) steps.push({ node: clusterSuns.get(2)!, stepIndex: 6 });
      if (c2.length > 5) steps.push({ node: c2[5], stepIndex: 7 });
      learningPath.steps = steps;
    }

    function createLearningPath(): void {
      if (learningPath.steps.length < 2) return;
      const points = learningPath.steps.map((s) => s.node.position.clone());
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
      learningPath.curve = curve;

      // Tube
      const tubeGeo = new THREE.TubeGeometry(curve, learningPath.steps.length * 20, 2.5, 8, false);
      const tube = new THREE.Mesh(
        tubeGeo,
        new THREE.MeshBasicMaterial({
          color: 0xff2244,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
        })
      );
      learningPath.group.add(tube);

      // Flow particles
      const pCount = 60;
      const pGeo = new THREE.BufferGeometry();
      const pPos = new Float32Array(pCount * 3);
      for (let i = 0; i < pCount; i++) {
        const pt = curve.getPointAt(i / pCount);
        pPos[i * 3] = pt.x;
        pPos[i * 3 + 1] = pt.y;
        pPos[i * 3 + 2] = pt.z;
      }
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
      const flowP = new THREE.Points(
        pGeo,
        new THREE.PointsMaterial({
          color: 0xff6688,
          size: 5,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        })
      );
      learningPath.flowParticles = flowP;
      learningPath.group.add(flowP);

      // Step labels
      for (let i = 0; i < learningPath.steps.length; i++) {
        const sprite = createStepLabel(i + 1);
        const pos = learningPath.steps[i].node.position;
        sprite.position.set(pos.x, pos.y + 12, pos.z);
        sprite.scale.set(16, 16, 1);
        learningPath.stepLabels.push(sprite);
        learningPath.group.add(sprite);
      }

      learningPath.group.visible = learningPath.visible;
      scene.add(learningPath.group);
    }

    function resetCameraView(): void {
      const resetBtn = document.getElementById('reset-view-btn');
      if (resetBtn) resetBtn.classList.remove('visible');
      gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 1.2 });
      gsap.to(camera.position, {
        x: 700,
        y: 500,
        z: 700,
        duration: 1.5,
      });
      allNodes.forEach((n) => {
        gsap.to(n.scale, { x: 1, y: 1, z: 1, duration: 0.5 });
        if (n.userData.clusterColor) setNodeColor(n, n.userData.clusterColor);
      });
      allLinks.forEach((l) => {
        if (l.userData.isInternal) {
          l.visible = false;
        } else {
          (l.material as THREE.LineBasicMaterial).color.set(l.userData.clusterColor);
          gsap.to(l.material, {
            opacity: l.userData.baseOpacity,
            duration: 0.5,
          });
        }
      });
    }

    // Expose resetCameraView via window so imperative handle can call it
    (window as unknown as Record<string, unknown>).__resetCameraView =
      resetCameraView;

    (window as unknown as Record<string, unknown>).__toggleLearningPath =
      () => {
        learningPath.visible = !learningPath.visible;
        learningPath.group.visible = learningPath.visible;
      };
    (window as unknown as Record<string, unknown>).__isLearningPathVisible =
      () => learningPath.visible;

    // --- Init Three.js ---

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      10000
    );
    camera.position.set(700, 500, 700);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    containerRef.current.appendChild(renderer.domElement);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.1,
      0.4,
      0.85
    );
    bloomPass.threshold = 0.08;
    bloomPass.strength = 1.1;
    bloomPass.radius = 0.6;
    composer.addPass(bloomPass);

    scene.fog = new THREE.FogExp2(0x020208, 0.00015);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.2;

    // --- Far stars (10000 points) ---
    const farStarGeo = new THREE.BufferGeometry();
    const farStarPos = new Float32Array(30000);
    const farStarColors = new Float32Array(30000);
    for (let i = 0; i < 10000; i++) {
      const r = 2000 + Math.random() * 3000;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      farStarPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      farStarPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      farStarPos[i * 3 + 2] = r * Math.cos(phi);
      const tint = Math.random();
      if (tint < 0.3) {
        farStarColors[i * 3] = 0.6;
        farStarColors[i * 3 + 1] = 0.7;
        farStarColors[i * 3 + 2] = 1;
      } else if (tint < 0.5) {
        farStarColors[i * 3] = 1;
        farStarColors[i * 3 + 1] = 0.9;
        farStarColors[i * 3 + 2] = 0.6;
      } else {
        farStarColors[i * 3] = 0.7;
        farStarColors[i * 3 + 1] = 0.7;
        farStarColors[i * 3 + 2] = 0.7;
      }
    }
    farStarGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(farStarPos, 3)
    );
    farStarGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(farStarColors, 3)
    );
    const starField = new THREE.Points(
      farStarGeo,
      new THREE.PointsMaterial({
        size: 1.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
      })
    );
    scene.add(starField);

    // --- Bright stars (200 points) ---
    const brightStarGeo = new THREE.BufferGeometry();
    const brightStarPos = new Float32Array(600);
    for (let i = 0; i < 200; i++) {
      const r = 800 + Math.random() * 2000;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      brightStarPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      brightStarPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      brightStarPos[i * 3 + 2] = r * Math.cos(phi);
    }
    brightStarGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(brightStarPos, 3)
    );
    scene.add(
      new THREE.Points(
        brightStarGeo,
        new THREE.PointsMaterial({
          size: 3,
          color: 0xffffff,
          transparent: true,
          opacity: 0.8,
        })
      )
    );

    // --- Milky Way band (6000 particles) ---
    const milkyWayGeo = new THREE.BufferGeometry();
    const milkyCount = 6000;
    const milkyPos = new Float32Array(milkyCount * 3);
    const milkyColors = new Float32Array(milkyCount * 3);
    for (let i = 0; i < milkyCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 200 + Math.random() * 600;
      const spread = (Math.random() - 0.5) * 40;
      milkyPos[i * 3] =
        Math.cos(angle) * r + (Math.random() - 0.5) * 30;
      milkyPos[i * 3 + 1] = spread;
      milkyPos[i * 3 + 2] =
        Math.sin(angle) * r + (Math.random() - 0.5) * 30;
      const t = Math.random();
      milkyColors[i * 3] = 0.3 + t * 0.3;
      milkyColors[i * 3 + 1] = 0.3 + t * 0.2;
      milkyColors[i * 3 + 2] = 0.5 + t * 0.5;
    }
    milkyWayGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(milkyPos, 3)
    );
    milkyWayGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(milkyColors, 3)
    );
    const milkyWay = new THREE.Points(
      milkyWayGeo,
      new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.25,
      })
    );
    milkyWay.rotation.x = -0.4;
    milkyWay.rotation.z = -0.2;
    scene.add(milkyWay);

    // --- Comets (5 orbiting trails) ---
    const cometColors = [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff];
    for (let c = 0; c < 5; c++) {
      const cometGeo = new THREE.BufferGeometry();
      const tailLen = 120;
      const cometPos = new Float32Array(tailLen * 3);
      const orbitR = 160 + c * 50;
      const orbitTilt = 0.2 + c * 0.25;
      const orbitTwist = c * 1.2;
      const startAngle = Math.random() * Math.PI * 2;
      for (let i = 0; i < tailLen; i++) {
        const a = startAngle + (i / tailLen) * Math.PI * 0.8;
        const rr = orbitR + (Math.random() - 0.5) * 8;
        let x = Math.cos(a) * rr;
        let y = (Math.random() - 0.5) * 4;
        let z = Math.sin(a) * rr;
        const cosT = Math.cos(orbitTilt),
          sinT = Math.sin(orbitTilt);
        const ny = y * cosT - z * sinT;
        const nz = y * sinT + z * cosT;
        const cosW = Math.cos(orbitTwist),
          sinW = Math.sin(orbitTwist);
        const nx = x * cosW - ny * sinW;
        const nny = x * sinW + ny * cosW;
        cometPos[i * 3] = nx;
        cometPos[i * 3 + 1] = nny;
        cometPos[i * 3 + 2] = nz;
      }
      cometGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(cometPos, 3)
      );
      const comet = new THREE.Points(
        cometGeo,
        new THREE.PointsMaterial({
          size: 2.5,
          color: cometColors[c],
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
        })
      );
      comet.userData = {
        orbitR,
        orbitTilt,
        orbitTwist,
        startAngle,
        speed: 0.0003 + c * 0.0001,
        isComet: true,
        tailLen,
      };
      scene.add(comet);
    }

    // --- Node & link groups ---
    nodesGroup = new THREE.Group();
    linksGroup = new THREE.Group();
    scene.add(nodesGroup);
    scene.add(linksGroup);

    createCore();
    createClusters();

    // --- Learning Path ---
    buildDemoLearningPath();
    createLearningPath();

    // --- Event listeners ---

    // Right-click context menu suppression
    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // Click to focus
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodesGroup.children, true);
      if (hits.length > 0) {
        let obj = hits[0].object as THREE.Object3D;
        while (
          obj.parent &&
          obj.parent !== nodesGroup &&
          obj.parent !== scene
        )
          obj = obj.parent;
        if (obj.userData && obj.userData.name) focusNode(obj as THREE.Group);
      }
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);

    // Resize handler
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // --- Animation loop ---

    function animate() {
      animationId = requestAnimationFrame(animate);
      controls.update();
      composer.render();
      nodesGroup.position.y = 0;
      linksGroup.position.y = 0;

      scene.children.forEach((child) => {
        if (child.userData && child.userData.isComet) {
          const d = child.userData;
          d.startAngle += d.speed * cometSpeedMultiplier;
          const posArr = (child as THREE.Points).geometry.attributes.position
            .array as Float32Array;
          for (let i = 0; i < d.tailLen; i++) {
            const a = d.startAngle + (i / d.tailLen) * Math.PI * 0.8;
            const rr = d.orbitR + (Math.random() - 0.5) * 4;
            let x = Math.cos(a) * rr;
            let y = (Math.random() - 0.5) * 3;
            let z = Math.sin(a) * rr;
            const cosT = Math.cos(d.orbitTilt),
              sinT = Math.sin(d.orbitTilt);
            const ny = y * cosT - z * sinT;
            const nz = y * sinT + z * cosT;
            const cosW = Math.cos(d.orbitTwist),
              sinW = Math.sin(d.orbitTwist);
            posArr[i * 3] = x * cosW - ny * sinW;
            posArr[i * 3 + 1] = x * sinW + ny * cosW;
            posArr[i * 3 + 2] = nz;
          }
          (
            (child as THREE.Points).geometry.attributes.position
          ).needsUpdate = true;
        }
      });

      // Learning path flow animation
      if (learningPath.visible && learningPath.curve && learningPath.flowParticles) {
        learningPath.flowOffset += 0.0012;
        if (learningPath.flowOffset > 1) learningPath.flowOffset -= 1;
        const fpArr = (
          learningPath.flowParticles.geometry.attributes.position as THREE.BufferAttribute
        ).array as Float32Array;
        const fpCount = fpArr.length / 3;
        for (let i = 0; i < fpCount; i++) {
          const t = (learningPath.flowOffset + i / fpCount) % 1;
          const pt = learningPath.curve!.getPointAt(t);
          fpArr[i * 3] = pt.x;
          fpArr[i * 3 + 1] = pt.y;
          fpArr[i * 3 + 2] = pt.z;
        }
        (
          learningPath.flowParticles.geometry.attributes.position as THREE.BufferAttribute
        ).needsUpdate = true;
      }

      frames++;
      const now = performance.now();
      if (now > lastTime + 1000) {
        const fps = Math.round((frames * 1000) / (now - lastTime));
        const fpsEl = document.getElementById('cluster-fps');
        if (fpsEl) fpsEl.textContent = String(fps);
        const fpsDisplay = document.getElementById('fps-display');
        if (fpsDisplay) fpsDisplay.textContent = String(fps);
        frames = 0;
        lastTime = now;
      }
      const coordsEl = document.getElementById('cluster-coords');
      if (coordsEl)
        coordsEl.textContent = `${camera.position.x.toFixed(1)} / ${camera.position.y.toFixed(1)} / ${camera.position.z.toFixed(1)}`;
    }

    animate();

    // Store refs for cleanup
    threeState.current = {
      scene,
      camera,
      renderer,
      controls,
      composer,
      animationId,
    };
    mutableState.current.nodesGroup = nodesGroup;
    mutableState.current.linksGroup = linksGroup;
    mutableState.current.bloomPass = bloomPass;
    mutableState.current.frames = frames;
    mutableState.current.lastTime = lastTime;
    mutableState.current.cometSpeedMultiplier = cometSpeedMultiplier;

    // --- Cleanup on unmount ---
    return () => {
      // Stop animation loop
      if (animationId) cancelAnimationFrame(animationId);

      // Remove event listeners
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);

      // Kill any active gsap tweens
      gsap.killTweensOf(controls.target);
      gsap.killTweensOf(camera.position);

      // Clean up window ref
      delete (window as unknown as Record<string, unknown>).__resetCameraView;
      delete (window as unknown as Record<string, unknown>).__toggleLearningPath;
      delete (window as unknown as Record<string, unknown>).__isLearningPathVisible;

      // Dispose learning path
      learningPath.group.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      scene.remove(learningPath.group);

      // Dispose all geometries and materials in nodesGroup
      nodesGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });

      // Clean up all link geometries and materials
      allLinks.forEach((l) => {
        l.geometry.dispose();
        if (l.material) {
          if (Array.isArray(l.material)) {
            l.material.forEach((m) => m.dispose());
          } else {
            l.material.dispose();
          }
        }
      });

      // Dispose scene children (stars, comets, milky way, etc.)
      scene.traverse((obj) => {
        if ((obj as THREE.Points).geometry) {
          (obj as THREE.Points).geometry.dispose();
        }
        const mat = (obj as THREE.Points).material as THREE.Material | undefined;
        if (mat) {
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });

      // Dispose composer passes
      composer.passes.forEach((pass) => {
        if (pass.dispose) pass.dispose();
      });

      // Dispose renderer
      renderer.dispose();

      // Remove canvas from DOM
      if (
        containerRef.current &&
        renderer.domElement.parentNode === containerRef.current
      ) {
        containerRef.current.removeChild(renderer.domElement);
      }

      // Clear state arrays
      allNodes.length = 0;
      allLinks.length = 0;
      adjMap.clear();
      clusterNodes.clear();
      clusterSuns.clear();
    };
  }, []);

  return (
    <div
      id="canvas-container"
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
      }}
    />
  );
});

export default GalaxyCanvas;
