'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import gsap from 'gsap';
import type { GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/types/galaxy';

// ── Seeded pseudo-random (replaces Math.random for stable positioning) ──────────
// Same seed → same sequence every time. Makes rebuilds deterministic — existing
// nodes stay at the same position when data grows incrementally.
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) - h) + id.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}
import { useGalaxyActions, useAppStore } from '@/stores/mode-store';

export interface GalaxyCanvasHandle {
  resetCameraView: () => void;
}

interface GalaxyCanvasProps {
  vaultId?: string | null
  nodes?: GalaxyNode[]
  edges?: GalaxyEdge[]
  clusters?: GalaxyCluster[]
  learningPathSteps?: { id: string; index: number; name: string; status?: string }[]
}

const GalaxyCanvas = forwardRef<GalaxyCanvasHandle, GalaxyCanvasProps>(function GalaxyCanvas({ nodes = [], edges = [], clusters = [], vaultId = null, learningPathSteps = [] }: GalaxyCanvasProps, ref) {
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
      const resetFn = useGalaxyActions.getState().actions.resetCameraView
      if (resetFn) resetFn()
    },
  }));

  // Store data props in a ref so useEffect can access them
  const dataRef = useRef({ nodes, edges, clusters, learningPathSteps });
  dataRef.current = { nodes, edges, clusters, learningPathSteps };

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
    const GALAXY_LAYOUT = {
      clusterMinDistance: 330,
      clusterDistanceJitter: 135,
      clusterInnerRadius: 78,
      clusterMiddleRadius: 150,
      clusterOuterRadius: 228,
      clusterLayerGap: 24,
    };

    let frames = 0;
    let lastTime = performance.now();
    let cometSpeedMultiplier = 1.0;
    let autoRotateBeforeFocus: boolean | null = null;
    let lastFocusSelection: THREE.Group[] = [];
    let hoveredNode: THREE.Group | null = null;
    let lockedNode: THREE.Group | null = null;
    let lastHoverRaycastAt = 0;
    const dimNodeModes = new Set(['forge', 'cognition', 'learn']);

    const { register, unregister } = useGalaxyActions.getState()

    // --- Deep Space Background (Nebula & Distant Stars) ---
    let nebulaGroup: THREE.Group;
    function createNebula(s: THREE.Scene) {
      nebulaGroup = new THREE.Group();
      nebulaGroup.name = 'NEBULA';
      s.add(nebulaGroup);

      const createCloudTexture = (color: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        const c = new THREE.Color(color);
        grad.addColorStop(0, `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)}, 0.15)`);
        grad.addColorStop(0.4, `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)}, 0.05)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(canvas);
      };

      const nebulaColors = [0x4422ff, 0xff2266, 0x22eeff, 0xa855f7];
      for(let i=0; i<12; i++) {
        const tex = createCloudTexture(nebulaColors[i % nebulaColors.length]);
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.3
        });
        const sprite = new THREE.Sprite(mat);
        const r = 2000 + seededRandom(i * 123) * 1000;
        const theta = seededRandom(i * 456) * Math.PI * 2;
        const phi = Math.acos(seededRandom(i * 789) * 2 - 1);
        sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
        sprite.scale.set(1500 + seededRandom(i) * 1000, 1500 + seededRandom(i) * 1000, 1);
        sprite.userData = { rotationSpeed: (seededRandom(i) - 0.5) * 0.001 };
        nebulaGroup.add(sprite);
      }
    }


    // --- Learning Path State ---
    const learningPath = {
      visible: false,
      steps: [] as { node: THREE.Group; stepIndex: number; status?: string }[],
      curve: null as THREE.CatmullRomCurve3 | null,
      group: new THREE.Group(),
      flowParticles: null as THREE.Points | null,
      stepLabels: [] as THREE.Sprite[],
      flowOffset: 0,
    };

    // --- HTML Label Overlay (avoids Three.js bloom/fog issues) ---
    const labelOverlay = document.createElement('div');
    labelOverlay.id = 'galaxy-label-overlay';
    labelOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:hidden;';
    containerRef.current!.appendChild(labelOverlay);

    // Cluster labels (persistent, always visible)
    const clusterLabelData: { name: string; color: number; position: THREE.Vector3 }[] = [];

    function addClusterLabel(name: string, color: number, pos: THREE.Vector3) {
      clusterLabelData.push({ name, color, position: pos.clone() });
    }

    // Node labels (temporary, cleared on click)
    let nodeLabelItems: { text: string; position: THREE.Vector3; isFocused: boolean }[] = [];

    function setNodeLabelsFromNode(focusedNode: THREE.Group): void {
      nodeLabelItems = [];
      const shown = new Set<THREE.Group>();
      // Focused node — skip if sun (cluster name already shown persistently)
      const isSun = focusedNode.userData.isSun === true;
      if (!isSun) {
        const fName: string = focusedNode.userData.name || '';
        if (fName) {
          nodeLabelItems.push({ text: fName, position: focusedNode.position.clone(), isFocused: true });
          shown.add(focusedNode);
        }
      }
      // Neighbors from adjMap (semantic WikiLink edges)
      const neighbors = adjMap.get(focusedNode);
      if (neighbors) {
        neighbors.forEach((n) => {
          if (!shown.has(n) && !n.userData.isSun) {
            shown.add(n);
            const nName: string = n.userData.name || '';
            if (nName) nodeLabelItems.push({ text: nName, position: n.position.clone(), isFocused: false });
          }
        });
      }
      // If focused node is a cluster sun, also show all subnode labels
      if (isSun) {
        const cid = focusedNode.userData.clusterId;
        const subNodes = clusterNodes.get(cid) || [];
        subNodes.forEach((n) => {
          if (!shown.has(n)) {
            shown.add(n);
            const nName: string = n.userData.name || '';
            if (nName) nodeLabelItems.push({ text: nName, position: n.position.clone(), isFocused: false });
          }
        });
      }
    }

    function clearNodeLabels(): void {
      nodeLabelItems = [];
    }

    function renderLabels(): void {
      if (!labelOverlay.parentNode) return;
      // Use document fragment to batch DOM operations
      const frag = document.createDocumentFragment();
      const halfW = window.innerWidth / 2;
      const halfH = window.innerHeight / 2;

      // Render cluster labels
      for (const cl of clusterLabelData) {
        const v = cl.position.clone().project(camera);
        if (v.z > 1) continue;
        const x = v.x * halfW + halfW;
        const y = -(v.y * halfH) + halfH;
        const div = document.createElement('div');
        div.textContent = cl.name;
        div.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-100%);padding:1px 7px;border-radius:4px;font-family:"Noto Sans SC","JetBrains Mono",sans-serif;font-weight:600;font-size:12px;color:rgba(255,255,255,0.22);background:rgba(0,0,0,0.16);white-space:nowrap;pointer-events:none;user-select:none;letter-spacing:0.12em;text-transform:uppercase;`;
        frag.appendChild(div);
      }

      // Render node labels (clicked node + neighbors)
      for (const nl of nodeLabelItems) {
        const v = nl.position.clone().project(camera);
        if (v.z > 1) continue;
        const x = v.x * halfW + halfW;
        const y = -(v.y * halfH) + halfH;
        const div = document.createElement('div');
        div.textContent = nl.text;
        const top = y - (nl.isFocused ? 28 : 20);
        div.style.cssText = `position:absolute;left:${x}px;top:${top}px;transform:translateX(-50%);padding:2px 7px;border-radius:3px;font-family:"Noto Sans SC","JetBrains Mono",sans-serif;font-weight:${nl.isFocused ? '700' : '400'};font-size:${nl.isFocused ? '14px' : '11px'};color:rgba(255,255,255,${nl.isFocused ? '0.84' : '0.48'});background:rgba(0,0,0,0.26);white-space:nowrap;pointer-events:none;user-select:none;`;
        frag.appendChild(div);
      }

      // Replace overlay content
      labelOverlay.innerHTML = '';
      labelOverlay.appendChild(frag);
    }

    // Store refs for cleanup
    mutableState.current.allNodes = allNodes;
    mutableState.current.allLinks = allLinks;
    mutableState.current.adjMap = adjMap;
    mutableState.current.clusterNodes = clusterNodes;
    mutableState.current.clusterSuns = clusterSuns;

    // --- Helper functions ---

    function createGlowTexture(color: number, type: 'core' | 'halo' | 'ring' = 'core'): THREE.CanvasTexture {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const c = new THREE.Color(color);
      const r = Math.round(c.r * 255),
        g = Math.round(c.g * 255),
        b = Math.round(c.b * 255);

      ctx.clearRect(0, 0, 128, 128);

      if (type === 'core') {
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.1, `rgba(${r},${g},${b},0.8)`);
        grad.addColorStop(0.3, `rgba(${r},${g},${b},0.3)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
      } else if (type === 'halo') {
        const grad = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.5, `rgba(${r},${g},${b},0.2)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
      }

      return new THREE.CanvasTexture(canvas);
    }

    function createGlowNode(
      color: number,
      size: number,
      name: string
    ): THREE.Group {
      const group = new THREE.Group();

      // 1. Central Energy Core
      const coreGeo = new THREE.SphereGeometry(size * 0.35, 16, 16);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      group.add(core);

      // 2. Inner Glow (Main Color)
      const innerGlowMat = new THREE.SpriteMaterial({
        map: createGlowTexture(color, 'core'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const innerGlow = new THREE.Sprite(innerGlowMat);
      innerGlow.scale.set(size * 8, size * 8, 1);
      group.add(innerGlow);

      // 3. Outer Atmosphere / Halo
      const haloMat = new THREE.SpriteMaterial({
        map: createGlowTexture(color, 'halo'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.4
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(size * 15, size * 15, 1);
      group.add(halo);

      // 4. Data Rings (for important nodes)
      if (size > 3.5 || name.includes('CLUSTER')) {
        const ringGeo = new THREE.RingGeometry(size * 1.8, size * 1.9, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        // Random slight tilt for rings
        ring.rotation.y = Math.random() * 0.4;
        group.add(ring);
        group.userData.ring = ring;
      }

      group.userData = { ...group.userData, name, color, baseSize: size, baseScale: 1 };
      allNodes.push(group);
      return group;
    }

    // --- Flowing Link Logic ---
    const flows: { points: THREE.Vector3[], mesh: THREE.Points, speed: number, offset: number }[] = [];

    function createCurve(
      sourceNode: THREE.Group,
      targetNode: THREE.Group,
      color: number,
      opacity: number,
      isInternal?: boolean,
      trueColor?: number,
      semantic?: boolean
    ): void {
      const start = sourceNode.position;
      const end = targetNode.position;
      const dist = start.distanceTo(end);

      // Strong orbital curvature: use a deterministic side vector plus a small
      // outward lift so long overview links read as arcs instead of straight chords.
      const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
      const curveSeed = hashId(String(sourceNode.userData.id || '') + String(targetNode.userData.id || ''));
      const direction = new THREE.Vector3().subVectors(end, start).normalize();
      const centerOut = mid.lengthSq() > 1 ? mid.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(direction, centerOut);
      if (side.lengthSq() < 0.01) side.crossVectors(direction, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      side.normalize().multiplyScalar(seededRandom(curveSeed) > 0.5 ? 1 : -1);
      const arcStrength = semantic ? 0.28 : 0.36;
      const offsetMag = Math.min(180, Math.max(34, dist * arcStrength));
      mid
        .add(side.multiplyScalar(offsetMag))
        .add(centerOut.multiplyScalar(Math.min(90, dist * 0.16)));

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const points = curve.getPoints(56);
      const geo = new THREE.BufferGeometry().setFromPoints(points);

      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: color,
          transparent: true,
          opacity: opacity * (semantic ? 0.44 : 0.5),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );

      line.userData = {
        source: sourceNode,
        target: targetNode,
        baseOpacity: opacity,
        isInternal: !!isInternal,
        semantic: !!semantic,
        clusterColor: color,
        trueColor: trueColor || color,
        curve,
      };

      if (isInternal || semantic) line.visible = false;
      linksGroup.add(line);
      allLinks.push(line);

      if (semantic) {
        if (!adjMap.has(sourceNode)) adjMap.set(sourceNode, new Set());
        if (!adjMap.has(targetNode)) adjMap.set(targetNode, new Set());
        adjMap.get(sourceNode)!.add(targetNode);
        adjMap.get(targetNode)!.add(sourceNode);

        // Add energy flow for semantic links
        const pCount = Math.floor(dist / 20) + 2;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(pCount * 3);
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({
          color: trueColor || color,
          size: 1.5,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const flowMesh = new THREE.Points(pGeo, pMat);
        flowMesh.visible = false; // Hidden until focused
        linksGroup.add(flowMesh);
        flows.push({ points, mesh: flowMesh, speed: 0.005 + Math.random() * 0.01, offset: Math.random() });
        line.userData.flowMesh = flowMesh;
      }
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

    function applyNodeModeVisual(mode: string, immediate = false): void {
      const dimmed = dimNodeModes.has(mode);
      const scaleFactor = dimmed ? 0.72 : 1;
      const opacityFactor = dimmed ? 0.42 : 1;
      const duration = immediate ? 0 : 0.35;

      allNodes.forEach((node) => {
        node.children.forEach((child) => {
          if (!child.userData.nodeBaseScale) child.userData.nodeBaseScale = child.scale.clone();
          const baseScale = child.userData.nodeBaseScale as THREE.Vector3;
          gsap.to(child.scale, {
            x: baseScale.x * scaleFactor,
            y: baseScale.y * scaleFactor,
            z: baseScale.z * scaleFactor,
            duration,
            ease: 'power2.out',
          });

          const material = (child as THREE.Mesh | THREE.Sprite).material as THREE.Material | THREE.Material[] | undefined;
          const materials = Array.isArray(material) ? material : material ? [material] : [];
          materials.forEach((mat) => {
            const maybeTransparent = mat as THREE.Material & { opacity?: number };
            if (typeof maybeTransparent.opacity !== 'number') return;
            if (mat.userData.nodeBaseOpacity === undefined) mat.userData.nodeBaseOpacity = maybeTransparent.opacity;
            mat.transparent = true;
            gsap.to(maybeTransparent, {
              opacity: (mat.userData.nodeBaseOpacity as number) * opacityFactor,
              duration,
              ease: 'power2.out',
            });
          });
        });
      });
    }

    function createCore(name: string): void {
      const core = createGlowNode(0xffffff, 9.5, 'CENTRAL_INTELLIGENCE');
      nodesGroup.add(core);
    }

    function getFocusSelection(node: THREE.Group): THREE.Group[] {
      if (node.userData.isSun) {
        const cid = node.userData.clusterId;
        return [node, ...(clusterNodes.get(cid) || []).filter(n => n.visible !== false)];
      }

      const directNeighbors = Array.from(adjMap.get(node) || []).filter(n => n.visible !== false);
      const selection = new Set<THREE.Group>([node, ...directNeighbors]);

      // For highly connected nodes, include a controlled second ring so the
      // camera frames the visible relationship context instead of just endpoints.
      if (directNeighbors.length >= 8) {
        directNeighbors.slice(0, 12).forEach(neighbor => {
          Array.from(adjMap.get(neighbor) || [])
            .filter(n => n.visible !== false)
            .slice(0, 3)
            .forEach(n => selection.add(n));
        });
      }

      return Array.from(selection);
    }

    function frameSelection(selection: THREE.Group[], focusNode?: THREE.Group, duration = 1.35): void {
      const visibleSelection = selection.filter(n => n.visible !== false);
      if (visibleSelection.length === 0) return;

      const box = new THREE.Box3();
      visibleSelection.forEach(n => box.expandByPoint(n.position));
      const center = new THREE.Vector3();
      box.getCenter(center);

      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      const radius = Math.max(
        sphere.radius,
        focusNode?.userData.isSun ? GALAXY_LAYOUT.clusterOuterRadius : 90
      );

      const currentDirection = new THREE.Vector3()
        .subVectors(camera.position, controls.target)
        .normalize();
      if (currentDirection.lengthSq() < 0.01) currentDirection.set(0.62, 0.42, 0.66).normalize();

      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      const padding = focusNode?.userData.isSun ? 1.45 : 1.65;
      const desiredDistance = THREE.MathUtils.clamp(
        (radius / Math.sin(limitingFov / 2)) * padding,
        focusNode?.userData.isSun ? 380 : 240,
        1600
      );
      const cameraTarget = center.clone().add(currentDirection.multiplyScalar(desiredDistance));

      gsap.killTweensOf(controls.target);
      gsap.killTweensOf(camera.position);
      gsap.to(controls.target, {
        x: center.x,
        y: center.y,
        z: center.z,
        duration,
        ease: 'expo.out',
      });
      gsap.to(camera.position, {
        x: cameraTarget.x,
        y: cameraTarget.y,
        z: cameraTarget.z,
        duration: duration + 0.15,
        ease: 'expo.out',
      });
    }

    function getInteractionNeighbors(node: THREE.Group): Set<THREE.Group> {
      if (node.userData.isSun) {
        const cid = node.userData.clusterId;
        return new Set((clusterNodes.get(cid) || []).filter(n => n.visible !== false));
      }
      return new Set(Array.from(adjMap.get(node) || []).filter(n => n.visible !== false));
    }

    function setNodeScale(node: THREE.Group, scale: number, duration = 0.24): void {
      if (!node.visible) return;
      gsap.to(node.scale, { x: scale, y: scale, z: scale, duration, ease: 'power2.out' });
    }

    function setNodeOpacity(node: THREE.Group, opacityFactor: number, duration = 0.24): void {
      node.children.forEach((child) => {
        const material = (child as THREE.Mesh | THREE.Sprite).material as THREE.Material | THREE.Material[] | undefined;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        materials.forEach((mat) => {
          const maybeTransparent = mat as THREE.Material & { opacity?: number };
          if (typeof maybeTransparent.opacity !== 'number') return;
          if (mat.userData.nodeBaseOpacity === undefined) mat.userData.nodeBaseOpacity = maybeTransparent.opacity;
          mat.transparent = true;
          gsap.to(maybeTransparent, {
            opacity: (mat.userData.nodeBaseOpacity as number) * opacityFactor,
            duration,
            ease: 'power2.out',
          });
        });
      });
    }

    function setNodePresence(node: THREE.Group, scale: number, opacity: number, duration = 0.24): void {
      setNodeScale(node, scale, duration);
      setNodeOpacity(node, opacity, duration);
    }

    function setLinkOpacity(line: THREE.Line, opacity: number, duration = 0.22): void {
      if (line.userData._filtered) return;
      const mat = line.material as THREE.LineBasicMaterial;
      line.visible = opacity > 0.012;
      gsap.to(mat, { opacity, duration, ease: 'power2.out' });
    }

    function applyGraphAttention(node: THREE.Group | null, locked = false): void {
      if (!node) {
        allNodes.forEach((n) => {
          if (!n.visible) return;
          setNodePresence(n, 1, 1, 0.26);
          if (n.userData.trueColor) setNodeColor(n, n.userData.trueColor);
        });
        allLinks.forEach((l) => {
          if (l.userData._filtered) return;
          if (l.userData.isInternal || l.userData.semantic) {
            l.visible = false;
            if (l.userData.flowMesh) l.userData.flowMesh.visible = false;
            return;
          }
          l.visible = true;
          (l.material as THREE.LineBasicMaterial).color.set(l.userData.clusterColor);
          setLinkOpacity(l, l.userData.baseOpacity, 0.24);
        });
        clearNodeLabels();
        return;
      }

      const neighbors = getInteractionNeighbors(node);
      const primary = new Set<THREE.Group>([node, ...neighbors]);
      allNodes.forEach((n) => {
        if (!n.visible) return;
        if (n === node) setNodePresence(n, locked ? 1.34 : 1.2, 1, 0.24);
        else if (neighbors.has(n)) setNodePresence(n, 1.02, locked ? 0.9 : 0.82, 0.24);
        else setNodePresence(n, locked ? 0.58 : 0.78, locked ? 0.12 : 0.32, 0.24);
        if (primary.has(n) && n.userData.trueColor) setNodeColor(n, n.userData.trueColor);
      });

      allLinks.forEach((l) => {
        if (l.userData._filtered) return;
        const s = l.userData.source as THREE.Group;
        const t = l.userData.target as THREE.Group;
        const directlyRelated = (s === node && neighbors.has(t)) || (t === node && neighbors.has(s));
        const localContext = primary.has(s) && primary.has(t);
        if (l.userData.flowMesh) l.userData.flowMesh.visible = directlyRelated && locked;

        if (directlyRelated) {
          (l.material as THREE.LineBasicMaterial).color.set(l.userData.trueColor || l.userData.clusterColor || 0xffffff);
          setLinkOpacity(l, locked ? 0.88 : 0.72, 0.18);
        } else if (localContext && (l.userData.semantic || l.userData.isInternal)) {
          (l.material as THREE.LineBasicMaterial).color.set(l.userData.trueColor || l.userData.clusterColor || 0xffffff);
          setLinkOpacity(l, 0.2, 0.18);
        } else if (l.userData.semantic || l.userData.isInternal) {
          setLinkOpacity(l, 0, 0.18);
        } else {
          setLinkOpacity(l, locked ? 0.008 : 0.035, 0.18);
        }
      });

      setNodeLabelsFromNode(node);
    }

    function focusNode(node: THREE.Group): void {
      const resetBtn = document.getElementById('reset-view-btn');
      if (resetBtn) resetBtn.classList.add('visible');
      if (autoRotateBeforeFocus === null) autoRotateBeforeFocus = controls.autoRotate;
      controls.autoRotate = false;
      const focusSelection = getFocusSelection(node);
      lastFocusSelection = focusSelection;
      frameSelection(focusSelection, node, node.userData.isSun ? 1.15 : 0.75);
      lockedNode = node;
      hoveredNode = null;

      // Special highlight for focused node
      if (node.userData.ring) {
        gsap.to(node.userData.ring.scale, { x: 1.5, y: 1.5, z: 1.5, duration: 0.5 });
        gsap.to(node.userData.ring.material, { opacity: 0.8, duration: 0.5 });
      }
      if (node.userData.isSun) currentClusterId = node.userData.clusterId;
      applyNodeModeVisual(useAppStore.getState().mode);
      applyGraphAttention(node, true);
    }

    // --- Learning Path ---
    function buildDemoLearningPath(stepsFromProps?: { id: string; index: number; name: string; status?: string }[]): void {
      const steps: { node: THREE.Group; stepIndex: number; status?: string }[] = [];

      if (stepsFromProps && stepsFromProps.length > 0) {
        for (const s of stepsFromProps) {
          // Search ALL scene nodes (not just clusterNodes) with progressive fallback
          let found: THREE.Group | undefined;

          // 1) Exact ID match
          found = allNodes.find(n => n.userData.id === s.id);

          // 2) Exact title match
          if (!found) {
            found = allNodes.find(n => {
              const nodeName = (n.userData.name || '').toLowerCase().trim();
              return nodeName && nodeName === s.name.toLowerCase().trim();
            });
          }

          // 3) Partial title match (bi-directional)
          if (!found) {
            const q = s.name.toLowerCase().trim();
            found = allNodes.find(n => {
              const nodeName = (n.userData.name || '').toLowerCase().trim();
              return nodeName && (nodeName.includes(q) || q.includes(nodeName));
            });
          }

          if (found) steps.push({ node: found, stepIndex: s.index, status: s.status });
        }

        if (steps.length >= 2) {
          learningPath.steps = steps;
          return;
        }
        // Not enough matches — clear path gracefully
        steps.length = 0;
      }

      // No valid steps to show — clear path
      learningPath.steps = [];
    }

    function clearLearningPath(): void {
      while (learningPath.group.children.length > 0) {
        const child = learningPath.group.children[0];
        if ((child as THREE.Mesh).geometry) {
          (child as THREE.Mesh).geometry.dispose();
          const mat = (child as THREE.Mesh).material;
          if (mat) {
            if (Array.isArray(mat)) {
              mat.forEach(m => m.dispose());
            } else {
              mat.dispose();
            }
          }
        }
        if ((child as THREE.Points).geometry) {
          (child as THREE.Points).geometry.dispose();
          const mat = (child as THREE.Points).material;
          if (mat) {
            if (Array.isArray(mat)) {
              mat.forEach(m => m.dispose());
            } else {
              mat.dispose();
            }
          }
        }
        learningPath.group.remove(child);
      }
      learningPath.steps = [];
      learningPath.curve = null;
      learningPath.flowParticles = null;
      learningPath.stepLabels = [];
    }

    function createLearningPath(): void {
      if (learningPath.steps.length < 2) return;
      const points = learningPath.steps.map((s) => s.node.position.clone());
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
      learningPath.curve = curve;

      // ── Simple path tube (clean, no animations) ──
      const tubeSegments = Math.max(learningPath.steps.length * 30, 80);
      const tubeGeo = new THREE.TubeGeometry(curve, tubeSegments, 1.5, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xff4466,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      learningPath.group.add(tube);

      // ── Step labels with holographic ring — status-aware coloring ──
      const statusColors: Record<string, { bg: string; stroke: string; ringColor: number; ringOpacity: number }> = {
        locked:    { bg: 'rgba(60,60,80,0.5)', stroke: 'rgba(80,80,100,0.3)', ringColor: 0x444466, ringOpacity: 0.1 },
        available: { bg: 'rgba(255,200,50,0.85)', stroke: 'rgba(255,180,30,0.6)', ringColor: 0xffcc22, ringOpacity: 0.4 },
        learning:  { bg: 'rgba(80,180,255,0.9)', stroke: 'rgba(60,160,255,0.7)', ringColor: 0x44aaff, ringOpacity: 0.6 },
        completed: { bg: 'rgba(80,220,100,0.7)', stroke: 'rgba(60,200,80,0.5)', ringColor: 0x44dd66, ringOpacity: 0.3 },
        mastered:  { bg: 'rgba(255,200,50,1)', stroke: 'rgba(255,180,30,0.8)', ringColor: 0xffcc22, ringOpacity: 0.6 },
      };
      const defaultColors = statusColors.available;

      const makeLabel = (n: number, status?: string) => {
        const c = document.createElement('canvas');
        c.width = 128; c.height = 128;
        const cx = c.getContext('2d')!;
        const sc = statusColors[status || ''] || defaultColors;
        cx.beginPath(); cx.arc(64, 64, 50, 0, Math.PI * 2);
        cx.fillStyle = sc.bg; cx.fill();
        cx.strokeStyle = sc.stroke; cx.lineWidth = 3; cx.stroke();
        cx.fillStyle = '#ffffff'; cx.font = 'bold 56px JetBrains Mono, monospace';
        cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(String(n), 64, 64);
        const t = new THREE.CanvasTexture(c);
        return { sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })), colors: sc };
      };
      for (let i = 0; i < learningPath.steps.length; i++) {
        const step = learningPath.steps[i];
        const { sprite, colors } = makeLabel(i + 1, step.status);
        const pos = step.node.position;
        sprite.position.set(pos.x, pos.y + 15, pos.z);
        sprite.scale.set(22, 22, 1);
        learningPath.stepLabels.push(sprite);
        learningPath.group.add(sprite);

        // Status-colored ring at the step location
        const ringGeo = new THREE.RingGeometry(12, 14, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: colors.ringColor,
          transparent: true,
          opacity: colors.ringOpacity,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.lookAt(camera.position);
        ring.userData.statusColors = colors;
        learningPath.group.add(ring);
      }

      learningPath.group.visible = learningPath.visible;
      scene.add(learningPath.group);
    }

    function createClustersFromData(clustersData: GalaxyCluster[], nodesData: GalaxyNode[], edgesData: GalaxyEdge[]): void {
      // Skip if no real data — wait for async fetch
      if (clustersData.length === 0 && nodesData.length === 0) return;

      const CLUSTER_COLORS = [0xa855f7, 0x22d3ee, 0xf472b6, 0x818cf8, 0x34d399, 0xfbbf24];
      const mixColors = [0xa855f7, 0x22d3ee, 0xf472b6];

      // Build a lookup from node title to node data for edge matching
      const nodeTitleToGroup = new Map<string, THREE.Group>();
      const nodeDegree = new Map<string, number>();
      edgesData.forEach(edge => {
        nodeDegree.set(edge.sourceId, (nodeDegree.get(edge.sourceId) || 0) + 1);
        nodeDegree.set(edge.targetId, (nodeDegree.get(edge.targetId) || 0) + 1);
      });

      // Create sun for each cluster
      clustersData.forEach((cluster, i) => {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / clustersData.length);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const dist = GALAXY_LAYOUT.clusterMinDistance + seededRandom(hashId(cluster.id)) * GALAXY_LAYOUT.clusterDistanceJitter;
        const cx = dist * Math.sin(phi) * Math.cos(theta);
        const cy = dist * Math.cos(phi) * 1.2;
        const cz = dist * Math.sin(phi) * Math.sin(theta);

        const color = parseInt(cluster.color.replace('#', ''), 16);
        const sun = createGlowNode(color, 5.2, cluster.name);
        sun.position.set(cx, cy, cz);
        sun.userData.isSun = true;
        sun.userData.clusterId = i;
        sun.userData.clusterColor = color;
        nodesGroup.add(sun);
        clusterSuns.set(i, sun);

        // Cluster name label — always visible above the sun
        const clusterPos = new THREE.Vector3(cx, cy, cz);
        addClusterLabel(cluster.name, 0xffffff, clusterPos);

        // Link sun to center
        const core = allNodes.find(n => n.userData.name === 'CENTRAL_INTELLIGENCE')!;
        if (core) createCurve(core, sun, color, 0.08, undefined, color, false);

        // Create nodes for cards in this cluster — with organic positioning + mixed colors
        const clusterNodeData = nodesData.filter(n => n.clusterId === cluster.id);
        const sortedClusterNodes = [...clusterNodeData].sort((a, b) => {
          const degreeDiff = (nodeDegree.get(b.id) || 0) - (nodeDegree.get(a.id) || 0);
          if (degreeDiff !== 0) return degreeDiff;
          const typeRank = (node: GalaxyNode) => node.type === 'permanent' ? 2 : node.type === 'literature' ? 1 : 0;
          return typeRank(b) - typeRank(a);
        });
        const subNodes: THREE.Group[] = [];
        sortedClusterNodes.forEach((cardNode, j) => {
          // Use deterministic positioning based on card ID — same card always gets the same position
          const seed = hashId(cardNode.id);
          const layer = j < 4 ? 0 : j < 14 ? 1 : 2;
          const layerIndex = layer === 0 ? j : layer === 1 ? j - 4 : j - 14;
          const layerCount = layer === 0 ? Math.min(4, sortedClusterNodes.length) : layer === 1 ? Math.min(10, Math.max(0, sortedClusterNodes.length - 4)) : Math.max(1, sortedClusterNodes.length - 14);
          const baseRadius = layer === 0 ? GALAXY_LAYOUT.clusterInnerRadius : layer === 1 ? GALAXY_LAYOUT.clusterMiddleRadius : GALAXY_LAYOUT.clusterOuterRadius;
          const radius = baseRadius + (seededRandom(seed) - 0.5) * GALAXY_LAYOUT.clusterLayerGap;
          const t = (layerIndex / Math.max(1, layerCount)) * Math.PI * 2 + seededRandom(seed + 1) * 0.55 + layer * 0.8;
          const yBand = layer === 0 ? 0.28 : layer === 1 ? 0.44 : 0.58;
          const verticalWave = Math.sin(t * 1.7 + seededRandom(seed + 2) * Math.PI) * radius * yBand;
          const orbitTilt = layer % 2 === 0 ? 0.82 : 0.58;
          const x = cx + Math.cos(t) * radius;
          const y = cy + verticalWave;
          const z = cz + Math.sin(t) * radius * orbitTilt;
          const distToSun = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
          const sizeFactor = Math.max(0.5, 1 - distToSun / 430);

          const baseSize = cardNode.type === 'permanent' ? 4.2 : cardNode.type === 'literature' ? 3.5 : 3.1;
          const degreeBoost = Math.min(0.9, (nodeDegree.get(cardNode.id) || 0) * 0.14);
          const layerBoost = layer === 0 ? 0.45 : layer === 1 ? 0.18 : 0;
          const nodeSize = baseSize * sizeFactor + degreeBoost + layerBoost;
          const nodeTypeColor = cardNode.type === 'permanent' ? 0xa855f7 : cardNode.type === 'literature' ? 0xf472b6 : 0x22d3ee;
          const node = createGlowNode(nodeTypeColor, nodeSize, cardNode.title);
          node.position.set(x, y, z);
          node.userData.id = cardNode.id;
          node.userData.clusterId = i;
          node.userData.clusterColor = color;
          node.userData.type = cardNode.type;
          node.userData.trueColor = nodeTypeColor;
          nodesGroup.add(node);
          subNodes.push(node);

          // Sun-to-node edge (like original: always visible)
          createCurve(sun, node, nodeTypeColor, 0.07, false, nodeTypeColor, false);

          // Store title-to-group mapping for edge lookup
          if (cardNode.title) nodeTitleToGroup.set(cardNode.title, node);
        });

        // Save to clusterNodes for focus/zoom animations
        clusterNodes.set(i, subNodes);
      });

      // Unclustered nodes — group by wiki-link affinity, then place compactly.
      // 1. Build a map: cardId → firstClusterId (from real edges)
      const linkTargetCluster = new Map<string, string | null>();
      // 2. Also collect unclustered node IDs for quick lookup
      const unclusteredIds = new Set(nodesData.filter(n => !n.clusterId).map(n => n.id));

      // Build cluster lookup by DB id (clustersData[i].id → i)
      const clusterIdxByDbId = new Map(clustersData.map((cl, i) => [cl.id, i]));

      // For each edge where an unclustered node connects to a clustered node,
      // assign the unclustered node to that cluster
      edgesData.forEach(edge => {
        const srcNode = nodesData.find(n => n.id === edge.sourceId);
        const tgtNode = nodesData.find(n => n.id === edge.targetId);
        if (!srcNode || !tgtNode) return;
        // Source is unclustered, target has a cluster
        if (unclusteredIds.has(edge.sourceId) && tgtNode.clusterId) {
          if (!linkTargetCluster.has(edge.sourceId)) linkTargetCluster.set(edge.sourceId, tgtNode.clusterId);
        }
        // Target is unclustered, source has a cluster
        if (unclusteredIds.has(edge.targetId) && srcNode.clusterId) {
          if (!linkTargetCluster.has(edge.targetId)) linkTargetCluster.set(edge.targetId, srcNode.clusterId);
        }
      });

      // Place unclustered nodes
      const unclusteredNodes = nodesData.filter(n => !n.clusterId);
      let orphanIdx = 0;
      unclusteredNodes.forEach((cardNode) => {
        const utc = cardNode.type === 'permanent' ? 0xa855f7 : cardNode.type === 'literature' ? 0xf472b6 : 0x22d3ee;
        const node = createGlowNode(utc, 2, cardNode.title);
        node.userData.id = cardNode.id;
        node.userData.trueColor = utc;
        node.userData.clusterColor = utc;

        // Check if this node should be placed near a cluster via wiki-link
        const targetClusterId = linkTargetCluster.get(cardNode.id);
        const targetClusterSun = targetClusterId
          ? clusterSuns.get(clusterIdxByDbId.get(targetClusterId) ?? -1)
          : undefined;

        if (targetClusterSun) {
          // Place near the linked cluster's sun (within the cluster's radius)
          const seed = hashId(cardNode.id);
          const sunPos = targetClusterSun.position;
          const r = 65 + seededRandom(seed) * 115;
          const a = seededRandom(seed + 1) * Math.PI * 2;
          const p = Math.acos(seededRandom(seed + 2) * 2 - 1);
          node.position.set(
            sunPos.x + r * Math.sin(p) * Math.cos(a),
            sunPos.y + r * Math.sin(p) * Math.sin(a) * 0.7,
            sunPos.z + r * Math.cos(p),
          );
          // Assign cluster coloring so focus/highlight works
          const targetIdx = clusterIdxByDbId.get(targetClusterId!) ?? -1;
          node.userData.clusterId = targetIdx;
          node.userData.clusterColor = CLUSTER_COLORS[targetIdx % CLUSTER_COLORS.length];
        } else {
          // Truly orphan — form a compact virtual cluster in the spiral pattern
          const seed = hashId(cardNode.id);
          const orphanClusterIdx = clustersData.length;
          const totalClusters = clustersData.length + 1;
          const oPhi = Math.acos(1 - (2 * (orphanClusterIdx + 0.5)) / Math.max(totalClusters, 1));
          const oTheta = Math.PI * (1 + Math.sqrt(5)) * orphanClusterIdx;
          const oDist = GALAXY_LAYOUT.clusterMinDistance + seededRandom(seed) * GALAXY_LAYOUT.clusterDistanceJitter;
          const ocx = oDist * Math.sin(oPhi) * Math.cos(oTheta);
          const ocy = oDist * Math.cos(oPhi) * 1.2;
          const ocz = oDist * Math.sin(oPhi) * Math.sin(oTheta);
          const or = 30 + seededRandom(seed + 1) * 20;
          const oa = seededRandom(seed + 2) * Math.PI * 2;
          const op = Math.acos(seededRandom(seed + 3) * 2 - 1);
          node.position.set(
            ocx + or * Math.sin(op) * Math.cos(oa),
            ocy + or * Math.sin(op) * Math.sin(oa) * 0.7,
            ocz + or * Math.cos(op),
          );
          node.userData.clusterId = orphanClusterIdx;
          node.userData.clusterColor = 0x666666; // neutral gray
          orphanIdx++;
        }

        nodesGroup.add(node);
      });

      // Create edges from real data (concept-to-concept connections)
      // Real wiki-link edges are always visible regardless of cluster.
      edgesData.forEach(edge => {
        const sourceNode = allNodes.find(n => n.userData.id === edge.sourceId);
        const targetNode = allNodes.find(n => n.userData.id === edge.targetId);
        if (sourceNode && targetNode) {
          const edgeColor = sourceNode.userData.trueColor || sourceNode.userData.clusterColor || 0xffffff;
          createCurve(sourceNode, targetNode, edgeColor, 0.5, false, edgeColor, true);
        }
      });
    }

    function resetCameraView(): void {
      const resetBtn = document.getElementById('reset-view-btn');
      if (resetBtn) resetBtn.classList.remove('visible');
      if (autoRotateBeforeFocus !== null) {
        controls.autoRotate = autoRotateBeforeFocus;
        autoRotateBeforeFocus = null;
      }
      lockedNode = null;
      hoveredNode = null;
      lastFocusSelection = [];
      clearNodeLabels();
      gsap.to(controls.target, { x: 0, y: 0, z: 0, duration: 1.2 });
      gsap.to(camera.position, {
        x: 780,
        y: 560,
        z: 780,
        duration: 1.5,
      });
      allNodes.forEach((n) => {
        gsap.to(n.scale, { x: 1, y: 1, z: 1, duration: 0.5 });
        if (n.userData.trueColor) setNodeColor(n, n.userData.trueColor);
        // Reapply type visibility filter
        const t = n.userData.type as string;
        if (t && typeVisible[t] !== undefined) n.visible = typeVisible[t];
      });
      reapplyFilters();
      allLinks.forEach((l) => {
        if (l.userData._filtered) return;
        if (l.userData.isInternal) {
          l.visible = false;
        } else if (l.userData.semantic) {
          l.visible = false; // Hide WikiLink edges when resetting to overview
        } else {
          l.visible = true;
          (l.material as THREE.LineBasicMaterial).color.set(l.userData.clusterColor);
          gsap.to(l.material, {
            opacity: l.userData.baseOpacity,
            duration: 0.5,
          });
        }
      });
    }

    // Expose resetCameraView via window so imperative handle can call it
    register('resetCameraView', resetCameraView);

    register('toggleLearningPath', () => {
        learningPath.visible = !learningPath.visible;
        learningPath.group.visible = learningPath.visible;
      });
    register('isLearningPathVisible', () => learningPath.visible);
    register('rebuildLearningPath', () => {
        clearLearningPath();
        buildDemoLearningPath(dataRef.current.learningPathSteps);
        createLearningPath();
        learningPath.group.visible = learningPath.visible;
      });
    register('setAutoRotate', (on: boolean) => {
      controls.autoRotate = on;
      if (autoRotateBeforeFocus !== null) autoRotateBeforeFocus = on;
    });
    register('getAutoRotate', () => controls.autoRotate);
    register('setRotateSpeed', (s: number) => { controls.autoRotateSpeed = s; });
    register('getRotateSpeed', () => controls.autoRotateSpeed);
    register('setBloom', (v: number) => { if (bloomPass) bloomPass.strength = v; });
    register('getBloom', () => bloomPass?.strength ?? 1.4);
    register('setMilkyWay', (v: boolean) => { if (milkyWay) milkyWay.visible = v; });
    register('getMilkyWay', () => milkyWay?.visible ?? true);
    register('setCometSpeed', (v: number) => { cometSpeedMultiplier = Math.max(0, Math.min(3, v)); });
    register('getCometSpeed', () => cometSpeedMultiplier);
    register('setCometsVisible', (v: boolean) => { scene.children.forEach(c => { if (c.userData && c.userData.isComet) c.visible = v; }); });
    register('getCometsVisible', () => { const c = scene.children.find(c => c.userData && c.userData.isComet); return c ? c.visible !== false : true; });
    register('fitSelection', () => {
      const selection = lastFocusSelection.filter(n => n.visible !== false);
      if (selection.length > 0) frameSelection(selection, selection[0], 0.9);
    });
    const reapplyFilters = () => {
        allNodes.forEach(n => {
          const t = n.userData.type as string;
          if (t && typeVisible[t] !== undefined) n.visible = typeVisible[t];
        });
        refreshLinksAndLabels();
      };
    const refreshLinksAndLabels = () => {
      // Memory-based: save original visibility before hiding, restore when unhiding
      allLinks.forEach(l => {
        const s = l.userData.source as THREE.Group;
        const t = l.userData.target as THREE.Group;
        if (!s.visible || !t.visible) {
          // Link should be hidden by filter — save its current state first
          if (!l.userData._filtered) {
            l.userData._filtered = true;
            l.userData._wasVisible = l.visible;
          }
          l.visible = false;
        } else if (l.userData._filtered) {
          // Both endpoints visible again — restore previous visibility
          if (l.userData._wasVisible !== undefined) l.visible = l.userData._wasVisible;
          l.userData._filtered = false;
        }
      });
    };
    register('setNodeTypeVisible', (type: string, visible: boolean) => {
        typeVisible[type] = visible;
        allNodes.forEach(n => {
          if (n.userData.type === type) n.visible = visible;
        });
        refreshLinksAndLabels();
        clearNodeLabels();
      });
    register('getTypeVisible', (type: string) => {
        const node = allNodes.find(n => n.userData.type === type);
        return node ? node.visible !== false : true;
      });
    register('setExternalEdgesVisible', (v: boolean) => {
        allLinks.forEach(l => {
          if (l.userData.isExternal && !l.userData._filtered) {
            l.visible = v;
          }
        });
      });
    register('setInternalEdgesVisible', (v: boolean) => {
        allLinks.forEach(l => {
          if (l.userData.isInternal && !l.userData._filtered) {
            // Only toggle edges that are internal by default (same-cluster)
            l.visible = v && (!l.userData._wasVisible === false || true);
          }
        });
      });
    register('setAllNodesVisible', (v: boolean) => {
        allNodes.forEach(n => { n.visible = v; });
        refreshLinksAndLabels();
        clearNodeLabels();
      });

    // ── FOCUS mode functions ──
    register('focusOverview', () => {
      allNodes.forEach(n => { n.visible = true; n.scale.set(1, 1, 1); });
      allLinks.forEach(l => {
        if (!l.userData._filtered) {
          if (l.userData.isInternal) l.visible = false;
          else l.visible = true;
        }
      });
      clearNodeLabels();
    });
    register('focusByCluster', () => {
      if (currentClusterId === null) return;
      allNodes.forEach(n => {
        if (n.userData.clusterId === currentClusterId || n.userData.isSun) {
          n.visible = true;
          gsap.to(n.scale, { x: 1, y: 1, z: 1, duration: 0.5 });
        } else {
          gsap.to(n.scale, { x: 0.15, y: 0.15, z: 0.15, duration: 0.5 });
        }
      });
      refreshLinksAndLabels();
      clearNodeLabels();
    });
    register('focusZenMode', () => {
      if (currentClusterId === null) return;
      allNodes.forEach(n => {
        n.visible = n.userData.clusterId === currentClusterId || n.userData.isSun;
      });
      allLinks.forEach(l => {
        const s = l.userData.source as THREE.Group;
        const t = l.userData.target as THREE.Group;
        l.visible = s.visible && t.visible && !l.userData._filtered;
      });
      clearNodeLabels();
    });
    register('showOrphansOnly', () => {
      allNodes.forEach(n => {
        if (n.userData.isSun) { n.visible = true; return; }
        const neighbors = adjMap.get(n);
        n.visible = !neighbors || neighbors.size === 0;
      });
      refreshLinksAndLabels();
    });
    register('showAllNodes', () => {
      allNodes.forEach(n => { n.visible = true; });
      refreshLinksAndLabels();
    });
    register('focusRecent', () => {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      allNodes.forEach(n => {
        if (n.userData.createdAt) {
          n.visible = new Date(n.userData.createdAt).getTime() > weekAgo;
        }
      });
      refreshLinksAndLabels();
      clearNodeLabels();
    });
    // Focus camera on a specific node by its database ID — used by search results.
    register('focusNodeById', (nodeId: string) => {
      const target = allNodes.find(n => n.userData.id === nodeId);
      if (target) focusNode(target);
    });
    // Find a node by its title — returns the node's database ID or null.
    register('findNodeByTitle', (title: string) => {
      const target = allNodes.find(n => n.userData.name === title);
      return target?.userData?.id || null;
    });

    // --- Init Three.js ---

    scene = new THREE.Scene();
    createNebula(scene);
    camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      10000
    );
    camera.position.set(780, 560, 780);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    bloomPass.strength = 1.4;
    bloomPass.radius = 0.6;
    composer.addPass(bloomPass);

    scene.fog = new THREE.FogExp2(0x020208, 0.00015);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 120;
    controls.maxDistance = 1800;
    controls.zoomSpeed = 0.85;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.2;
    applyNodeModeVisual(useAppStore.getState().mode, true);
    const unsubscribeModeVisual = useAppStore.subscribe((state, prevState) => {
      if (state.mode !== prevState.mode) applyNodeModeVisual(state.mode);
    });

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
      // Pre-roll per-tail-vertex random offsets ONCE at creation. Calling
      // Math.random() inside the animation loop every frame produced visible
      // jitter (each frame re-sampled R and Y offsets). Stash them on
      // userData so the loop reads stable values.
      const rOffsets = new Float32Array(tailLen);
      const yOffsets = new Float32Array(tailLen);
      for (let i = 0; i < tailLen; i++) {
        rOffsets[i] = (Math.random() - 0.5) * 4;
        yOffsets[i] = (Math.random() - 0.5) * 3;
      }
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
        rOffsets,
        yOffsets,
      };
      scene.add(comet);
    }

    // --- Node & link groups ---
    nodesGroup = new THREE.Group();
    linksGroup = new THREE.Group();
    scene.add(nodesGroup);
    scene.add(linksGroup);
    // Labels are now HTML overlay, not Three.js sprites

    createCore('CENTRAL_INTELLIGENCE');

    // --- Deferred data-driven scene builder ---
    // Waits for real data to arrive via async API, then builds nodes/edges/clusters.
    // Never shows demo/fallback data.
    let sceneDataRendered = false;
    let lastVaultId: string | null = null;
    let lastNodeCount = 0;
    let lastEdgeCount = 0;
    let currentClusterId: number | null = null;
    const typeVisible: Record<string, boolean> = {};
    register('buildGalaxyScene', (
      n: GalaxyNode[],
      e: GalaxyEdge[],
      c: GalaxyCluster[],
      vid?: string | null
    ) => {
      if (sceneDataRendered && vid === lastVaultId && n.length === lastNodeCount && e.length === lastEdgeCount) return;
      if (n.length === 0 && c.length === 0) return;

      if (!sceneDataRendered) {
        // ── First build: instant (nothing to fade from) ──
        buildNodesAndLinks(n, e, c, vid);
        sceneDataRendered = true;
        lastVaultId = vid || null;
        lastNodeCount = n.length;
        lastEdgeCount = e.length;
        return;
      }

      // ── Subsequent builds: staged fade for imperceptible update ──
      // Phase 1: fade existing to transparent
      const fadeOutTargets: { obj: THREE.Object3D; mat: THREE.MeshBasicMaterial }[] = [];
      allNodes.forEach(node => {
        node.traverse(child => {
          const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (mat && typeof mat.opacity === 'number') fadeOutTargets.push({ obj: child, mat });
        });
      });
      allLinks.forEach(l => {
        const mat = l.material as THREE.MeshBasicMaterial | undefined;
        if (mat && typeof mat.opacity === 'number') fadeOutTargets.push({ obj: l, mat });
      });
      fadeOutTargets.forEach(t => gsap.to(t.mat, { opacity: 0, duration: 0.12, ease: 'power2.out' }));

      // Phase 2: rebuild (fires after fade starts — scene is transparent so no flash)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          buildNodesAndLinks(n, e, c, vid);
          sceneDataRendered = true;
          lastVaultId = vid || null;
          lastNodeCount = n.length;
          lastEdgeCount = e.length;

          // Phase 3: fade new nodes in
          allNodes.forEach(node => {
            node.traverse(child => {
              const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
              if (mat && typeof mat.opacity === 'number' && mat.opacity < 0.01) {
                gsap.to(mat, { opacity: mat.userData?.targetOpacity ?? 1, duration: 0.25, ease: 'power2.in', delay: 0.05 });
              }
            });
          });
          allLinks.forEach(l => {
            const mat = l.material as THREE.MeshBasicMaterial | undefined;
            if (mat && typeof mat.opacity === 'number' && mat.opacity < 0.01) {
              gsap.to(mat, { opacity: l.userData.baseOpacity ?? 0.12, duration: 0.25, ease: 'power2.in', delay: 0.08 });
            }
          });
        });
      });
    });

    /** Internal: clear + rebuild geometry (used by buildGalaxyScene) */
    function buildNodesAndLinks(
      n: GalaxyNode[],
      e: GalaxyEdge[],
      c: GalaxyCluster[],
      vid?: string | null
    ): void {
      while (nodesGroup.children.length > 0) {
        const child = nodesGroup.children[0];
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
        nodesGroup.remove(child);
      }
      while (linksGroup.children.length > 0) {
        const child = linksGroup.children[0];
        if ((child as THREE.Line).geometry) (child as THREE.Line).geometry.dispose();
        linksGroup.remove(child);
      }
      allNodes.length = 0;
      allLinks.length = 0;
      Object.keys(typeVisible).forEach(k => delete typeVisible[k]);
      adjMap.clear();
      clusterNodes.clear();
      clusterSuns.clear();
      clusterLabelData.length = 0;
      nodeLabelItems.length = 0;
      clearNodeLabels();

      const storeVaults = useAppStore.getState().vaults;
      const vaultName = storeVaults.find(v => v.id === vid)?.name || vid || `CENTRAL_INTELLIGENCE`;
      createCore(vaultName);
      createClustersFromData(c, n, e);
      clearLearningPath();
      buildDemoLearningPath(dataRef.current.learningPathSteps);
      createLearningPath();
      applyNodeModeVisual(useAppStore.getState().mode, true);
    }

    // If data already available at mount time (fast fetch), render immediately
    const { nodes: dn, edges: de, clusters: dc } = dataRef.current;
    if (dc.length > 0 || dn.length > 0) {
      // Look up vaultId from store for proper core naming
      const initVid = useAppStore.getState().currentVaultId;
      const buildFn = useGalaxyActions.getState().actions.buildGalaxyScene
      if (buildFn) buildFn(dn, de, dc, initVid);
    }

    // --- Event listeners ---

    // Right-click context menu suppression
    // Right-click context menu on nodes
    let contextNode: THREE.Group | null = null;
    let contextMenuEl: HTMLDivElement | null = null;

    function showContextMenu(node: THREE.Group, x: number, y: number): void {
      contextNode = node;
      // Remove any existing menu
      if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }

      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed',
        `left:${x}px`,
        `top:${y}px`,
        'z-index:100',
        'background:rgba(10,10,15,0.95)',
        'backdrop-filter:blur(16px)',
        'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:10px',
        'padding:4px',
        'min-width:160px',
        'box-shadow:0 12px 40px rgba(0,0,0,0.6)',
        'font-family:JetBrains Mono, monospace',
        'font-size:11px',
      ].join(';');

      const name = (node.userData.name as string) || 'untitled';
      const nodeId = (node.userData.id as string) || '';
      const nodeType = (node.userData.type as string) || 'fleeting';

      const items: { label: string; action: () => void; danger?: boolean }[] = [
        {
          label: '✏️ 在 Forge 中打开',
          action: () => {
            useAppStore.getState().setSelectedNode({ id: nodeId, title: name, type: nodeType });
            useAppStore.getState().setMode('forge');
          },
        },
        {
          label: '📋 复制标题',
          action: () => navigator.clipboard.writeText(name).catch(() => {}),
        },
        {
          label: '🔗 复制 [[链接]]',
          action: () => navigator.clipboard.writeText(`[[${name}]]`).catch(() => {}),
        },
        {
          label: '🗑 删除卡片',
          action: async () => {
            if (!window.confirm(`确定删除「${name}」？\n此操作不可撤销。`)) return;
            try {
              await (await fetch(`/api/vault/card/${nodeId}`, { method: 'DELETE' })).json();
              window.location.reload();
            } catch { /* ignore */ }
          },
          danger: true,
        },
      ];

      el.innerHTML = [
        `<div style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);font-size:10px;text-transform:uppercase;letter-spacing:0.05em">${name}</div>`,
        ...items.map((item, i) =>
          `<div data-idx="${i}" style="padding:7px 10px;border-radius:6px;cursor:pointer;transition:background 0.12s;color:${item.danger ? 'rgba(244,67,54,0.7)' : 'rgba(255,255,255,0.7)'};display:flex;align-items:center;gap:6px">${item.label}</div>`
        ),
      ].join('');

      // Hover + click
      el.querySelectorAll('[data-idx]').forEach((btn) => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        btn.addEventListener('mouseenter', () => (btn as HTMLElement).style.background = 'rgba(255,255,255,0.06)');
        btn.addEventListener('mouseleave', () => (btn as HTMLElement).style.background = 'transparent');
        btn.addEventListener('click', () => { items[idx]?.action(); el.remove(); contextMenuEl = null; });
      });

      // Dismiss
      const dismiss = (de: MouseEvent) => {
        if (!el.contains(de.target as Node)) { el.remove(); contextMenuEl = null; document.removeEventListener('mousedown', dismiss); }
      };
      setTimeout(() => document.addEventListener('mousedown', dismiss), 0);

      document.body.appendChild(el);
      contextMenuEl = el;
    }

    // Override context menu: show node menu instead of browser menu
    const onContextMenu = (e: Event) => {
      e.preventDefault();
      const me = e as MouseEvent;
      // Raycast to find node under cursor
      mouse.x = (me.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(me.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodesGroup.children, true);
      for (const hit of hits) {
        let obj = hit.object as THREE.Object3D;
        while (obj.parent && obj.parent !== nodesGroup && obj.parent !== scene) obj = obj.parent;
        if (obj.userData && obj.userData.name && !obj.userData.isSun) {
          showContextMenu(obj as THREE.Group, me.clientX, me.clientY);
          return;
        }
      }
    };
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // Hover previews relationships; click locks the same neighborhood.
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;
    function setMouseFromEvent(e: MouseEvent): void {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }
    function findNodeAt(e: MouseEvent): THREE.Group | null {
      setMouseFromEvent(e);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(nodesGroup.children, true);
      for (const hit of hits) {
        let obj = hit.object as THREE.Object3D;
        while (obj.parent && obj.parent !== nodesGroup && obj.parent !== scene) obj = obj.parent;
        if (obj.userData && obj.userData.name) return obj as THREE.Group;
      }
      return null;
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      pointerDown = { x: e.clientX, y: e.clientY };

      // Dismiss any existing edge info panel first
      const existing = document.getElementById('galaxy-edge-panel');
      if (existing) existing.remove();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (pointerDown || lockedNode) return;
      const now = performance.now();
      if (now - lastHoverRaycastAt < 90) return;
      lastHoverRaycastAt = now;
      const node = findNodeAt(e);
      renderer.domElement.style.cursor = node ? 'pointer' : '';
      if (node === hoveredNode) return;
      hoveredNode = node;
      applyGraphAttention(node, false);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || !pointerDown) return;
      const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
      pointerDown = null;
      if (moved > 5) return;

      const node = findNodeAt(e);
      if (node) {
        focusNode(node);
        return;
      }

    };
    const onMouseLeave = () => {
      if (lockedNode) return;
      hoveredNode = null;
      renderer.domElement.style.cursor = '';
      applyGraphAttention(null);
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('mouseleave', onMouseLeave);

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
      const time = performance.now() * 0.001;
      controls.update();
      composer.render();
      renderLabels();

      // Dynamic Nebula Rotation
      if (nebulaGroup) {
        nebulaGroup.children.forEach(c => {
          c.rotation.z += (c.userData.rotationSpeed || 0.0002);
        });
      }

      // Energy Flows animation
      flows.forEach(f => {
        if (!f.mesh.visible) return;
        f.offset += f.speed;
        const pos = f.mesh.geometry.attributes.position.array as Float32Array;
        const pCount = pos.length / 3;
        for (let i = 0; i < pCount; i++) {
          const t = (f.offset + i / pCount) % 1;
          const idx = Math.floor(t * (f.points.length - 1));
          const p = f.points[idx];
          pos[i * 3] = p.x;
          pos[i * 3 + 1] = p.y;
          pos[i * 3 + 2] = p.z;
        }
        f.mesh.geometry.attributes.position.needsUpdate = true;
      });

      // Gentle breathing & Ring Rotation
      allNodes.forEach(n => {
        if (!n.visible) return;
        if (n.userData.ring) {
          n.userData.ring.rotation.z += 0.01;
          n.userData.ring.material.opacity = 0.2 + Math.sin(time * 3) * 0.1;
        }
      });

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
            // Use stable per-vertex offsets sampled at comet-creation time
            // instead of resampling Math.random() each frame (which produced
            // jitter in the tail).
            const rr = d.orbitR + (d.rOffsets ? d.rOffsets[i] : 0);
            let x = Math.cos(a) * rr;
            let y = d.yOffsets ? d.yOffsets[i] : 0;
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
        learningPath.flowOffset += 0.002;
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
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseup', onMouseUp);
      renderer.domElement.removeEventListener('mouseleave', onMouseLeave);
      unsubscribeModeVisual();

      // Kill any active gsap tweens
      gsap.killTweensOf(controls.target);
      gsap.killTweensOf(camera.position);

      // Clean up registered galaxy actions
      unregister('resetCameraView');
      unregister('toggleLearningPath');
      unregister('isLearningPathVisible');
      unregister('buildGalaxyScene');
      unregister('fitSelection');

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

      // Clean up HTML label overlay
      if (labelOverlay.parentNode) {
        labelOverlay.parentNode.removeChild(labelOverlay);
      }

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
      clusterLabelData.length = 0;
      nodeLabelItems.length = 0;
      clearNodeLabels();
    };
  }, []);

  // --- Phase 1: Initial build when vault is first set + data arrives ---
  const didBuild = useRef(false);
  useEffect(() => {
    if (didBuild.current) return;
    if (!vaultId || nodes.length === 0) return;
    didBuild.current = true;
    const buildFn = useGalaxyActions.getState().actions.buildGalaxyScene;
    if (typeof buildFn === 'function') {
      buildFn(nodes, edges, clusters, vaultId);
    }
  }, [vaultId, nodes.length > 0]);

  // --- Phase 2: Rebuild when vaultId or data changes (deterministic positions
  // make full rebuilds visually seamless — same card always lands in the same spot).
  useEffect(() => {
    if (!didBuild.current || !vaultId || nodes.length === 0) return;
    const buildFn = useGalaxyActions.getState().actions.buildGalaxyScene;
    if (typeof buildFn === 'function') {
      buildFn(nodes, edges, clusters, vaultId);
    }
  }, [vaultId, nodes, edges, clusters]);

  // --- Phase 3: Rebuild learning path when learning path steps data changes ---
  useEffect(() => {
    if (!didBuild.current) return;
    const rebuildFn = useGalaxyActions.getState().actions.rebuildLearningPath;
    if (typeof rebuildFn === 'function') {
      rebuildFn();
    }
  }, [learningPathSteps]);

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
