'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import gsap from 'gsap';
import type { GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/types/galaxy';
import { client } from '@/lib/api-client';

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
import { useGalaxyActions, useAppStore, type GraphLayoutMode } from '@/stores/mode-store';

export interface GalaxyCanvasHandle {
  resetCameraView: () => void;
}

interface GalaxyCanvasProps {
  vaultId?: string | null
  nodes?: GalaxyNode[]
  edges?: GalaxyEdge[]
  clusters?: GalaxyCluster[]
  learningPathSteps?: { id: string; cardId?: string | null; index: number; name: string; status?: string; mastery?: number }[]
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
  const vaultIdRef = useRef(vaultId);
  vaultIdRef.current = vaultId;

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
    let layoutGuideGroup: THREE.Group;
    let galaxyBoundaryGroup: THREE.Group;
    let animationId: number = 0;

    const allNodes: THREE.Group[] = [];
    const allLinks: THREE.Line[] = [];
    const adjMap = new Map<THREE.Group, Set<THREE.Group>>();
    const clusterNodes = new Map<number, THREE.Group[]>();
    const clusterSuns = new Map<number, THREE.Group>();
    const GALAXY_LAYOUT = {
      clusterMinDistance: 420,
      clusterDistanceJitter: 100,
      clusterInnerRadius: 78,
      clusterMiddleRadius: 150,
      clusterOuterRadius: 228,
      clusterLayerGap: 24,
    };
    const GALAXY_FORCE = {
      maxNodes: 360,
      maxLinks: 920,
      alphaMin: 0.002,
      alphaDecay: 0.972,
      velocityDamping: 0.87,
      anchorStrength: 0.00125,
      anchorRelaxation: 0.008,
      centerStrength: 0.00036,
      linkStrength: 0.0062,
      internalLinkStrength: 0.003,
      repelStrength: 38,
      repelDistance: 175,
      collideStrength: 0.042,
      orbitDriftStrength: 0.018,
      maxStep: 10,
    };
    type GalaxyPerformanceTier = 'normal' | 'large' | 'dense';
    const PLANAR_GEOMETRY_MODES = new Set<GraphLayoutMode>(['flat', 'radial', 'concentric', 'task-flow', 'timeline']);
    const PAN_ONLY_LAYOUT_MODES = new Set<GraphLayoutMode>(['flat', 'task-flow', 'timeline']);
    const CENTER_SPIN_LAYOUT_MODES = new Set<GraphLayoutMode>(['radial', 'concentric']);
    const STRUCTURED_LAYOUT_MODES = new Set<GraphLayoutMode>(['layered', 'matrix', 'mastery', 'evidence']);
    const GALAXY_VISIBLE_SEMANTIC_EDGE_TYPES = new Set(['prerequisite', 'related', 'wikilink', 'derived', 'supports', 'contradicts', 'evidence', 'citation']);
    const DEFAULT_GRAPH_LAYOUT_MODE: GraphLayoutMode = 'concentric';
    const DEFAULT_CAMERA_POSITION = new THREE.Vector3(-344.9, 964.2, -231.5);
    const DEFAULT_CONTROLS_TARGET = new THREE.Vector3(-344.9, -4.4, -20.3);

    let frames = 0;
    let lastTime = performance.now();
    let autoRotateBeforeFocus: boolean | null = null;
    let lastFocusSelection: THREE.Group[] = [];
    let hoveredNode: THREE.Group | null = null;
    let pressedNode: THREE.Group | null = null;
    let lockedNode: THREE.Group | null = null;
    let concentricCenterNode: THREE.Group | null = null;
    let layoutAnimating = false;
    let layoutTween: ReturnType<typeof gsap.to> | null = null;
    let centerSpinEnabled = true;
    let centerSpinActive = false;
    let autoRotateBeforeLayout: boolean | null = null;
    let flatInteractionSnapshot: {
      autoRotate: boolean;
      enableRotate: boolean;
      enablePan: boolean;
      screenSpacePanning: boolean;
      minDistance: number;
      maxDistance: number;
      mouseButtons: OrbitControls['mouseButtons'];
      touches: OrbitControls['touches'];
    } | null = null;
    let hoverAttentionEnabled = true;
    let lastHoverRaycastAt = 0;
    let layoutMode: GraphLayoutMode = DEFAULT_GRAPH_LAYOUT_MODE;
    let semanticClusterLensEnabled = false;
    let galaxyForceEnabled = true;
    let galaxyForceAlpha = 0;
    let galaxyForceFrameBudget = 0;
    let galaxyForceTick = 0;
    let galaxyPerformanceTier: GalaxyPerformanceTier = 'normal';
    let currentRendererPixelRatio = 0;
    let galaxyForceCache: {
      nodes: THREE.Group[];
      nodeSet: Set<THREE.Group>;
      links: THREE.Line[];
    } | null = null;
    let galaxyForceAnchors = new Map<THREE.Group, THREE.Vector3>();
    type DragSpring = { other: THREE.Group; restDistance: number; strength: number };
    type DragFollower = {
      node: THREE.Group;
      strength: number;
      velocity: THREE.Vector3;
      restPosition: THREE.Vector3;
      springs: DragSpring[];
    };
    let activeNodeDrag: {
      node: THREE.Group;
      selection: THREE.Group[];
      followers: DragFollower[];
      links: THREE.Line[];
      plane: THREE.Plane;
      offset: THREE.Vector3;
      anchorPosition: THREE.Vector3;
      targetAnchor: THREE.Vector3;
      velocity: THREE.Vector3;
      controlsEnabledBeforeDrag: boolean;
      moved: boolean;
    } | null = null;
    let dragSettle: { followers: DragFollower[]; links: THREE.Line[]; frames: number } | null = null;
    const dimNodeModes = new Set(['forge', 'cognition', 'learn']);
    const glowTextureCache = new Map<string, THREE.CanvasTexture>();
    const hoverPreviewNodes = new Set<THREE.Group>();
    const hoverPreviewLinks = new Set<THREE.Line>();
    const nodeRaycastTargets: THREE.Object3D[] = [];

    const { register, unregister } = useGalaxyActions.getState()
    layoutMode = DEFAULT_GRAPH_LAYOUT_MODE;
    useAppStore.getState().setGraphLayoutMode(DEFAULT_GRAPH_LAYOUT_MODE);
    hoverAttentionEnabled = useAppStore.getState().graphHoverAttention;
    semanticClusterLensEnabled = useAppStore.getState().graphSemanticClusterLens;
    galaxyForceEnabled = useAppStore.getState().graphForceMotion;

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
      steps: [] as { node: THREE.Group; stepIndex: number; status?: string; mastery?: number }[],
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
    const clusterLabelData: { name: string; color: number; position: THREE.Vector3; node?: THREE.Group }[] = [];

    function addClusterLabel(name: string, color: number, pos: THREE.Vector3, node?: THREE.Group) {
      clusterLabelData.push({ name, color, position: pos.clone(), node });
    }

    // Node labels (temporary, cleared on click)
    let nodeLabelItems: { text: string; position: THREE.Vector3; node?: THREE.Group; isFocused: boolean }[] = [];

    function setNodeLabelsFromNode(focusedNode: THREE.Group): void {
      nodeLabelItems = [];
      const shown = new Set<THREE.Group>();
      // Focused node — skip if sun (cluster name already shown persistently)
      const isSun = focusedNode.userData.isSun === true;
      if (!isSun) {
        const fName: string = focusedNode.userData.name || '';
        if (fName) {
          nodeLabelItems.push({ text: fName, position: focusedNode.position.clone(), node: focusedNode, isFocused: true });
          shown.add(focusedNode);
        }
      }
      const neighbors = Array.from(getInteractionNeighbors(focusedNode)).slice(0, focusedNode.userData.isSun ? 36 : 28);
      neighbors.forEach((n) => {
        if (!shown.has(n) && !n.userData.isSun) {
          shown.add(n);
          const nName: string = n.userData.name || '';
          if (nName) nodeLabelItems.push({ text: nName, position: n.position.clone(), node: n, isFocused: false });
        }
      });
      // If focused node is a cluster sun, also show all subnode labels
      if (isSun) {
        const cid = focusedNode.userData.clusterId;
        const subNodes = clusterNodes.get(cid) || [];
        subNodes.slice(0, 36).forEach((n) => {
          if (!shown.has(n)) {
            shown.add(n);
            const nName: string = n.userData.name || '';
            if (nName) nodeLabelItems.push({ text: nName, position: n.position.clone(), node: n, isFocused: false });
          }
        });
      }
    }

    function setPreviewNodeLabelsFromNode(focusedNode: THREE.Group, neighborLimit = 10): void {
      nodeLabelItems = [];
      const shown = new Set<THREE.Group>();
      const isSun = focusedNode.userData.isSun === true;

      if (!isSun) {
        const focusedName: string = focusedNode.userData.name || '';
        if (focusedName) {
          nodeLabelItems.push({ text: focusedName, position: focusedNode.position.clone(), node: focusedNode, isFocused: true });
          shown.add(focusedNode);
        }
      }

      const previewNodes = isSun
        ? (clusterNodes.get(focusedNode.userData.clusterId) || [])
        : Array.from(getInteractionNeighbors(focusedNode));
      for (const n of previewNodes.slice(0, neighborLimit)) {
        if (shown.has(n) || n.userData.isSun) continue;
        shown.add(n);
        const nodeName: string = n.userData.name || '';
        if (nodeName) nodeLabelItems.push({ text: nodeName, position: n.position.clone(), node: n, isFocused: false });
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
        const labelPosition = cl.node ? cl.node.getWorldPosition(new THREE.Vector3()) : cl.position;
        const v = labelPosition.clone().project(camera);
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
        const labelPosition = nl.node ? nl.node.getWorldPosition(new THREE.Vector3()) : nl.position;
        const v = labelPosition.clone().project(camera);
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
      const cacheKey = `${type}:${color.toString(16).padStart(6, '0')}`;
      const cached = glowTextureCache.get(cacheKey);
      if (cached) return cached;

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

      const texture = new THREE.CanvasTexture(canvas);
      glowTextureCache.set(cacheKey, texture);
      return texture;
    }

    function createGlowNode(
      color: number,
      size: number,
      name: string
    ): THREE.Group {
      const group = new THREE.Group();
      const entityRadius = size * 0.56;
      const glowBasis = THREE.MathUtils.clamp(size, 2.6, 4.8);
      const innerGlowScale = glowBasis * 5.8 + Math.min(4, size * 0.5);
      const haloScale = glowBasis * 9.4 + Math.min(8, size);

      // 1. Central Energy Core
      const coreGeo = new THREE.SphereGeometry(entityRadius, 18, 18);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.userData.raycastNode = group;
      group.add(core);

      // 2. Inner Glow (Main Color)
      const innerGlowMat = new THREE.SpriteMaterial({
        map: createGlowTexture(color, 'core'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const innerGlow = new THREE.Sprite(innerGlowMat);
      innerGlow.scale.set(innerGlowScale, innerGlowScale, 1);
      innerGlow.userData.glowRole = 'core';
      innerGlow.userData.raycastNode = group;
      group.add(innerGlow);
      nodeRaycastTargets.push(core, innerGlow);

      // 3. Outer Atmosphere / Halo
      const haloMat = new THREE.SpriteMaterial({
        map: createGlowTexture(color, 'halo'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.4
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(haloScale, haloScale, 1);
      halo.userData.glowRole = 'halo';
      group.add(halo);

      // 4. Data Rings (only for true anchors; too many rings read as spikes)
      if (size >= 4.9 || name.includes('CLUSTER')) {
        const ringGeo = new THREE.RingGeometry(entityRadius * 2.25, entityRadius * 2.38, 64);
        const ringMat = new THREE.MeshBasicMaterial({
          color: color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        const ringSeed = hashId(name || String(color));
        ring.rotation.y = (seededRandom(ringSeed) - 0.5) * 0.16;
        ring.rotation.z = seededRandom(ringSeed + 1) * Math.PI * 2;
        ring.userData.localNodeRing = true;
        group.add(ring);
        group.userData.ring = ring;
      }

      group.userData = { ...group.userData, name, color, renderColor: color, baseSize: size, baseScale: 1 };
      allNodes.push(group);
      return group;
    }

    // --- Flowing Link Logic ---
    const flows: { points: THREE.Vector3[], mesh: THREE.Points, speed: number, offset: number }[] = [];

    function buildLinkPoints(sourceNode: THREE.Group, targetNode: THREE.Group, semantic?: boolean): THREE.Vector3[] {
      const start = sourceNode.position;
      const end = targetNode.position;
      const dist = start.distanceTo(end);
      const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
      const curveSeed = hashId(String(sourceNode.userData.id || '') + String(targetNode.userData.id || ''));
      const direction = new THREE.Vector3().subVectors(end, start).normalize();
      const planar = PLANAR_GEOMETRY_MODES.has(layoutMode);
      const centerOut = planar
        ? new THREE.Vector3(0, 1, 0)
        : (mid.lengthSq() > 1 ? mid.clone().normalize() : new THREE.Vector3(0, 1, 0));
      const side = new THREE.Vector3().crossVectors(direction, centerOut);
      if (side.lengthSq() < 0.01) side.crossVectors(direction, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      side.normalize().multiplyScalar(seededRandom(curveSeed) > 0.5 ? 1 : -1);
      const arcStrength = planar ? 0.08 : semantic ? 0.28 : 0.36;
      const offsetMag = Math.min(planar ? 42 : 180, Math.max(18, dist * arcStrength));
      mid
        .add(side.multiplyScalar(offsetMag))
        .add(centerOut.multiplyScalar(Math.min(planar ? 22 : 90, dist * (planar ? 0.035 : 0.16))));
      return new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(56);
    }

    function refreshLinkGeometry(): void {
      refreshLinkGeometryForLinks(allLinks);
    }

    function refreshLinkGeometryForLinks(links: THREE.Line[]): void {
      links.forEach((line) => {
        const source = line.userData.source as THREE.Group | undefined;
        const target = line.userData.target as THREE.Group | undefined;
        if (!source || !target) return;
        const points = buildLinkPoints(source, target, !!line.userData.semantic);
        const position = line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (position && position.count === points.length) {
          const array = position.array as Float32Array;
          for (let i = 0; i < points.length; i++) {
            const point = points[i];
            array[i * 3] = point.x;
            array[i * 3 + 1] = point.y;
            array[i * 3 + 2] = point.z;
          }
          position.needsUpdate = true;
        } else {
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry().setFromPoints(points);
        }
        if (line.userData.flowRef) line.userData.flowRef.points = points;
      });
    }

    function getLinksConnectedToNodes(nodes: Iterable<THREE.Group>, includeHidden = false): THREE.Line[] {
      const touched = new Set(nodes);
      if (touched.size === 0) return [];
      return allLinks.filter((line) => {
        const source = line.userData.source as THREE.Group | undefined;
        const target = line.userData.target as THREE.Group | undefined;
        if (!source || !target) return false;
        if (!touched.has(source) && !touched.has(target)) return false;
        if (includeHidden) return true;
        return line.visible === true
          || line.userData.targetVisible === true
          || line.userData.flowMesh?.visible === true;
      });
    }

    function refreshLinkGeometryForNodes(nodes: Iterable<THREE.Group>, includeHidden = false): void {
      refreshLinkGeometryForLinks(getLinksConnectedToNodes(nodes, includeHidden));
    }

    function getEdgeTypeColor(edgeType?: string, fallback = 0xffffff): number {
      if (edgeType === 'counter') return 0xff5c7a;
      if (edgeType === 'prerequisite') return 0xfbbf24;
      if (edgeType === 'derived') return 0x34d399;
      if (edgeType === 'wikilink') return 0x8bd3ff;
      if (edgeType === 'evidence' || edgeType === 'citation') return 0xf472b6;
      return fallback;
    }

    function createCurve(
      sourceNode: THREE.Group,
      targetNode: THREE.Group,
      color: number,
      opacity: number,
      isInternal?: boolean,
      trueColor?: number,
      semantic?: boolean,
      edgeType?: string,
      edgeWeight = 1
    ): void {
      const dist = sourceNode.position.distanceTo(targetNode.position);
      const resolvedColor = semantic ? getEdgeTypeColor(edgeType, trueColor || color) : color;
      const points = buildLinkPoints(sourceNode, targetNode, semantic);
      const geo = new THREE.BufferGeometry().setFromPoints(points);

      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: resolvedColor,
          transparent: true,
          opacity: opacity * (semantic ? 0.44 : 0.5),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      line.frustumCulled = false;

      line.userData = {
        source: sourceNode,
        target: targetNode,
        baseOpacity: opacity,
        isInternal: !!isInternal,
        isExternal: semantic && sourceNode.userData.clusterId !== targetNode.userData.clusterId,
        semantic: !!semantic,
        edgeType,
        edgeWeight,
        forceRestDistance: dist,
        crossCluster: semantic && sourceNode.userData.clusterId !== targetNode.userData.clusterId,
        clusterColor: resolvedColor,
        trueColor: resolvedColor,
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
          color: resolvedColor,
          size: 1.5,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const flowMesh = new THREE.Points(pGeo, pMat);
        flowMesh.frustumCulled = false;
        flowMesh.visible = false; // Hidden until focused
        linksGroup.add(flowMesh);
        const flow = { points, mesh: flowMesh, speed: 0.005 + Math.random() * 0.01, offset: Math.random() };
        flows.push(flow);
        line.userData.flowMesh = flowMesh;
        line.userData.flowRef = flow;
      }
    }

    function setNodeColor(node: THREE.Group, color: number): void {
      if (node.userData.renderColor === color) return;
      node.userData.renderColor = color;

      node.children.forEach((child) => {
        if ((child as THREE.Mesh).isMesh) {
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
        }
        if ((child as THREE.Sprite).isSprite) {
          const material = (child as THREE.Sprite).material as THREE.SpriteMaterial;
          const glowRole = child.userData.glowRole === 'halo' ? 'halo' : 'core';
          const nextTexture = createGlowTexture(color, glowRole);
          if (material.map !== nextTexture) {
            material.map = nextTexture;
            material.needsUpdate = true;
          }
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
          gsap.killTweensOf(child.scale);
          gsap.to(child.scale, {
            x: baseScale.x * scaleFactor,
            y: baseScale.y * scaleFactor,
            z: baseScale.z * scaleFactor,
            duration,
            ease: 'power2.out',
            overwrite: true,
          });

          const material = (child as THREE.Mesh | THREE.Sprite).material as THREE.Material | THREE.Material[] | undefined;
          const materials = Array.isArray(material) ? material : material ? [material] : [];
          materials.forEach((mat) => {
            const maybeTransparent = mat as THREE.Material & { opacity?: number };
            if (typeof maybeTransparent.opacity !== 'number') return;
            if (mat.userData.nodeBaseOpacity === undefined) mat.userData.nodeBaseOpacity = maybeTransparent.opacity;
            mat.transparent = true;
            gsap.killTweensOf(maybeTransparent);
            gsap.to(maybeTransparent, {
              opacity: (mat.userData.nodeBaseOpacity as number) * opacityFactor,
              duration,
              ease: 'power2.out',
              overwrite: true,
            });
          });
        });
      });
    }

    function createCore(name: string): void {
      const core = createGlowNode(0xffffff, 9.5, name || 'CENTRAL_INTELLIGENCE');
      core.userData.isSyntheticRoot = true;
      core.userData.position3D = core.position.clone();
      nodesGroup.add(core);
    }

    function getFocusSelection(node: THREE.Group): THREE.Group[] {
      if (node.userData.isSun) {
        const cid = node.userData.clusterId;
        return [node, ...(clusterNodes.get(cid) || []).filter(n => n.visible !== false)];
      }

      const localNeighbors = Array.from(getInteractionNeighbors(node)).filter(n => n.visible !== false);
      return [node, ...localNeighbors];
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
      if (layoutMode === 'evidence') return getEvidenceNeighbors(node);
      return new Set(Array.from(adjMap.get(node) || []).filter(n => n.visible !== false));
    }

    function getEvidenceNeighbors(node: THREE.Group): Set<THREE.Group> {
      const neighbors = new Set<THREE.Group>();
      const nodeType = String(node.userData.type || '');
      allLinks.forEach((link) => {
        if (!link.userData.semantic) return;
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        if (!source || !target) return;
        const other = source === node ? target : target === node ? source : null;
        if (!other || other.visible === false || other.userData.isSun) return;
        const otherType = String(other.userData.type || '');
        if (nodeType === 'permanent') {
          if (otherType === 'literature' || otherType === 'fleeting' || otherType === 'permanent') neighbors.add(other);
          return;
        }
        if (nodeType === 'literature' || nodeType === 'fleeting') {
          if (otherType === 'permanent' || otherType === 'fleeting') neighbors.add(other);
          return;
        }
        neighbors.add(other);
      });
      return neighbors;
    }

    function setNodeScale(node: THREE.Group, scale: number, duration = 0.24): void {
      if (!node.visible) return;
      gsap.killTweensOf(node.scale);
      gsap.to(node.scale, { x: scale, y: scale, z: scale, duration, ease: 'power2.out', overwrite: true });
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
          gsap.killTweensOf(maybeTransparent);
          gsap.to(maybeTransparent, {
            opacity: (mat.userData.nodeBaseOpacity as number) * opacityFactor,
            duration,
            ease: 'power2.out',
            overwrite: true,
          });
        });
      });
    }

    function setNodePresence(node: THREE.Group, scale: number, opacity: number, duration = 0.24): void {
      setNodeScale(node, scale, duration);
      setNodeOpacity(node, opacity, duration);
    }

    function restoreNodeColor(node: THREE.Group): void {
      const color = node.userData.trueColor || node.userData.clusterColor || node.userData.color;
      if (color) setNodeColor(node, color);
    }

    function setGalaxyLocalRingsVisible(visible: boolean): void {
      allNodes.forEach((node) => {
        const ring = node.userData.ring as THREE.Mesh | undefined;
        if (ring?.userData.localNodeRing) ring.visible = visible;
      });
    }

    function getGalaxyOverviewLinkOpacity(line: THREE.Line): number {
      if (line.userData.isInternal) return 0;
      if (line.userData.semantic) {
        const type = String(line.userData.edgeType || '');
        if (!GALAXY_VISIBLE_SEMANTIC_EDGE_TYPES.has(type)) return 0.018;
        const weight = Math.max(0, Number(line.userData.edgeWeight) || 1);
        const weighted = 0.028 + Math.min(0.1, Math.log1p(weight) * 0.028);
        return line.userData.crossCluster ? weighted + 0.055 : weighted;
      }
      return Math.max(0.025, Math.min(0.075, Number(line.userData.baseOpacity) || 0.05));
    }

    function setLinkOpacity(line: THREE.Line, opacity: number, duration = 0.22): void {
      if (line.userData._filtered) return;
      const mat = line.material as THREE.LineBasicMaterial;
      const visibleTarget = opacity > 0.012;
      const version = (Number(line.userData.opacityVersion) || 0) + 1;
      line.userData.opacityVersion = version;
      line.userData.targetOpacity = opacity;
      line.userData.targetVisible = visibleTarget;
      gsap.killTweensOf(mat);
      if (visibleTarget) line.visible = true;
      gsap.to(mat, {
        opacity,
        duration,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
          if (line.userData.opacityVersion !== version) return;
          mat.opacity = opacity;
          line.visible = visibleTarget && !line.userData._filtered;
        },
      });
    }

    function setResetButtonVisible(visible: boolean): void {
      document.getElementById('reset-view-btn')?.classList.toggle('visible', visible);
    }

    function restoreNodeVisibilityFromFilters(): void {
      allNodes.forEach((n) => {
        const type = n.userData.type as string | undefined;
        n.visible = type && typeVisible[type] !== undefined ? typeVisible[type] : true;
      });
    }

    function setNodeFocusRole(node: THREE.Group, role: 'focus' | 'neighbor' | null): void {
      node.userData.focusRole = role;
      if (node.userData.ring) node.userData.ring.userData.focusRole = role;
    }

    function restoreAutoRotateAfterTransientAttention(): void {
      if (autoRotateBeforeFocus === null || lockedNode) return;
      if (layoutMode === 'galaxy') controls.autoRotate = autoRotateBeforeFocus;
      autoRotateBeforeFocus = null;
    }

    function restoreHoverPreviewLink(link: THREE.Line, duration = 0.12): void {
      if (link.userData._filtered) return;
      if (link.userData.flowMesh) link.userData.flowMesh.visible = false;
      const mat = link.material as THREE.LineBasicMaterial;
      mat.color.set(getEdgeTypeColor(link.userData.edgeType, link.userData.trueColor || link.userData.clusterColor || 0xffffff));
      const opacity = layoutMode === 'galaxy'
        ? getGalaxyOverviewLinkOpacity(link)
        : Number(link.userData.targetOpacity ?? link.userData.baseOpacity ?? 0.08);
      setLinkOpacity(link, opacity, duration);
    }

    function clearHoverPreview(duration = 0.12, clearLabels = true): void {
      if (hoverPreviewNodes.size > 0) {
        const nodesToRestore = Array.from(hoverPreviewNodes);
        hoverPreviewNodes.clear();
        nodesToRestore.forEach((node) => {
          setNodeFocusRole(node, null);
          if (!node.visible) return;
          setNodePresence(node, 1, 1, duration);
          restoreNodeColor(node);
        });
      }

      if (hoverPreviewLinks.size > 0) {
        const linksToRestore = Array.from(hoverPreviewLinks);
        hoverPreviewLinks.clear();
        linksToRestore.forEach((link) => restoreHoverPreviewLink(link, duration));
      }

      if (clearLabels) clearNodeLabels();
    }

    function applyHoverPreview(node: THREE.Group | null): void {
      if (lockedNode) return;
      clearHoverPreview(0.1, false);

      if (!node || node.visible === false) {
        clearNodeLabels();
        restoreAutoRotateAfterTransientAttention();
        return;
      }

      if (autoRotateBeforeFocus === null) autoRotateBeforeFocus = controls.autoRotate;
      if (layoutMode === 'galaxy') controls.autoRotate = false;

      const neighbors = Array.from(getInteractionNeighbors(node)).filter(n => n.visible !== false);
      const previewLimit = node.userData.isSun ? 36 : 18;
      const previewNeighbors = neighbors.slice(0, previewLimit);
      const previewNeighborSet = new Set(previewNeighbors);

      hoverPreviewNodes.add(node);
      setNodeFocusRole(node, 'focus');
      setNodePresence(node, 1.08, 1, 0.14);
      restoreNodeColor(node);

      previewNeighbors.forEach((neighbor) => {
        hoverPreviewNodes.add(neighbor);
        setNodeFocusRole(neighbor, 'neighbor');
        setNodePresence(neighbor, 1.015, 0.9, 0.14);
        restoreNodeColor(neighbor);
      });

      allLinks.forEach((link) => {
        if (link.userData._filtered) return;
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        if (!source || !target) return;
        const directlyRelated =
          (source === node && previewNeighborSet.has(target)) ||
          (target === node && previewNeighborSet.has(source));
        if (!directlyRelated) return;

        hoverPreviewLinks.add(link);
        if (link.userData.flowMesh) link.userData.flowMesh.visible = false;
        (link.material as THREE.LineBasicMaterial).color.set(getEdgeTypeColor(link.userData.edgeType, link.userData.trueColor || link.userData.clusterColor || 0xffffff));
        setLinkOpacity(link, link.userData.isInternal ? 0.22 : 0.56, 0.12);
      });

      setPreviewNodeLabelsFromNode(node, node.userData.isSun ? 8 : 10);
    }

    function applyGraphAttention(node: THREE.Group | null, locked = false): void {
      clearHoverPreview(0, false);
      if (!node) {
        allNodes.forEach((n) => {
          setNodeFocusRole(n, null);
          if (!n.visible) return;
          setNodePresence(n, 1, 1, 0.26);
          restoreNodeColor(n);
        });
        if (layoutMode !== 'galaxy') {
          applyLayoutLinkVisibility(layoutMode);
          clearNodeLabels();
          return;
        }
        allLinks.forEach((l) => {
          if (l.userData._filtered) return;
          if (l.userData.isInternal) {
            if (l.userData.flowMesh) l.userData.flowMesh.visible = false;
            setLinkOpacity(l, 0, 0.24);
            return;
          }
          if (l.userData.flowMesh) l.userData.flowMesh.visible = false;
          (l.material as THREE.LineBasicMaterial).color.set(getEdgeTypeColor(l.userData.edgeType, l.userData.trueColor || l.userData.clusterColor || 0xffffff));
          setLinkOpacity(l, getGalaxyOverviewLinkOpacity(l), 0.24);
        });
        clearNodeLabels();
        return;
      }

      const neighbors = getInteractionNeighbors(node);
      const dimScene = !locked || layoutMode === 'galaxy';
      allNodes.forEach((n) => {
        setNodeFocusRole(n, null);
        if (!n.visible) return;
        if (n === node) {
          setNodeFocusRole(n, 'focus');
          setNodePresence(n, dimScene ? (locked ? 1.2 : 1.1) : 1.06, 1, 0.24);
          restoreNodeColor(n);
        } else if (neighbors.has(n)) {
          setNodeFocusRole(n, 'neighbor');
          setNodePresence(n, dimScene ? (locked ? 1.03 : 1.01) : 1, dimScene ? (locked ? 0.86 : 0.76) : 1, 0.24);
          restoreNodeColor(n);
        } else {
          setNodePresence(n, dimScene ? (locked ? 0.82 : 0.94) : 1, dimScene ? (locked ? 0.18 : 0.36) : 1, 0.24);
          restoreNodeColor(n);
        }
      });

      if (!dimScene) applyLayoutLinkVisibility(layoutMode);
      allLinks.forEach((l) => {
        if (l.userData._filtered) return;
        const s = l.userData.source as THREE.Group;
        const t = l.userData.target as THREE.Group;
        const directlyRelated = (s === node && neighbors.has(t)) || (t === node && neighbors.has(s));
        if (l.userData.flowMesh) l.userData.flowMesh.visible = dimScene && directlyRelated && locked;

        if (directlyRelated) {
          (l.material as THREE.LineBasicMaterial).color.set(getEdgeTypeColor(l.userData.edgeType, l.userData.trueColor || l.userData.clusterColor || 0xffffff));
          setLinkOpacity(l, dimScene ? (locked ? 0.88 : 0.72) : 0.62, 0.18);
        } else if (l.userData.semantic || l.userData.isInternal) {
          if (dimScene) setLinkOpacity(l, locked && layoutMode !== 'galaxy' ? 0.035 : 0, 0.18);
        } else {
          if (dimScene) setLinkOpacity(l, locked ? (layoutMode === 'galaxy' ? 0 : 0.025) : 0.035, 0.18);
        }
      });

      setNodeLabelsFromNode(node);
    }

    function openNodeInForgePreview(node: THREE.Group): boolean {
      const nodeId = String(node.userData.id || '');
      if (!nodeId || node.userData.isSun) return false;
      useAppStore.getState().openForgeCardPreview({
        id: nodeId,
        title: String(node.userData.name || '未命名卡片'),
        type: String(node.userData.type || 'fleeting'),
      });
      return true;
    }

    function focusNode(node: THREE.Group): void {
      setResetButtonVisible(true);
      if (autoRotateBeforeFocus === null) autoRotateBeforeFocus = controls.autoRotate;
      controls.autoRotate = false;
      const focusSelection = getFocusSelection(node);
      lastFocusSelection = focusSelection;
      lockedNode = node;
      pressedNode = null;

      // Special highlight for focused node
      if (node.userData.ring) {
        gsap.to(node.userData.ring.material, { opacity: 0.8, duration: 0.5 });
      }
      if (node.userData.isSun) currentClusterId = node.userData.clusterId;
      applyGraphAttention(node, true);

      if (layoutMode === 'concentric') {
        concentricCenterNode = node;
        animateNodesTo(computeConcentricTargets(), 0.65);
        return;
      }

      if (CENTER_SPIN_LAYOUT_MODES.has(layoutMode)) {
        centerSpinActive = false;
        return;
      }

      if (layoutMode === 'galaxy' || layoutMode === 'mastery') {
        frameSelection(focusSelection, node, node.userData.isSun ? 1.15 : 0.75);
      }
    }

    // --- Learning Path ---
    function buildDemoLearningPath(stepsFromProps?: { id: string; cardId?: string | null; index: number; name: string; status?: string; mastery?: number }[]): void {
      const steps: { node: THREE.Group; stepIndex: number; status?: string; mastery?: number }[] = [];

      if (stepsFromProps && stepsFromProps.length > 0) {
        for (const s of stepsFromProps) {
          // Search ALL scene nodes (not just clusterNodes) with progressive fallback
          let found: THREE.Group | undefined;

          // 1) Exact card ID match. Learning steps have their own ID, so the
          // bound cardId is the reliable graph-node key when present.
          found = allNodes.find(n => n.userData.id === (s.cardId || s.id));

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

          if (found) steps.push({ node: found, stepIndex: s.index, status: s.status, mastery: s.mastery });
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
      const rootNodeData = nodesData.find(n => n.isRoot);
      const graphNodesData = nodesData.filter(n => !n.isRoot);

      // Build a lookup from node title to node data for edge matching
      const nodeTitleToGroup = new Map<string, THREE.Group>();
      const nodeDegree = new Map<string, number>();
      const semanticDegree = new Map<string, number>();
      const weightedDegree = new Map<string, number>();
      edgesData.forEach(edge => {
        const weight = Number.isFinite(edge.weight) ? edge.weight : 1;
        nodeDegree.set(edge.sourceId, (nodeDegree.get(edge.sourceId) || 0) + 1);
        nodeDegree.set(edge.targetId, (nodeDegree.get(edge.targetId) || 0) + 1);
        weightedDegree.set(edge.sourceId, (weightedDegree.get(edge.sourceId) || 0) + weight);
        weightedDegree.set(edge.targetId, (weightedDegree.get(edge.targetId) || 0) + weight);
        if (edge.type !== 'contains') {
          semanticDegree.set(edge.sourceId, (semanticDegree.get(edge.sourceId) || 0) + 1);
          semanticDegree.set(edge.targetId, (semanticDegree.get(edge.targetId) || 0) + 1);
        }
      });

      if (rootNodeData) {
        const rootTitle = rootNodeData.title || '知识库';
        const root = createGlowNode(0xffffff, 10.4, rootTitle);
        root.position.set(0, 0, 0);
        root.userData.position3D = root.position.clone();
        root.userData.id = rootNodeData.id;
        root.userData.type = rootNodeData.type;
        root.userData.trueColor = 0xffffff;
        root.userData.clusterColor = 0xffffff;
        root.userData.isRoot = true;
        root.userData.parentId = null;
        root.userData.depth = 0;
        root.userData.childCount = rootNodeData.childCount || 0;
        root.userData.createdAt = rootNodeData.createdAt;
        root.userData.updatedAt = rootNodeData.updatedAt;
        nodesGroup.add(root);
        nodeTitleToGroup.set(rootTitle, root);
        addClusterLabel(rootTitle, 0xffffff, new THREE.Vector3(0, 86, 0), root);
      }

      // Create sun for each cluster
      clustersData.forEach((cluster, i) => {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / clustersData.length);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const dist = GALAXY_LAYOUT.clusterMinDistance + seededRandom(hashId(cluster.id)) * GALAXY_LAYOUT.clusterDistanceJitter;
        const cx = dist * Math.sin(phi) * Math.cos(theta);
        const cy = dist * Math.cos(phi) * 1.2;
        const cz = dist * Math.sin(phi) * Math.sin(theta);

        const color = parseInt(cluster.color.replace('#', ''), 16);
        const sunSize = 5.1 + Math.min(1.6, Math.sqrt(Math.max(1, cluster.cardCount || 1)) * 0.22);
        const sun = createGlowNode(color, sunSize, cluster.name);
        sun.position.set(cx, cy, cz);
        sun.userData.position3D = sun.position.clone();
        sun.userData.isSun = true;
        sun.userData.clusterId = i;
        sun.userData.clusterColor = color;
        nodesGroup.add(sun);
        clusterSuns.set(i, sun);

        // Cluster name label — always visible above the sun
        const clusterPos = new THREE.Vector3(cx, cy, cz);
        addClusterLabel(cluster.name, 0xffffff, clusterPos, sun);

        // Link sun to center
        const core = getCoreNode();
        if (core) createCurve(core, sun, color, 0.08, undefined, color, false);

        // Create nodes for cards in this cluster — with organic positioning + mixed colors
        const clusterNodeData = graphNodesData.filter(n => n.clusterId === cluster.id);
        const sortedClusterNodes = [...clusterNodeData].sort((a, b) => {
          const degreeDiff = (nodeDegree.get(b.id) || 0) - (nodeDegree.get(a.id) || 0);
          if (degreeDiff !== 0) return degreeDiff;
          const typeRank = (node: GalaxyNode) => node.type === 'permanent' ? 2 : node.type === 'literature' ? 1 : 0;
          return typeRank(b) - typeRank(a);
        });
        const subNodes: THREE.Group[] = [];
        sortedClusterNodes.forEach((cardNode, j) => {
          // Stable golden-angle scatter keeps clusters legible without mechanical rings.
          const seed = hashId(cardNode.id);
          const layer = j < 4 ? 0 : j < 14 ? 1 : 2;
          const baseRadius = layer === 0 ? GALAXY_LAYOUT.clusterInnerRadius : layer === 1 ? GALAXY_LAYOUT.clusterMiddleRadius : GALAXY_LAYOUT.clusterOuterRadius;
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));
          const rankRatio = (j + 0.5) / Math.max(1, sortedClusterNodes.length);
          const radius = baseRadius
            + (seededRandom(seed) - 0.5) * GALAXY_LAYOUT.clusterLayerGap
            + Math.sin((j + 1) * 1.618) * (10 + layer * 6)
            + rankRatio * (layer === 2 ? 34 : 18);
          const t = j * goldenAngle + seededRandom(seed + 1) * 0.8 + layer * 0.9;
          const yBand = layer === 0 ? 0.28 : layer === 1 ? 0.44 : 0.58;
          const verticalWave = (
            (seededRandom(seed + 2) * 2 - 1) * 0.72
            + Math.sin(t * 1.35 + seededRandom(seed + 3) * Math.PI) * 0.28
          ) * radius * yBand;
          const orbitTilt = layer % 2 === 0 ? 0.78 : 0.64;
          const x = cx + Math.cos(t) * radius;
          const y = cy + verticalWave;
          const z = cz + Math.sin(t) * radius * orbitTilt;
          const distToSun = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
          const sizeFactor = Math.max(0.5, 1 - distToSun / 430);

          const baseSize = cardNode.type === 'permanent' ? 3.8 : cardNode.type === 'literature' ? 3.15 : 2.85;
          const semanticBoost = Math.min(1.55, Math.log1p(semanticDegree.get(cardNode.id) || 0) * 0.7);
          const hierarchyBoost = Math.min(0.7, Math.log1p(cardNode.childCount || 0) * 0.35);
          const weightBoost = Math.min(0.85, Math.log1p(weightedDegree.get(cardNode.id) || 0) * 0.2);
          const layerBoost = layer === 0 ? 0.45 : layer === 1 ? 0.18 : 0;
          const nodeSize = baseSize * sizeFactor + semanticBoost + hierarchyBoost + weightBoost + layerBoost;
          const nodeTypeColor = cardNode.type === 'permanent' ? 0xa855f7 : cardNode.type === 'literature' ? 0xf472b6 : 0x22d3ee;
          const node = createGlowNode(nodeTypeColor, nodeSize, cardNode.title);
          node.position.set(x, y, z);
          node.userData.position3D = node.position.clone();
          node.userData.id = cardNode.id;
          node.userData.graphDegree = semanticDegree.get(cardNode.id) || 0;
          node.userData.graphWeight = weightedDegree.get(cardNode.id) || 0;
          node.userData.clusterId = i;
          node.userData.clusterColor = color;
          node.userData.type = cardNode.type;
          node.userData.trueColor = nodeTypeColor;
          node.userData.parentId = cardNode.parentId;
          node.userData.depth = cardNode.depth;
          node.userData.childCount = cardNode.childCount || 0;
          node.userData.hierarchyPath = cardNode.hierarchyPath || [];
          node.userData.tags = cardNode.tags || [];
          node.userData.createdAt = cardNode.createdAt;
          node.userData.updatedAt = cardNode.updatedAt;
          nodesGroup.add(node);
          subNodes.push(node);

          // Sun-to-node edges make the cluster structure legible in the overview.
          createCurve(sun, node, nodeTypeColor, 0.035, true, nodeTypeColor, false, 'contains', 0.35);

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
      const unclusteredIds = new Set(graphNodesData.filter(n => !n.clusterId).map(n => n.id));

      // Build cluster lookup by DB id (clustersData[i].id → i)
      const clusterIdxByDbId = new Map(clustersData.map((cl, i) => [cl.id, i]));

      // For each edge where an unclustered node connects to a clustered node,
      // assign the unclustered node to that cluster
      edgesData.forEach(edge => {
        const srcNode = graphNodesData.find(n => n.id === edge.sourceId);
        const tgtNode = graphNodesData.find(n => n.id === edge.targetId);
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
      const unclusteredNodes = graphNodesData.filter(n => !n.clusterId);
      unclusteredNodes.forEach((cardNode) => {
        const utc = cardNode.type === 'permanent' ? 0xa855f7 : cardNode.type === 'literature' ? 0xf472b6 : 0x22d3ee;
        const looseBase = cardNode.type === 'permanent' ? 2.8 : cardNode.type === 'literature' ? 2.45 : 2.2;
        const looseSize = looseBase
          + Math.min(1.15, Math.log1p(semanticDegree.get(cardNode.id) || 0) * 0.55)
          + Math.min(0.5, Math.log1p(weightedDegree.get(cardNode.id) || 0) * 0.18);
        const node = createGlowNode(utc, looseSize, cardNode.title);
        node.userData.id = cardNode.id;
        node.userData.graphDegree = semanticDegree.get(cardNode.id) || 0;
        node.userData.graphWeight = weightedDegree.get(cardNode.id) || 0;
        node.userData.trueColor = utc;
        node.userData.clusterColor = utc;
        node.userData.type = cardNode.type;
        node.userData.parentId = cardNode.parentId;
        node.userData.depth = cardNode.depth;
        node.userData.childCount = cardNode.childCount || 0;
        node.userData.hierarchyPath = cardNode.hierarchyPath || [];
        node.userData.tags = cardNode.tags || [];
        node.userData.createdAt = cardNode.createdAt;
        node.userData.updatedAt = cardNode.updatedAt;

        // Check if this node should be placed near a cluster via wiki-link
        const targetClusterId = linkTargetCluster.get(cardNode.id);
        const targetClusterSun = targetClusterId
          ? clusterSuns.get(clusterIdxByDbId.get(targetClusterId) ?? -1)
          : undefined;

        if (targetClusterSun) {
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
          // Keep real ownership clear: edge affinity may influence placement,
          // but an unclustered card is not a member until card.clusterId is set.
          node.userData.clusterId = null;
          node.userData.affinityClusterId = targetClusterId;
          node.userData.clusterColor = utc;
        } else {
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
        }

        node.userData.position3D = node.position.clone();
        nodesGroup.add(node);
      });

      // Create edges from real data (concept-to-concept connections)
      // Real wiki-link edges are always visible regardless of cluster.
      edgesData.forEach(edge => {
        if (edge.type === 'contains') return;
        const sourceNode = allNodes.find(n => n.userData.id === edge.sourceId);
        const targetNode = allNodes.find(n => n.userData.id === edge.targetId);
        if (sourceNode && targetNode) {
          const edgeColor = sourceNode.userData.trueColor || sourceNode.userData.clusterColor || 0xffffff;
          createCurve(sourceNode, targetNode, edgeColor, 0.5, false, edgeColor, true, edge.type, edge.weight || 1);
        }
      });
    }

    function applyHierarchyInitialPositions(edgesData: GalaxyEdge[]): void {
      const root = getCoreNode();
      if (!root?.userData.id) return;

      const nodeById = new Map<string, THREE.Group>();
      allNodes.forEach((node) => {
        if (node.userData.id) nodeById.set(String(node.userData.id), node);
      });

      const childrenByParent = new Map<string, string[]>();
      edgesData
        .filter(edge => edge.type === 'contains' && nodeById.has(edge.sourceId) && nodeById.has(edge.targetId))
        .forEach((edge) => {
          childrenByParent.set(edge.sourceId, [...(childrenByParent.get(edge.sourceId) || []), edge.targetId]);
        });

      const rootId = String(root.userData.id);
      const levels = new Map<number, THREE.Group[]>();
      const parentAngle = new Map<string, number>([[rootId, -Math.PI / 2]]);
      const seen = new Set<string>([rootId]);
      const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
      root.position.set(0, 0, 0);
      root.userData.position3D = root.position.clone();

      while (queue.length > 0) {
        const current = queue.shift()!;
        const children = (childrenByParent.get(current.id) || [])
          .map(id => nodeById.get(id))
          .filter((node): node is THREE.Group => !!node)
          .sort((a, b) => sortedByGraphSemantics([a, b])[0] === a ? -1 : 1);
        const parentBaseAngle = parentAngle.get(current.id) ?? -Math.PI / 2;
        const spread = current.depth === 0 ? Math.PI * 2 : Math.min(Math.PI * 0.95, Math.PI * 0.32 + children.length * 0.1);
        children.forEach((child, index) => {
          const childId = String(child.userData.id);
          if (seen.has(childId)) return;
          seen.add(childId);
          const depth = current.depth + 1;
          const localRatio = children.length <= 1 ? 0.5 : index / (children.length - 1);
          const angle = current.depth === 0
            ? (index / Math.max(1, children.length)) * Math.PI * 2 - Math.PI / 2
            : parentBaseAngle - spread / 2 + localRatio * spread;
          parentAngle.set(childId, angle);
          child.userData.depth = typeof child.userData.depth === 'number' ? child.userData.depth : depth;
          levels.set(depth, [...(levels.get(depth) || []), child]);
          queue.push({ id: childId, depth });
        });
      }

      levels.forEach((nodesInLevel, depth) => {
        const radius = 210 + depth * 165;
        nodesInLevel.forEach((node, index) => {
          const id = String(node.userData.id || index);
          const angle = parentAngle.get(id) ?? ((index / Math.max(1, nodesInLevel.length)) * Math.PI * 2);
          const seed = hashId(id);
          const jitter = (seededRandom(seed) - 0.5) * 34;
          const y = depth === 1 ? 46 : depth === 2 ? -18 : -64 - (depth - 3) * 18;
          node.position.set(
            Math.cos(angle) * (radius + jitter),
            y,
            Math.sin(angle) * (radius + jitter),
          );
          node.userData.position3D = node.position.clone();
        });
      });

      allNodes.forEach((node) => {
        if (!node.userData.position3D) node.userData.position3D = node.position.clone();
      });
    }

    function getCoreNode(): THREE.Group | undefined {
      return allNodes.find(n => n.userData.isRoot && !n.userData.isSun)
        || allNodes.find(n => n.userData.isSyntheticRoot && !n.userData.isSun)
        || allNodes.find(n => n.userData.name === 'CENTRAL_INTELLIGENCE' && !n.userData.isSun && !n.userData.id);
    }

    function getInitialGalaxyPosition(node: THREE.Group): THREE.Vector3 | undefined {
      const initial = node.userData.initialPosition3D as THREE.Vector3 | undefined;
      if (initial?.isVector3) return initial;
      const position3D = node.userData.position3D as THREE.Vector3 | undefined;
      if (position3D?.isVector3) return position3D;
      return undefined;
    }

    function captureInitialGalaxyPositions(): void {
      allNodes.forEach((node) => {
        const initial = getInitialGalaxyPosition(node) || node.position;
        node.userData.initialPosition3D = initial.clone();
        node.userData.position3D = initial.clone();
      });
    }

    function computeInitialGalaxyTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      allNodes.forEach((node) => {
        const initial = getInitialGalaxyPosition(node) || node.position;
        targets.set(node, initial.clone());
      });
      return targets;
    }

    function restoreInitialGalaxyAnchors(): Map<THREE.Group, THREE.Vector3> {
      const targets = computeInitialGalaxyTargets();
      galaxyForceAnchors = new Map();
      targets.forEach((target, node) => {
        node.userData.position3D = target.clone();
        galaxyForceAnchors.set(node, target.clone());
        const velocity = node.userData.forceVelocity as THREE.Vector3 | undefined;
        if (velocity?.isVector3) velocity.set(0, 0, 0);
      });
      galaxyForceAlpha = 0;
      galaxyForceFrameBudget = 0;
      invalidateGalaxyForceCache();
      return targets;
    }

    function capture3DPositions(): void {
      allNodes.forEach((node) => {
        if (!node.userData.position3D) node.userData.position3D = node.position.clone();
        if (!node.userData.initialPosition3D) {
          const position3D = node.userData.position3D as THREE.Vector3 | undefined;
          node.userData.initialPosition3D = position3D?.isVector3 ? position3D.clone() : node.position.clone();
        }
      });
    }

    function invalidateGalaxyForceCache(): void {
      galaxyForceCache = null;
    }

    function getGalaxyPerformanceTier(nodeCount = allNodes.length, linkCount = allLinks.length): GalaxyPerformanceTier {
      if (nodeCount >= 560 || linkCount >= 1500) return 'dense';
      if (nodeCount >= 280 || linkCount >= 780) return 'large';
      return 'normal';
    }

    function getGalaxyForceBudget(): {
      maxNodes: number
      maxLinks: number
      frameInterval: number
      frameBudgetScale: number
    } {
      if (galaxyPerformanceTier === 'dense') {
        return { maxNodes: 190, maxLinks: 420, frameInterval: 3, frameBudgetScale: 0.42 };
      }
      if (galaxyPerformanceTier === 'large') {
        return { maxNodes: 260, maxLinks: 650, frameInterval: 2, frameBudgetScale: 0.68 };
      }
      return { maxNodes: GALAXY_FORCE.maxNodes, maxLinks: GALAXY_FORCE.maxLinks, frameInterval: 1, frameBudgetScale: 1 };
    }

    function getTargetRendererPixelRatio(): number {
      const nativeRatio = Math.max(1, window.devicePixelRatio || 1);
      const cap = galaxyPerformanceTier === 'dense' ? 1 : galaxyPerformanceTier === 'large' ? 1.25 : 1.5;
      return Math.min(nativeRatio, cap);
    }

    function applyRendererPerformanceBudget(): void {
      if (!renderer || !composer) return;
      const ratio = getTargetRendererPixelRatio();
      if (Math.abs(ratio - currentRendererPixelRatio) < 0.01) return;
      currentRendererPixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      const pixelAwareComposer = composer as EffectComposer & { setPixelRatio?: (value: number) => void };
      pixelAwareComposer.setPixelRatio?.(ratio);
      composer.setSize(window.innerWidth, window.innerHeight);
    }

    function updateGalaxyPerformanceBudget(nodeCount = allNodes.length, linkCount = allLinks.length): void {
      const nextTier = getGalaxyPerformanceTier(nodeCount, linkCount);
      if (nextTier !== galaxyPerformanceTier) {
        galaxyPerformanceTier = nextTier;
        galaxyForceTick = 0;
        invalidateGalaxyForceCache();
      }
      applyRendererPerformanceBudget();
    }

    function coolGalaxyForce(): void {
      galaxyForceAlpha = 0;
      galaxyForceFrameBudget = 0;
      invalidateGalaxyForceCache();
    }

    function reheatGalaxyForce(alpha = 0.42, framesBudget = 90): void {
      if (!galaxyForceEnabled || layoutMode !== 'galaxy') return;
      const budget = getGalaxyForceBudget();
      galaxyForceAlpha = Math.max(galaxyForceAlpha, alpha);
      galaxyForceFrameBudget = Math.max(galaxyForceFrameBudget, Math.ceil(framesBudget * budget.frameBudgetScale));
      invalidateGalaxyForceCache();
    }

    function syncGalaxyForceAnchor(node: THREE.Group): void {
      const anchor = node.position.clone();
      if (!getInitialGalaxyPosition(node)) node.userData.initialPosition3D = anchor.clone();
      galaxyForceAnchors.set(node, anchor);
    }

    function rebuildGalaxyForceAnchors(): void {
      galaxyForceAnchors = semanticClusterLensEnabled ? computeSemanticCommunityTargets() : new Map();
      allNodes.forEach((node) => {
        if (galaxyForceAnchors.has(node)) return;
        const initialPosition = getInitialGalaxyPosition(node);
        galaxyForceAnchors.set(node, initialPosition ? initialPosition.clone() : node.position.clone());
      });
      invalidateGalaxyForceCache();
    }

    function cloneGalaxyForceAnchors(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      galaxyForceAnchors.forEach((anchor, node) => targets.set(node, anchor.clone()));
      return targets;
    }

    function getGalaxyForceAnchor(node: THREE.Group): THREE.Vector3 {
      let anchor = galaxyForceAnchors.get(node);
      if (!anchor) {
        const initialPosition = getInitialGalaxyPosition(node);
        anchor = initialPosition ? initialPosition.clone() : node.position.clone();
        galaxyForceAnchors.set(node, anchor);
      }
      return anchor;
    }

    function getGalaxyForceVelocity(node: THREE.Group): THREE.Vector3 {
      const existing = node.userData.forceVelocity as THREE.Vector3 | undefined;
      if (existing?.isVector3) return existing;
      const velocity = new THREE.Vector3();
      node.userData.forceVelocity = velocity;
      return velocity;
    }

    function getGalaxyForceMass(node: THREE.Group): number {
      const cached = Number(node.userData.forceMass);
      if (Number.isFinite(cached) && cached > 0) return cached;
      const size = Math.max(1, Number(node.userData.baseSize) || 3);
      const degree = Math.max(0, Number(node.userData.graphDegree) || 0);
      const mass = node.userData.isRoot || node.userData.isSyntheticRoot
        ? 10
        : node.userData.isSun
          ? 6.4 + size * 0.5
          : 1.2 + size * 0.34 + Math.min(1.8, degree * 0.09);
      node.userData.forceMass = mass;
      return mass;
    }

    function getGalaxyCollisionRadius(node: THREE.Group): number {
      const size = Math.max(1, Number(node.userData.baseSize) || 3);
      return node.userData.isSun
        ? size * 7.4 + 22
        : node.userData.isRoot || node.userData.isSyntheticRoot
          ? size * 7.8 + 24
          : size * 5.8 + 13;
    }

    function scoreGalaxyForceNode(node: THREE.Group, focusSet: Set<THREE.Group>): number {
      const graphWeight = Number(node.userData.graphWeight) || 0;
      const graphDegree = Number(node.userData.graphDegree) || 0;
      const baseSize = Number(node.userData.baseSize) || 3;
      return (focusSet.has(node) ? 20000 : 0)
        + (node.userData.isRoot || node.userData.isSyntheticRoot ? 9000 : 0)
        + (node.userData.isSun ? 5200 : 0)
        + graphDegree * 86
        + graphWeight * 30
        + baseSize * 64;
    }

    function getGalaxyForceLinkScore(link: THREE.Line, focusSet: Set<THREE.Group>): number {
      const source = link.userData.source as THREE.Group | undefined;
      const target = link.userData.target as THREE.Group | undefined;
      const edgeWeight = Math.max(0, Number(link.userData.edgeWeight) || 1);
      return (source && focusSet.has(source) ? 220 : 0)
        + (target && focusSet.has(target) ? 220 : 0)
        + (link.userData.semantic ? 160 : 0)
        + (link.userData.isInternal ? 78 : 32)
        + Math.log1p(edgeWeight) * 48;
    }

    function getGalaxyForceGraph(): { nodes: THREE.Group[]; links: THREE.Line[] } {
      if (galaxyForceCache) return galaxyForceCache;
      const budget = getGalaxyForceBudget();

      const focusSet = new Set<THREE.Group>();
      [getCoreNode(), lockedNode, hoveredNode, pressedNode].forEach((node) => {
        if (node && node.visible !== false) focusSet.add(node);
      });
      if (lockedNode) {
        getInteractionNeighbors(lockedNode).forEach((node) => {
          if (node.visible !== false) focusSet.add(node);
        });
      }

      const candidates = allNodes.filter((node) => {
        if (node.visible === false) return false;
        return !!node.userData.id || !!node.userData.isSun || !!node.userData.isRoot || !!node.userData.isSyntheticRoot;
      });
      const nodes = candidates.length <= budget.maxNodes
        ? candidates
        : [...candidates]
          .sort((a, b) => scoreGalaxyForceNode(b, focusSet) - scoreGalaxyForceNode(a, focusSet))
          .slice(0, budget.maxNodes);
      const nodeSet = new Set(nodes);
      const linkCandidates = allLinks.filter((link) => {
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        return !!source
          && !!target
          && source.visible !== false
          && target.visible !== false
          && nodeSet.has(source)
          && nodeSet.has(target);
      });
      const links = linkCandidates.length <= budget.maxLinks
        ? linkCandidates
        : [...linkCandidates]
          .sort((a, b) => getGalaxyForceLinkScore(b, focusSet) - getGalaxyForceLinkScore(a, focusSet))
          .slice(0, budget.maxLinks);

      galaxyForceCache = { nodes, nodeSet, links };
      return galaxyForceCache;
    }

    function getGalaxyForceRestDistance(link: THREE.Line): number {
      const edgeWeight = Math.max(0, Number(link.userData.edgeWeight) || 1);
      const weightPull = 1 + Math.min(0.35, Math.log1p(edgeWeight) * 0.09);
      if (link.userData.isInternal) return 112 / weightPull;
      if (link.userData.semantic) return (link.userData.crossCluster ? 255 : 158) / weightPull;
      return 315;
    }

    function getGalaxyForceLinkStrength(link: THREE.Line): number {
      const edgeWeight = Math.max(0, Number(link.userData.edgeWeight) || 1);
      if (link.userData.isInternal) {
        return GALAXY_FORCE.internalLinkStrength + Math.min(0.0014, Math.log1p(edgeWeight) * 0.0005);
      }
      if (link.userData.semantic) {
        const type = String(link.userData.edgeType || '');
        const typeBoost = type === 'prerequisite' || type === 'derived' ? 0.002 : type === 'wikilink' ? 0.0012 : 0.0006;
        return GALAXY_FORCE.linkStrength + typeBoost + Math.min(0.003, Math.log1p(edgeWeight) * 0.001);
      }
      return 0.0024;
    }

    function getGalaxyMotionCenter(node: THREE.Group, core?: THREE.Group): THREE.Vector3 | null {
      if (node.userData.isRoot || node.userData.isSyntheticRoot) return null;
      if (node.userData.isSun) return core?.position || null;
      const clusterId = typeof node.userData.clusterId === 'number' ? node.userData.clusterId : null;
      const sun = clusterId !== null ? clusterSuns.get(clusterId) : undefined;
      return sun?.position || core?.position || null;
    }

    function getGalaxyOrbitDirection(node: THREE.Group): number {
      const cached = Number(node.userData.forceOrbitDirection);
      if (cached === 1 || cached === -1) return cached;
      const seed = hashId(String(node.userData.id || node.userData.name || 'node'));
      const direction = seededRandom(seed + 17) > 0.5 ? 1 : -1;
      node.userData.forceOrbitDirection = direction;
      return direction;
    }

    function stepGalaxyForceSimulation(): void {
      if (layoutMode !== 'galaxy' || !galaxyForceEnabled) return;
      if (layoutAnimating || activeNodeDrag || dragSettle) return;
      if (galaxyForceAlpha < GALAXY_FORCE.alphaMin && galaxyForceFrameBudget <= 0) return;
      const budget = getGalaxyForceBudget();
      galaxyForceTick += 1;
      if (budget.frameInterval > 1 && galaxyForceTick % budget.frameInterval !== 0) return;

      const { nodes, links } = getGalaxyForceGraph();
      if (nodes.length < 2) return;

      const alpha = Math.max(GALAXY_FORCE.alphaMin, galaxyForceAlpha);
      const core = getCoreNode();
      const delta = new THREE.Vector3();
      const tangent = new THREE.Vector3();
      const orbitAxis = new THREE.Vector3(0.22, 1, 0.16).normalize();

      nodes.forEach((node) => {
        const velocity = getGalaxyForceVelocity(node);
        const mass = getGalaxyForceMass(node);
        const anchor = getGalaxyForceAnchor(node);
        const anchorStrength = node === core || node.userData.isRoot || node.userData.isSyntheticRoot
          ? GALAXY_FORCE.anchorStrength * 9
          : node.userData.isSun
            ? GALAXY_FORCE.anchorStrength * 2.1
            : GALAXY_FORCE.anchorStrength;

        delta.subVectors(anchor, node.position);
        velocity.addScaledVector(delta, (anchorStrength * alpha) / mass);
        if (node !== core) {
          velocity.addScaledVector(node.position, (-GALAXY_FORCE.centerStrength * alpha) / mass);
        }

        const motionCenter = getGalaxyMotionCenter(node, core);
        if (motionCenter && !node.userData.isSun) {
          delta.subVectors(node.position, motionCenter);
          if (delta.lengthSq() > 1800) {
            tangent.crossVectors(orbitAxis, delta).normalize();
            velocity.addScaledVector(
              tangent,
              (getGalaxyOrbitDirection(node) * GALAXY_FORCE.orbitDriftStrength * alpha) / mass
            );
          }
        }
      });

      links.forEach((link) => {
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        if (!source || !target) return;
        const sourceVelocity = getGalaxyForceVelocity(source);
        const targetVelocity = getGalaxyForceVelocity(target);
        delta.subVectors(target.position, source.position);
        const distance = Math.max(1, delta.length());
        const restDistance = getGalaxyForceRestDistance(link);
        const stretch = distance - restDistance;
        const force = (stretch / distance) * getGalaxyForceLinkStrength(link) * alpha;
        sourceVelocity.addScaledVector(delta, force / getGalaxyForceMass(source));
        targetVelocity.addScaledVector(delta, -force / getGalaxyForceMass(target));
      });

      const repelDistanceSq = GALAXY_FORCE.repelDistance * GALAXY_FORCE.repelDistance;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const va = getGalaxyForceVelocity(a);
        const ma = getGalaxyForceMass(a);
        const radiusA = getGalaxyCollisionRadius(a);
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          delta.subVectors(a.position, b.position);
          let distanceSq = delta.lengthSq();
          if (distanceSq < 0.0001) {
            const seed = hashId(String(a.userData.id || a.userData.name || i) + String(b.userData.id || b.userData.name || j));
            delta.set(seededRandom(seed) - 0.5, seededRandom(seed + 1) - 0.5, seededRandom(seed + 2) - 0.5).normalize();
            distanceSq = 1;
          }
          const radiusB = getGalaxyCollisionRadius(b);
          const minDistance = radiusA + radiusB;
          if (distanceSq > repelDistanceSq && distanceSq > minDistance * minDistance) continue;

          const distance = Math.sqrt(distanceSq);
          delta.multiplyScalar(1 / Math.max(1, distance));
          const repel = Math.min(0.11, GALAXY_FORCE.repelStrength / Math.max(90, distanceSq));
          const collide = distance < minDistance ? (minDistance - distance) * GALAXY_FORCE.collideStrength : 0;
          const force = (repel + collide) * alpha;
          if (force <= 0) continue;
          const vb = getGalaxyForceVelocity(b);
          va.addScaledVector(delta, force / ma);
          vb.addScaledVector(delta, -force / getGalaxyForceMass(b));
        }
      }

      const movedNodes: THREE.Group[] = [];
      nodes.forEach((node) => {
        const velocity = getGalaxyForceVelocity(node);
        velocity.multiplyScalar(GALAXY_FORCE.velocityDamping);
        if (velocity.lengthSq() > GALAXY_FORCE.maxStep * GALAXY_FORCE.maxStep) {
          velocity.setLength(GALAXY_FORCE.maxStep);
        }
        if (velocity.lengthSq() < 0.0004) return;
        node.position.add(velocity);
        if (!node.userData.isRoot && !node.userData.isSyntheticRoot && !node.userData.isSun) {
          const anchor = getGalaxyForceAnchor(node);
          const relaxation = GALAXY_FORCE.anchorRelaxation * alpha * (semanticClusterLensEnabled ? 0.46 : 1);
          anchor.lerp(node.position, relaxation);
        }
        movedNodes.push(node);
      });

      if (movedNodes.length > 0) refreshLinkGeometryForNodes(movedNodes);
      galaxyForceAlpha *= GALAXY_FORCE.alphaDecay;
      galaxyForceFrameBudget = Math.max(0, galaxyForceFrameBudget - 1);
      if (galaxyForceFrameBudget === 0 && galaxyForceAlpha < GALAXY_FORCE.alphaMin) galaxyForceAlpha = 0;
    }

    function enterFlatInteractionMode(): void {
      if (!flatInteractionSnapshot) {
        flatInteractionSnapshot = {
          autoRotate: controls.autoRotate,
          enableRotate: controls.enableRotate,
          enablePan: controls.enablePan,
          screenSpacePanning: controls.screenSpacePanning,
          minDistance: controls.minDistance,
          maxDistance: controls.maxDistance,
          mouseButtons: { ...controls.mouseButtons },
          touches: { ...controls.touches },
        };
      }

      controls.autoRotate = false;
      controls.enableRotate = false;
      controls.enablePan = true;
      controls.screenSpacePanning = true;
      controls.minDistance = 260;
      controls.maxDistance = 2600;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
    }

    function exitFlatInteractionMode(): void {
      if (!flatInteractionSnapshot) return;
      controls.autoRotate = flatInteractionSnapshot.autoRotate;
      controls.enableRotate = flatInteractionSnapshot.enableRotate;
      controls.enablePan = flatInteractionSnapshot.enablePan;
      controls.screenSpacePanning = flatInteractionSnapshot.screenSpacePanning;
      controls.minDistance = flatInteractionSnapshot.minDistance;
      controls.maxDistance = flatInteractionSnapshot.maxDistance;
      controls.mouseButtons = { ...flatInteractionSnapshot.mouseButtons };
      controls.touches = { ...flatInteractionSnapshot.touches };
      flatInteractionSnapshot = null;
    }

    function getGraphNeighbors(node: THREE.Group): Set<THREE.Group> {
      const neighbors = new Set<THREE.Group>();
      allLinks.forEach((link) => {
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        if (!source || !target) return;
        if (source === node) neighbors.add(target);
        if (target === node) neighbors.add(source);
      });
      return neighbors;
    }

    function getNodeDegree(node: THREE.Group): number {
      return getGraphNeighbors(node).size;
    }

    function getTypeRank(node: THREE.Group): number {
      if (node.userData.isSun) return 4;
      if (!node.userData.id) return 5;
      const type = String(node.userData.type || '');
      if (type === 'permanent') return 3;
      if (type === 'fleeting') return 2;
      if (type === 'literature') return 1;
      return 0;
    }

    function getClusterSlot(node: THREE.Group): number {
      const raw = node.userData.clusterId;
      if (typeof raw === 'number') return raw;
      return clusterSuns.size;
    }

    function sortedByGraphSemantics(nodes: THREE.Group[]): THREE.Group[] {
      return [...nodes].sort((a, b) => {
        const clusterDiff = getClusterSlot(a) - getClusterSlot(b);
        if (clusterDiff !== 0) return clusterDiff;
        const typeDiff = getTypeRank(b) - getTypeRank(a);
        if (typeDiff !== 0) return typeDiff;
        const degreeDiff = getNodeDegree(b) - getNodeDegree(a);
        if (degreeDiff !== 0) return degreeDiff;
        return String(a.userData.name || '').localeCompare(String(b.userData.name || ''));
      });
    }

    function placeMiniGrid(
      targets: Map<THREE.Group, THREE.Vector3>,
      nodes: THREE.Group[],
      center: THREE.Vector3,
      gap = 48,
      columns = 4
    ): void {
      const sorted = sortedByGraphSemantics(nodes);
      const rows = Math.max(1, Math.ceil(sorted.length / columns));
      sorted.forEach((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        targets.set(node, new THREE.Vector3(
          center.x + (col - (Math.min(columns, sorted.length) - 1) / 2) * gap,
          center.y,
          center.z + (row - (rows - 1) / 2) * gap,
        ));
      });
    }

    function disposeGuideObject(obj: THREE.Object3D): void {
      obj.traverse((child) => {
        const geometry = (child as THREE.Mesh | THREE.Line | THREE.Points).geometry as THREE.BufferGeometry | undefined;
        if (geometry) geometry.dispose();
        const material = (child as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite).material as THREE.Material | THREE.Material[] | undefined;
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        materials.forEach((mat) => {
          const spriteMat = mat as THREE.SpriteMaterial;
          if (spriteMat.map) spriteMat.map.dispose();
          mat.dispose();
        });
      });
    }

    function clearLayoutGuides(): void {
      if (!layoutGuideGroup) return;
      while (layoutGuideGroup.children.length > 0) {
        const child = layoutGuideGroup.children[0];
        disposeGuideObject(child);
        layoutGuideGroup.remove(child);
      }
    }

    function clearGalaxyBoundaryRings(): void {
      if (!galaxyBoundaryGroup) return;
      while (galaxyBoundaryGroup.children.length > 0) {
        const child = galaxyBoundaryGroup.children[0];
        disposeGuideObject(child);
        galaxyBoundaryGroup.remove(child);
      }
    }

    function addGalaxyBoundaryRing(
      center: THREE.Vector3,
      radiusX: number,
      radiusZ: number,
      color: number,
      opacity: number,
      tiltX = 0,
      tiltZ = 0,
      phase = 0
    ): void {
      if (!galaxyBoundaryGroup) return;
      const ringGroup = new THREE.Group();
      ringGroup.position.copy(center);
      ringGroup.rotation.set(tiltX, 0, tiltZ);
      ringGroup.userData.boundarySpin = tiltX === 0 ? 0.00028 : -0.00022;

      const points: THREE.Vector3[] = [];
      const segments = 192;
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const depthWave = Math.sin(angle * 2 + phase) * 4.5;
        points.push(new THREE.Vector3(Math.cos(angle) * radiusX, depthWave, Math.sin(angle) * radiusZ));
      }

      const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, 2.4, 8, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: opacity * 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      tube.frustumCulled = false;
      ringGroup.add(tube);

      const addOffsetLine = (offsetY: number, lineOpacity: number) => {
        const linePoints = points.map((point) => point.clone().add(new THREE.Vector3(0, offsetY, 0)));
        linePoints.push(linePoints[0].clone());
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(linePoints),
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: lineOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        line.frustumCulled = false;
        ringGroup.add(line);
      };

      addOffsetLine(0, opacity);
      addOffsetLine(7, opacity * 0.34);
      addOffsetLine(-7, opacity * 0.22);

      const dotGeometry = new THREE.BufferGeometry();
      const dotPositions: number[] = [];
      const dotCount = 168;
      for (let i = 0; i < dotCount; i++) {
        const angle = (i / dotCount) * Math.PI * 2;
        const beadDepth = Math.sin(angle * 2 + phase) * 7;
        dotPositions.push(Math.cos(angle) * radiusX, beadDepth, Math.sin(angle) * radiusZ);
      }
      dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dotPositions, 3));
      const dots = new THREE.Points(
        dotGeometry,
        new THREE.PointsMaterial({
          color,
          size: 2.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.58,
        })
      );
      dots.frustumCulled = false;
      ringGroup.add(dots);

      const innerGlow = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([...points, points[0].clone()].map((point) => point.clone().multiplyScalar(0.992))),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: opacity * 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      innerGlow.frustumCulled = false;
      ringGroup.add(innerGlow);

      ringGroup.frustumCulled = false;
      galaxyBoundaryGroup.add(ringGroup);
    }

    function rebuildGalaxyBoundaryRings(): void {
      clearGalaxyBoundaryRings();
      if (!galaxyBoundaryGroup) return;
      galaxyBoundaryGroup.visible = layoutMode === 'galaxy';
      if (layoutMode !== 'galaxy') return;

      const graphNodes = allNodes.filter((node) => node.userData.id || node.userData.isSun || node.userData.isRoot);
      if (graphNodes.length < 2) return;

      const box = new THREE.Box3();
      graphNodes.forEach((node) => {
        const position3D = node.userData.position3D as THREE.Vector3 | undefined;
        box.expandByPoint(layoutMode === 'galaxy' ? node.position : position3D || node.position);
      });
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      const radiusX = Math.max(420, size.x * 0.5 + 180);
      const radiusZ = Math.max(420, size.z * 0.5 + 180);
      const ringRadius = Math.max(radiusX, radiusZ); // same size for both rings
      center.y += Math.min(50, Math.max(-50, size.y * 0.03));

      // Two luminous, thickened rings at 90 degrees. Each ring carries a tube,
      // offset ghost lines, and bead points so the boundary reads as volumetric.
      addGalaxyBoundaryRing(center, ringRadius, ringRadius * 0.985, 0xffffff, 0.24, 0, 0, 0);
      addGalaxyBoundaryRing(center, ringRadius * 0.985, ringRadius, 0xffffff, 0.24, Math.PI / 2, 0, Math.PI / 2.7);
    }

    function addGuideLine(from: THREE.Vector3, to: THREE.Vector3, color = 0x88ddff, opacity = 0.16): void {
      if (!layoutGuideGroup) return;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      line.frustumCulled = false;
      layoutGuideGroup.add(line);
    }

    function addGuideRect(center: THREE.Vector3, width: number, depth: number, color = 0x88ddff, opacity = 0.08): void {
      const hw = width / 2;
      const hd = depth / 2;
      const y = center.y;
      const points = [
        new THREE.Vector3(center.x - hw, y, center.z - hd),
        new THREE.Vector3(center.x + hw, y, center.z - hd),
        new THREE.Vector3(center.x + hw, y, center.z + hd),
        new THREE.Vector3(center.x - hw, y, center.z + hd),
        new THREE.Vector3(center.x - hw, y, center.z - hd),
      ];
      for (let i = 0; i < points.length - 1; i++) addGuideLine(points[i], points[i + 1], color, opacity);
    }

    function addGuideCircle(center: THREE.Vector3, radius: number, color = 0x88ddff, opacity = 0.1): void {
      if (!layoutGuideGroup) return;
      const points: THREE.Vector3[] = [];
      const segments = 96;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius));
      }
      const circle = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      circle.frustumCulled = false;
      layoutGuideGroup.add(circle);
    }

    function addGuideText(text: string, position: THREE.Vector3, color = 'rgba(180,230,255,0.62)', scale = 62): void {
      if (!layoutGuideGroup) return;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '600 42px "Noto Sans SC", "JetBrains Mono", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      const texture = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }));
      sprite.position.copy(position);
      sprite.scale.set(scale * 2.4, scale * 0.6, 1);
      sprite.frustumCulled = false;
      layoutGuideGroup.add(sprite);
    }

    function buildMatrixGuides(): void {
      const rows = [
        { key: 'sun', label: '星团', z: -330, color: 0xfbbf24 },
        { key: 'permanent', label: '永久', z: -110, color: 0xa855f7 },
        { key: 'fleeting', label: '灵感', z: 110, color: 0x22d3ee },
        { key: 'literature', label: '文献', z: 330, color: 0xf472b6 },
        { key: 'other', label: '其他', z: 520, color: 0xffffff },
      ];
      const totalClusters = Math.max(1, clusterSuns.size + 1);
      const columnGap = 250;
      const startX = -((totalClusters - 1) / 2) * columnGap;
      const minX = startX - 125;
      const maxX = startX + (totalClusters - 1) * columnGap + 125;

      rows.forEach((row) => {
        addGuideText(row.label, new THREE.Vector3(minX - 92, 8, row.z), 'rgba(255,255,255,0.42)', 46);
        addGuideLine(new THREE.Vector3(minX, -22, row.z), new THREE.Vector3(maxX, -22, row.z), row.color, 0.16);
      });

      for (let i = 0; i < totalClusters; i++) {
        const x = startX + i * columnGap;
        const sun = clusterSuns.get(i);
        const name = sun?.userData.name ? String(sun.userData.name) : i === clusterSuns.size ? '未归类' : `星团 ${i + 1}`;
        addGuideText(name, new THREE.Vector3(x, 12, -510), 'rgba(180,230,255,0.56)', 44);
        addGuideLine(new THREE.Vector3(x, -22, -430), new THREE.Vector3(x, -22, 610), 0x88ddff, 0.11);
        rows.forEach((row) => addGuideRect(new THREE.Vector3(x, -24, row.z), 212, row.key === 'other' ? 116 : 150, row.color, 0.055));
      }

      addGuideText('横向: 星团 / 纵向: 类型 / 高度: 连接强度', new THREE.Vector3((minX + maxX) / 2, 150, 660), 'rgba(255,255,255,0.32)', 46);
    }

    function buildEvidenceGuides(): void {
      const radius = Math.max(300, clusterSuns.size * 70);
      [
        { label: '结论 / 永久知识', y: 50, color: 0xa855f7 },
        { label: '灵感 / 加工中', y: -90, color: 0x22d3ee },
        { label: '文献 / 证据', y: -240, color: 0xf472b6 },
      ].forEach((layer) => {
        addGuideCircle(new THREE.Vector3(0, layer.y, 0), radius + 100, layer.color, 0.075);
        addGuideText(layer.label, new THREE.Vector3(-radius - 210, layer.y, 0), 'rgba(255,255,255,0.45)', 48);
      });
      addGuideText('证据链: 文献支撑灵感，灵感沉淀为结论', new THREE.Vector3(0, 270, -360), 'rgba(255,255,255,0.34)', 50);
    }

    function buildMasteryGuides(): void {
      [
        { label: '未开始', y: -110, color: 0x667085 },
        { label: '学习中', y: 80, color: 0x44aaff },
        { label: '已掌握', y: 260, color: 0x44dd66 },
      ].forEach((level) => {
        addGuideLine(new THREE.Vector3(-780, level.y, -780), new THREE.Vector3(780, level.y, -780), level.color, 0.11);
        addGuideLine(new THREE.Vector3(-780, level.y, 780), new THREE.Vector3(780, level.y, 780), level.color, 0.11);
        addGuideLine(new THREE.Vector3(-780, level.y, -780), new THREE.Vector3(-780, level.y, 780), level.color, 0.11);
        addGuideLine(new THREE.Vector3(780, level.y, -780), new THREE.Vector3(780, level.y, 780), level.color, 0.11);
        addGuideText(level.label, new THREE.Vector3(-900, level.y, -760), 'rgba(255,255,255,0.42)', 48);
      });
      addGuideText('高度来自学习路径状态与 mastery 掌握度', new THREE.Vector3(0, 380, -880), 'rgba(255,255,255,0.34)', 50);
    }

    function buildTimelineGuides(): void {
      const half = Math.max(360, (allNodes.length - 1) * 39);
      addGuideLine(new THREE.Vector3(-half, -18, 0), new THREE.Vector3(half, -18, 0), 0x88ddff, 0.18);
      addGuideText('较早', new THREE.Vector3(-half, 22, -360), 'rgba(255,255,255,0.38)', 44);
      addGuideText('较新', new THREE.Vector3(half, 22, -360), 'rgba(255,255,255,0.38)', 44);
      [
        { label: '星团', z: -260, color: 0xfbbf24 },
        { label: '永久', z: -90, color: 0xa855f7 },
        { label: '灵感', z: 80, color: 0x22d3ee },
        { label: '文献', z: 250, color: 0xf472b6 },
      ].forEach((track) => {
        addGuideLine(new THREE.Vector3(-half, -18, track.z), new THREE.Vector3(half, -18, track.z), track.color, 0.11);
        addGuideText(track.label, new THREE.Vector3(-half - 110, 14, track.z), 'rgba(255,255,255,0.42)', 42);
      });
    }

    function buildTaskFlowGuides(): void {
      addGuideLine(new THREE.Vector3(0, -16, -880), new THREE.Vector3(0, -16, 880), 0xff4466, 0.2);
      addGuideLine(new THREE.Vector3(-310, -16, -880), new THREE.Vector3(-310, -16, 880), 0xf472b6, 0.1);
      addGuideLine(new THREE.Vector3(310, -16, -880), new THREE.Vector3(310, -16, 880), 0x22d3ee, 0.1);
      addGuideText('主线', new THREE.Vector3(0, 28, -940), 'rgba(255,255,255,0.46)', 44);
      addGuideText('资料 / 灵感旁支', new THREE.Vector3(-310, 28, -940), 'rgba(255,255,255,0.36)', 42);
      addGuideText('概念旁支', new THREE.Vector3(310, 28, -940), 'rgba(255,255,255,0.36)', 42);
    }

    function buildLayeredGuides(): void {
      [
        { label: '永久知识 / 结论', y: 60, color: 0xa855f7 },
        { label: '灵感草稿 / 待打磨', y: -90, color: 0x22d3ee },
        { label: '文献 / 原始资料', y: -240, color: 0xf472b6 },
      ].forEach((layer) => {
        addGuideLine(new THREE.Vector3(-900, layer.y, 80), new THREE.Vector3(900, layer.y, 80), layer.color, 0.14);
        addGuideText(layer.label, new THREE.Vector3(-980, layer.y, 80), 'rgba(255,255,255,0.42)', 44);
      });
    }

    function applyLayoutGuides(mode: GraphLayoutMode): void {
      clearLayoutGuides();
      if (mode === 'matrix') buildMatrixGuides();
      else if (mode === 'evidence') buildEvidenceGuides();
      else if (mode === 'mastery') buildMasteryGuides();
      else if (mode === 'timeline') buildTimelineGuides();
      else if (mode === 'task-flow') buildTaskFlowGuides();
      else if (mode === 'layered') buildLayeredGuides();
    }

    function getLearningStatusForNode(node: THREE.Group): string | undefined {
      return learningPath.steps.find((step) => step.node === node)?.status;
    }

    function getLearningMasteryForNode(node: THREE.Group): number | undefined {
      const mastery = learningPath.steps.find((step) => step.node === node)?.mastery;
      return typeof mastery === 'number' && Number.isFinite(mastery) ? mastery : undefined;
    }

    function getInitialCommunityLabel(node: THREE.Group, index: number): string {
      const tags = Array.isArray(node.userData.tags) ? node.userData.tags as string[] : [];
      if (tags.length > 0) return `tag:${tags[0]}`;
      if (node.userData.clusterId !== undefined && node.userData.clusterId !== null) return `cluster:${node.userData.clusterId}`;
      const type = String(node.userData.type || 'node');
      return `${type}:${node.userData.id || index}`;
    }

    function computeSemanticCommunityTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const cardNodes = allNodes.filter((node) => node.userData.id && !node.userData.isSun && !node.userData.isRoot && node.visible !== false);
      const root = getCoreNode();
      if (root) targets.set(root, new THREE.Vector3(0, 0, 0));
      if (cardNodes.length === 0) {
        allNodes.forEach((node) => {
          const initialPosition = getInitialGalaxyPosition(node);
          targets.set(node, initialPosition ? initialPosition.clone() : node.position.clone());
        });
        return targets;
      }

      const labels = new Map<THREE.Group, string>();
      cardNodes.forEach((node, index) => labels.set(node, getInitialCommunityLabel(node, index)));

      for (let iteration = 0; iteration < 5; iteration++) {
        cardNodes.forEach((node) => {
          const scores = new Map<string, number>();
          const currentLabel = labels.get(node) || String(node.userData.id);
          scores.set(currentLabel, 0.42);

          allLinks.forEach((link) => {
            if (!link.userData.semantic) return;
            const source = link.userData.source as THREE.Group | undefined;
            const target = link.userData.target as THREE.Group | undefined;
            if (!source || !target) return;
            const other = source === node ? target : target === node ? source : null;
            if (!other || other.userData.isSun || other.visible === false) return;
            const label = labels.get(other);
            if (!label) return;
            const weight = Math.max(0.2, Number(link.userData.edgeWeight) || 1);
            const edgeType = String(link.userData.edgeType || '');
            const typeBoost = edgeType === 'prerequisite' || edgeType === 'derived' ? 0.24 : edgeType === 'wikilink' ? 0.16 : 0.1;
            scores.set(label, (scores.get(label) || 0) + Math.log1p(weight) * 0.32 + typeBoost);
          });

          const tags = Array.isArray(node.userData.tags) ? node.userData.tags as string[] : [];
          tags.slice(0, 2).forEach((tag) => {
            scores.set(`tag:${tag}`, (scores.get(`tag:${tag}`) || 0) + 0.24);
          });

          let bestLabel = currentLabel;
          let bestScore = scores.get(currentLabel) || 0;
          scores.forEach((score, label) => {
            if (score > bestScore) {
              bestScore = score;
              bestLabel = label;
            }
          });
          if (bestScore > 0.58) labels.set(node, bestLabel);
        });
      }

      const groups = new Map<string, THREE.Group[]>();
      cardNodes.forEach((node) => {
        const label = labels.get(node) || String(node.userData.id);
        groups.set(label, [...(groups.get(label) || []), node]);
      });
      const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);

      sortedGroups.forEach(([label, members], index) => {
        const phi = Math.acos(1 - (2 * (index + 0.5)) / Math.max(sortedGroups.length, 1));
        const theta = Math.PI * (1 + Math.sqrt(5)) * index;
        const labelSeed = hashId(label);
        const distance = 420 + Math.min(320, Math.sqrt(members.length) * 58) + seededRandom(labelSeed) * 110;
        const anchor = new THREE.Vector3(
          distance * Math.sin(phi) * Math.cos(theta),
          distance * Math.cos(phi) * 1.05,
          distance * Math.sin(phi) * Math.sin(theta),
        );
        const radius = 84 + Math.min(360, Math.sqrt(members.length) * 34);
        const sortedMembers = [...members].sort((a, b) => (Number(b.userData.graphWeight) || 0) - (Number(a.userData.graphWeight) || 0));

        sortedMembers.forEach((node, memberIndex) => {
          const seed = hashId(String(node.userData.id || memberIndex));
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));
          const ratio = (memberIndex + 0.5) / Math.max(1, sortedMembers.length);
          const angle = memberIndex * goldenAngle + seededRandom(seed) * 0.75;
          const r = radius * Math.sqrt(ratio) + (seededRandom(seed + 1) - 0.5) * 22;
          const semanticTarget = new THREE.Vector3(
            anchor.x + Math.cos(angle) * r,
            anchor.y + ((seededRandom(seed + 2) * 2 - 1) * 0.48 + Math.sin(angle * 1.25) * 0.18) * r,
            anchor.z + Math.sin(angle) * r * 0.72,
          );
          const initialPosition = getInitialGalaxyPosition(node);
          targets.set(node, initialPosition ? semanticTarget.lerp(initialPosition, 0.28) : semanticTarget);
        });
      });

      clusterSuns.forEach((sun, clusterId) => {
        const children = clusterNodes.get(clusterId) || [];
        const childTargets = children.map((node) => targets.get(node)).filter((target): target is THREE.Vector3 => !!target);
        if (childTargets.length === 0) return;
        const center = childTargets.reduce((acc, target) => acc.add(target), new THREE.Vector3()).multiplyScalar(1 / childTargets.length);
        targets.set(sun, center);
      });

      allNodes.forEach((node) => {
        if (!targets.has(node)) {
              const initialPosition = getInitialGalaxyPosition(node);
              targets.set(node, initialPosition ? initialPosition.clone() : node.position.clone());
        }
      });

      return targets;
    }

    function computeGalaxyTargets(): Map<THREE.Group, THREE.Vector3> {
      rebuildGalaxyForceAnchors();
      return cloneGalaxyForceAnchors();
    }

    function computeFlatMapTargets(): Map<THREE.Group, THREE.Vector3> {
      const graphNodes = allNodes.filter(node => node.visible !== false);
      const positions = new Map<THREE.Group, THREE.Vector2>();
      const velocities = new Map<THREE.Group, THREE.Vector2>();
      const core = getCoreNode();

      graphNodes.forEach((node, index) => {
        const seed = hashId(String(node.userData.id || node.userData.name || index));
        const stored = node.userData.position3D as THREE.Vector3 | undefined;
        const angle = seededRandom(seed) * Math.PI * 2;
        const radius = stored ? Math.max(120, Math.min(720, Math.sqrt(stored.x ** 2 + stored.z ** 2) * 0.78)) : 260 + seededRandom(seed + 1) * 420;
        positions.set(node, node === core
          ? new THREE.Vector2(0, 0)
          : new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius)
        );
        velocities.set(node, new THREE.Vector2(0, 0));
      });

      const iterations = graphNodes.length > 160 ? 48 : 78;
      for (let step = 0; step < iterations; step++) {
        for (let i = 0; i < graphNodes.length; i++) {
          const a = graphNodes[i];
          const pa = positions.get(a)!;
          const va = velocities.get(a)!;
          for (let j = i + 1; j < graphNodes.length; j++) {
            const b = graphNodes[j];
            const pb = positions.get(b)!;
            const delta = new THREE.Vector2().subVectors(pa, pb);
            const distSq = Math.max(80, delta.lengthSq());
            const force = Math.min(18, 36000 / distSq);
            delta.normalize().multiplyScalar(force);
            va.add(delta);
            velocities.get(b)!.sub(delta);
          }
        }

        allLinks.forEach((link) => {
          const source = link.userData.source as THREE.Group | undefined;
          const target = link.userData.target as THREE.Group | undefined;
          if (!source || !target || !positions.has(source) || !positions.has(target)) return;
          const ps = positions.get(source)!;
          const pt = positions.get(target)!;
          const delta = new THREE.Vector2().subVectors(pt, ps);
          const dist = Math.max(1, delta.length());
          const desired = link.userData.semantic ? 142 : link.userData.isInternal ? 118 : 220;
          const strength = link.userData.semantic ? 0.026 : 0.012;
          const pull = delta.multiplyScalar(((dist - desired) / dist) * strength);
          velocities.get(source)!.add(pull);
          velocities.get(target)!.sub(pull);
        });

        graphNodes.forEach((node) => {
          const pos = positions.get(node)!;
          const vel = velocities.get(node)!;
          if (node === core) {
            pos.set(0, 0);
            vel.set(0, 0);
            return;
          }
          vel.add(pos.clone().multiplyScalar(-0.003));
          pos.add(vel.multiplyScalar(0.34));
          vel.multiplyScalar(0.62);
        });
      }

      const targets = new Map<THREE.Group, THREE.Vector3>();
      allNodes.forEach((node) => {
        const pos = positions.get(node);
        if (pos) targets.set(node, new THREE.Vector3(pos.x, 0, pos.y));
        else targets.set(node, node.position.clone().setY(0));
      });
      return targets;
    }

    function computeRadialTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const core = getCoreNode();
      if (core) targets.set(core, new THREE.Vector3(0, 0, 0));

      const suns = Array.from(clusterSuns.entries()).sort((a, b) => a[0] - b[0]);
      const ringRadius = Math.max(380, Math.min(760, suns.length * 92));
      const occupied = new Set<THREE.Group>();
      if (core) occupied.add(core);

      suns.forEach(([clusterId, sun], index) => {
        const centerAngle = (index / Math.max(1, suns.length)) * Math.PI * 2 - Math.PI / 2;
        const center = new THREE.Vector3(Math.cos(centerAngle) * 260, 0, Math.sin(centerAngle) * 260);
        targets.set(sun, center);
        occupied.add(sun);

        const children = clusterNodes.get(clusterId) || [];
        const sortedChildren = sortedByGraphSemantics(children);
        const arc = Math.min(Math.PI * 1.45, (Math.PI * 2 / Math.max(1, suns.length)) * 0.82);
        sortedChildren.forEach((node, childIndex) => {
          const seed = hashId(String(node.userData.id || node.userData.name || childIndex));
          const radius = 455 + (childIndex % 3) * 72 + seededRandom(seed) * 16;
          const theta = centerAngle - arc / 2 + (childIndex / Math.max(1, sortedChildren.length - 1)) * arc;
          targets.set(node, new THREE.Vector3(
            Math.cos(theta) * radius,
            0,
            Math.sin(theta) * radius,
          ));
          occupied.add(node);
        });
      });

      const looseNodes = allNodes.filter(node => !occupied.has(node) && !node.userData.isSun && node.userData.id);
      const looseRadius = Math.max(640, ringRadius + 285);
      looseNodes.forEach((node, index) => {
        const seed = hashId(String(node.userData.id || index));
        const angle = (index / Math.max(1, looseNodes.length)) * Math.PI * 2 + seededRandom(seed) * 0.2;
        const radius = looseRadius + (seededRandom(seed + 1) - 0.5) * 110;
        targets.set(node, new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
      });

      return targets;
    }

    function computeConcentricTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const centerNode = concentricCenterNode || lockedNode || pressedNode || hoveredNode || getCoreNode() || allNodes[0];
      if (!centerNode) return targets;

      const layers = new Map<number, THREE.Group[]>();
      const seen = new Set<THREE.Group>([centerNode]);
      let frontier = [centerNode];
      targets.set(centerNode, new THREE.Vector3(0, 0, 0));

      for (let depth = 1; depth <= 3; depth++) {
        const next: THREE.Group[] = [];
        frontier.forEach((node) => {
          getGraphNeighbors(node).forEach((neighbor) => {
            if (seen.has(neighbor)) return;
            seen.add(neighbor);
            next.push(neighbor);
          });
        });
        layers.set(depth, sortedByGraphSemantics(next));
        frontier = next;
      }

      const outside = sortedByGraphSemantics(allNodes.filter(node => !seen.has(node)));
      if (outside.length > 0) layers.set(4, outside);

      layers.forEach((nodesInLayer, depth) => {
        const radius = depth * 205;
        nodesInLayer.forEach((node, index) => {
          const seed = hashId(String(node.userData.id || node.userData.name || index));
          const angle = (index / Math.max(1, nodesInLayer.length)) * Math.PI * 2 + seededRandom(seed) * 0.16;
          targets.set(node, new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
        });
      });
      return targets;
    }

    function computeLayeredTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const core = getCoreNode();
      if (core) targets.set(core, new THREE.Vector3(0, 340, -360));

      const suns = Array.from(clusterSuns.entries()).sort((a, b) => a[0] - b[0]);
      const clusterWidth = 260;
      suns.forEach(([clusterId, sun], index) => {
        const baseX = (index - (suns.length - 1) / 2) * clusterWidth;
        targets.set(sun, new THREE.Vector3(baseX, 210, -180));
        const children = clusterNodes.get(clusterId) || [];
        const byType = new Map<string, THREE.Group[]>();
        children.forEach((node) => {
          const type = String(node.userData.type || 'other');
          byType.set(type, [...(byType.get(type) || []), node]);
        });
        Array.from(byType.entries()).forEach(([type, nodesOfType]) => {
          const y = type === 'permanent' ? 60 : type === 'fleeting' ? -90 : type === 'literature' ? -240 : -150;
          placeMiniGrid(targets, nodesOfType, new THREE.Vector3(baseX, y, 80), 48, 3);
        });
      });

      const placed = new Set(targets.keys());
      const loose = allNodes.filter(node => !placed.has(node));
      placeMiniGrid(targets, loose, new THREE.Vector3(0, -310, 360), 54, 6);
      return targets;
    }

    function computeMatrixTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const cells = new Map<string, THREE.Group[]>();
      const typeRows: Record<string, number> = {
        sun: -330,
        permanent: -110,
        fleeting: 110,
        literature: 330,
        other: 520,
      };
      const bandHeights: Record<string, number> = {
        high: 110,
        mid: 48,
        low: 0,
      };
      allNodes.forEach((node) => {
        const cluster = getClusterSlot(node);
        const type = node.userData.isSun ? 'sun' : String(node.userData.type || 'other');
        const degree = getNodeDegree(node);
        const band = degree >= 4 ? 'high' : degree >= 2 ? 'mid' : 'low';
        const key = `${cluster}:${type}:${band}`;
        cells.set(key, [...(cells.get(key) || []), node]);
      });

      const totalClusters = Math.max(1, clusterSuns.size + 1);
      cells.forEach((cellNodes, key) => {
        const [clusterRaw, type, band] = key.split(':');
        const cluster = Number(clusterRaw);
        const x = (cluster - (totalClusters - 1) / 2) * 250;
        const z = typeRows[type] ?? typeRows.other;
        const y = bandHeights[band] ?? 0;
        placeMiniGrid(targets, cellNodes, new THREE.Vector3(x, y, z), 36, 3);
      });
      return targets;
    }

    function computeTaskFlowTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const core = getCoreNode();
      if (core) targets.set(core, new THREE.Vector3(-560, 0, 0));

      const pathNodes = learningPath.steps
        .sort((a, b) => a.stepIndex - b.stepIndex)
        .map(step => step.node)
        .filter((node, index, arr) => arr.indexOf(node) === index);
      const fallbackQueue = sortedByGraphSemantics(allNodes.filter(node => node.userData.id && !node.userData.isSun));
      const queue = pathNodes.length > 0 ? pathNodes : fallbackQueue.slice(0, Math.min(24, fallbackQueue.length));
      const queueSet = new Set(queue);

      queue.forEach((node, index) => {
        const z = (index - (queue.length - 1) / 2) * 86;
        targets.set(node, new THREE.Vector3(0, 0, z));
      });

      const suns = Array.from(clusterSuns.values());
      suns.forEach((sun, index) => {
        targets.set(sun, new THREE.Vector3(-300, 0, (index - (suns.length - 1) / 2) * 118));
      });

      const sideSlots = new Map<string, number>();
      allNodes.filter(node => !targets.has(node)).forEach((node) => {
        const relatedQueueIndex = queue.findIndex(q => getGraphNeighbors(q).has(node));
        const row = relatedQueueIndex >= 0 ? relatedQueueIndex : queue.length + sideSlots.size;
        const side = String(node.userData.type || '') === 'literature' || String(node.userData.type || '') === 'fleeting' ? -1 : 1;
        const slotKey = `${row}:${side}`;
        const offset = sideSlots.get(slotKey) ?? 0;
        sideSlots.set(slotKey, offset + 1);
        targets.set(node, new THREE.Vector3(side * 310, 0, (row - (queue.length - 1) / 2) * 86 + (offset % 3) * 22));
      });

      queueSet.forEach((node) => {
        if (!targets.has(node)) targets.set(node, new THREE.Vector3(0, 0, 0));
      });
      return targets;
    }

    function computeTimelineTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const readTime = (node: THREE.Group): number => {
        const raw = node.userData.createdAt || node.userData.updatedAt;
        if (!raw) return Number.POSITIVE_INFINITY;
        const time = new Date(String(raw)).getTime();
        return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
      };
      const ordered = sortedByGraphSemantics(allNodes)
        .sort((a, b) => {
          const timeDiff = readTime(a) - readTime(b);
          if (timeDiff !== 0) return timeDiff;
          return String(a.userData.name || '').localeCompare(String(b.userData.name || ''));
        });
      ordered.forEach((node, index) => {
        const x = (index - (ordered.length - 1) / 2) * 78;
        const type = String(node.userData.type || '');
        const z = node.userData.isSun ? -260 : type === 'permanent' ? -90 : type === 'fleeting' ? 80 : type === 'literature' ? 250 : 0;
        targets.set(node, new THREE.Vector3(x, 0, z));
      });
      return targets;
    }

    function computeMasteryTargets(): Map<THREE.Group, THREE.Vector3> {
      const base = computeFlatMapTargets();
      const targets = new Map<THREE.Group, THREE.Vector3>();
      allNodes.forEach((node) => {
        const status = getLearningStatusForNode(node);
        const mastery = getLearningMasteryForNode(node);
        const type = String(node.userData.type || '');
        let score = node.userData.isSun ? 0.68 : !node.userData.id ? 0.9 : type === 'permanent' ? 0.72 : type === 'literature' ? 0.52 : type === 'fleeting' ? 0.34 : 0.45;
        if (mastery !== undefined) score = THREE.MathUtils.clamp(mastery / 100, 0.08, 1);
        else if (status === 'mastered') score = 1;
        else if (status === 'completed') score = 0.86;
        else if (status === 'learning') score = 0.58;
        else if (status === 'available') score = 0.42;
        else if (status === 'locked') score = 0.14;
        score = Math.min(1, score + Math.min(0.14, getNodeDegree(node) * 0.025));
        const pos = base.get(node) || node.position.clone();
        targets.set(node, new THREE.Vector3(pos.x, -170 + score * 430, pos.z));
      });
      return targets;
    }

    function computeEvidenceTargets(): Map<THREE.Group, THREE.Vector3> {
      const targets = new Map<THREE.Group, THREE.Vector3>();
      const core = getCoreNode();
      if (core) targets.set(core, new THREE.Vector3(0, 330, -300));
      const suns = Array.from(clusterSuns.entries()).sort((a, b) => a[0] - b[0]);
      const radius = Math.max(300, suns.length * 70);
      suns.forEach(([clusterId, sun], index) => {
        const angle = (index / Math.max(1, suns.length)) * Math.PI * 2 - Math.PI / 2;
        const base = new THREE.Vector3(Math.cos(angle) * radius, 170, Math.sin(angle) * radius);
        targets.set(sun, base);
        const children = clusterNodes.get(clusterId) || [];
        const evidence = children.filter(n => String(n.userData.type || '') === 'literature');
        const concepts = children.filter(n => String(n.userData.type || '') === 'permanent');
        const fleeting = children.filter(n => String(n.userData.type || '') === 'fleeting');
        placeMiniGrid(targets, concepts, base.clone().setY(50), 44, 3);
        placeMiniGrid(targets, fleeting, base.clone().setY(-90), 44, 3);
        placeMiniGrid(targets, evidence, base.clone().setY(-240), 44, 3);
      });
      const placed = new Set(targets.keys());
      placeMiniGrid(targets, allNodes.filter(node => !placed.has(node)), new THREE.Vector3(0, -300, 320), 46, 6);
      return targets;
    }

    function computeLayoutTargets(mode: GraphLayoutMode): Map<THREE.Group, THREE.Vector3> {
      if (mode === 'galaxy') return computeGalaxyTargets();
      if (mode === 'flat') return computeFlatMapTargets();
      if (mode === 'radial') return computeRadialTargets();
      if (mode === 'concentric') return computeConcentricTargets();
      if (mode === 'layered') return computeLayeredTargets();
      if (mode === 'matrix') return computeMatrixTargets();
      if (mode === 'task-flow') return computeTaskFlowTargets();
      if (mode === 'timeline') return computeTimelineTargets();
      if (mode === 'mastery') return computeMasteryTargets();
      return computeEvidenceTargets();
    }

    function animateNodesTo(targets: Map<THREE.Group, THREE.Vector3>, duration: number, onComplete?: () => void): void {
      layoutAnimating = true;
      if (layoutTween) {
        layoutTween.kill();
        layoutTween = null;
      }
      gsap.killTweensOf(allNodes.map(node => node.position));
      const entries = Array.from(targets.entries()).map(([node, target]) => ({
        node,
        from: node.position.clone(),
        target: target.clone(),
      }));
      const state = { progress: duration <= 0 ? 1 : 0 };

      const applyProgress = () => {
        entries.forEach(({ node, from, target }) => {
          node.position.lerpVectors(from, target, state.progress);
        });
        refreshLinkGeometry();
      };

      if (duration <= 0 || entries.length === 0) {
        applyProgress();
        layoutAnimating = false;
        onComplete?.();
        return;
      }

      layoutTween = gsap.to(state, {
        progress: 1,
        duration,
        ease: 'expo.inOut',
        onUpdate: applyProgress,
        onComplete: () => {
          state.progress = 1;
          applyProgress();
          layoutAnimating = false;
          layoutTween = null;
          onComplete?.();
        },
      });
    }

    function applyLayoutLinkVisibility(mode: GraphLayoutMode): void {
      const galaxyOverview = mode === 'galaxy';
      const evidenceMode = mode === 'evidence';
      allLinks.forEach((link) => {
        if (link.userData._filtered) return;
        if (link.userData.flowMesh) link.userData.flowMesh.visible = false;
        if (galaxyOverview && link.userData.isInternal) {
          setLinkOpacity(link, 0, 0.24);
          return;
        }
        const mat = link.material as THREE.LineBasicMaterial;
        mat.color.set(getEdgeTypeColor(link.userData.edgeType, link.userData.trueColor || link.userData.clusterColor || 0xffffff));
        const opacity = galaxyOverview
          ? getGalaxyOverviewLinkOpacity(link)
          : evidenceMode
            ? link.userData.semantic
              ? 0.52
              : link.userData.isInternal
                ? 0.035
                : 0.07
            : link.userData.semantic
              ? 0.34
              : link.userData.isInternal
                ? 0.12
                : 0.18;
        setLinkOpacity(link, opacity, 0.45);
      });
    }

    function syncGraphGroupRotation(): void {
      if (!nodesGroup || !linksGroup) return;
      linksGroup.rotation.copy(nodesGroup.rotation);
      learningPath.group.rotation.copy(nodesGroup.rotation);
    }

    function resetGraphGroupRotation(duration = 0.45): void {
      if (!nodesGroup || !linksGroup) return;
      gsap.killTweensOf(nodesGroup.rotation);
      if (duration <= 0) {
        nodesGroup.rotation.set(0, 0, 0);
        syncGraphGroupRotation();
        return;
      }
      gsap.to(nodesGroup.rotation, {
        x: 0,
        y: 0,
        z: 0,
        duration,
        ease: 'power2.out',
        onUpdate: syncGraphGroupRotation,
      });
    }

    function applyLayoutMotion(mode: GraphLayoutMode): void {
      centerSpinActive = CENTER_SPIN_LAYOUT_MODES.has(mode) && centerSpinEnabled;
      if (!centerSpinActive) resetGraphGroupRotation(0.45);
    }

    function applyAtmosphereForLayout(mode: GraphLayoutMode): void {
      if (milkyWay) milkyWay.visible = true;
      setGalaxyLocalRingsVisible(mode !== 'galaxy');
      if (galaxyBoundaryGroup) {
        galaxyBoundaryGroup.visible = mode === 'galaxy';
        if (mode === 'galaxy' && galaxyBoundaryGroup.children.length === 0) rebuildGalaxyBoundaryRings();
      }
    }

    function configureControlsForLayout(mode: GraphLayoutMode): void {
      if (mode === 'galaxy') {
        exitFlatInteractionMode();
        if (autoRotateBeforeLayout !== null) {
          controls.autoRotate = autoRotateBeforeLayout;
          autoRotateBeforeLayout = null;
        }
        controls.enablePan = true;
        controls.enableRotate = true;
        return;
      }
      if (autoRotateBeforeLayout === null) autoRotateBeforeLayout = controls.autoRotate;
      if (PAN_ONLY_LAYOUT_MODES.has(mode) || CENTER_SPIN_LAYOUT_MODES.has(mode)) {
        enterFlatInteractionMode();
        return;
      }
      exitFlatInteractionMode();
      controls.enablePan = true;
      controls.enableRotate = true;
      controls.autoRotate = false;
      if (STRUCTURED_LAYOUT_MODES.has(mode)) controls.maxDistance = 2600;
    }

    function frameLayoutCamera(_mode: GraphLayoutMode, duration = 0.95): void {
      gsap.killTweensOf(controls.target);
      gsap.killTweensOf(camera.position);
      gsap.to(controls.target, {
        x: DEFAULT_CONTROLS_TARGET.x,
        y: DEFAULT_CONTROLS_TARGET.y,
        z: DEFAULT_CONTROLS_TARGET.z,
        duration,
        ease: 'expo.inOut',
      });
      gsap.to(camera.position, {
        x: DEFAULT_CAMERA_POSITION.x,
        y: DEFAULT_CAMERA_POSITION.y,
        z: DEFAULT_CAMERA_POSITION.z,
        duration,
        ease: 'expo.inOut',
      });
    }

    function applyGraphLayout(mode: GraphLayoutMode, duration = 0.95): void {
      capture3DPositions();
      layoutMode = mode;
      if (mode !== 'galaxy') coolGalaxyForce();
      useAppStore.getState().setGraphLayoutMode(mode);
      const resetBtn = document.getElementById('reset-view-btn');
      if (resetBtn) resetBtn.classList.toggle('visible', mode !== DEFAULT_GRAPH_LAYOUT_MODE);
      const previousFocusNode = lockedNode || pressedNode || hoveredNode;
      if (mode === 'concentric' && !concentricCenterNode) {
        concentricCenterNode = previousFocusNode;
      }
      if (mode !== 'concentric') concentricCenterNode = null;
      lockedNode = null;
      pressedNode = null;
      hoveredNode = null;
      lastFocusSelection = [];
      applyGraphAttention(null);
      clearNodeLabels();
      configureControlsForLayout(mode);
      applyLayoutMotion(mode);
      applyAtmosphereForLayout(mode);
      applyLayoutGuides(mode);
      if (mode === 'galaxy') rebuildGalaxyBoundaryRings();
      applyLayoutLinkVisibility(mode);
      // Snap nodes directly to galaxy anchors before tween+force
      if (mode === 'galaxy') {
        rebuildGalaxyForceAnchors();
        allNodes.forEach((node) => {
          const anchor = galaxyForceAnchors.get(node);
          if (anchor) node.position.copy(anchor);
        });
        refreshLinkGeometry();
      }
      animateNodesTo(computeLayoutTargets(mode), duration);
      if (mode === 'galaxy') reheatGalaxyForce(0.55, 200);
      refreshLinksAndLabels();
      frameLayoutCamera(mode, duration);
    }

    function resetCameraView(): void {
      const mode = layoutMode;
      setResetButtonVisible(mode !== DEFAULT_GRAPH_LAYOUT_MODE);
      if (autoRotateBeforeFocus !== null) {
        controls.autoRotate = autoRotateBeforeFocus;
        autoRotateBeforeFocus = null;
      }
      useAppStore.getState().setGraphLayoutMode(mode);
      concentricCenterNode = null;
      if (autoRotateBeforeLayout !== null) {
        controls.autoRotate = autoRotateBeforeLayout;
        autoRotateBeforeLayout = null;
      }
      lockedNode = null;
      pressedNode = null;
      hoveredNode = null;
      currentClusterId = null;
      lastFocusSelection = [];
      clearNodeLabels();
      restoreNodeVisibilityFromFilters();
      configureControlsForLayout(mode);
      applyLayoutMotion(mode);
      applyAtmosphereForLayout(mode);
      applyLayoutGuides(mode);

      if (mode === 'galaxy') {
        semanticClusterLensEnabled = false;
        useAppStore.getState().setGraphSemanticClusterLens(false);
        if (layoutTween) {
          layoutTween.kill();
          layoutTween = null;
        }
        gsap.killTweensOf(allNodes.map(node => node.position));
        layoutAnimating = false;
        const targets = restoreInitialGalaxyAnchors();
        targets.forEach((target, node) => {
          node.position.copy(target);
        });
        refreshLinkGeometry();
        rebuildGalaxyBoundaryRings();
        applyGraphAttention(null);
        refreshLinksAndLabels();
        frameLayoutCamera(mode, 1.2);
        return;
      }

      const targets = computeLayoutTargets(mode);
      animateNodesTo(targets, 0.85);
      applyGraphAttention(null);
      refreshLinksAndLabels();
      frameLayoutCamera(mode, 0.85);
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
      if (CENTER_SPIN_LAYOUT_MODES.has(layoutMode)) {
        centerSpinEnabled = on;
        centerSpinActive = on;
        if (flatInteractionSnapshot) flatInteractionSnapshot.autoRotate = false;
        return;
      }
      if (PAN_ONLY_LAYOUT_MODES.has(layoutMode)) {
        if (flatInteractionSnapshot) flatInteractionSnapshot.autoRotate = false;
        if (autoRotateBeforeLayout !== null) autoRotateBeforeLayout = on;
        return;
      }
      if (layoutMode !== 'galaxy') {
        controls.autoRotate = false;
        return;
      }
      controls.autoRotate = on;
      if (autoRotateBeforeLayout !== null) autoRotateBeforeLayout = on;
      if (autoRotateBeforeFocus !== null) autoRotateBeforeFocus = on;
    });
    register('getAutoRotate', () => {
      if (CENTER_SPIN_LAYOUT_MODES.has(layoutMode)) return centerSpinEnabled;
      if (layoutMode !== 'galaxy') return false;
      return controls.autoRotate;
    });
    register('setRotateSpeed', (s: number) => { controls.autoRotateSpeed = s; });
    register('getRotateSpeed', () => controls.autoRotateSpeed);
    register('setBloom', (v: number) => { if (bloomPass) bloomPass.strength = v; });
    register('getBloom', () => bloomPass?.strength ?? 1.4);
    register('setMilkyWay', () => { if (milkyWay) milkyWay.visible = true; });
    register('getMilkyWay', () => true);
    register('setLayoutMode', (mode: GraphLayoutMode) => {
      applyGraphLayout(mode);
    });
    register('getLayoutMode', () => layoutMode);
    register('setProjectionMode', (mode: '3d' | '2d') => {
      applyGraphLayout(mode === '2d' ? 'flat' : 'galaxy');
    });
    register('getProjectionMode', () => PLANAR_GEOMETRY_MODES.has(layoutMode) ? '2d' : '3d');
    register('setHoverAttention', (v: boolean) => {
      hoverAttentionEnabled = v;
      if (!v) {
        hoveredNode = null;
        clearHoverPreview();
        if (lockedNode) applyGraphAttention(lockedNode, true);
        else applyGraphAttention(null);
      }
    });
    register('getHoverAttention', () => hoverAttentionEnabled);
    register('setSemanticClusterLens', (enabled: boolean) => {
      semanticClusterLensEnabled = !!enabled;
      if (layoutMode === 'galaxy') {
        const targets = computeGalaxyTargets();
        animateNodesTo(targets, 0.85);
        reheatGalaxyForce(0.48, 125);
        requestAnimationFrame(() => {
          refreshLinkGeometry();
          rebuildGalaxyBoundaryRings();
          if (lockedNode) applyGraphAttention(lockedNode, true);
          else applyGraphAttention(null);
        });
      }
    });
    register('getSemanticClusterLens', () => semanticClusterLensEnabled);
    register('setForceMotion', (enabled: boolean) => {
      galaxyForceEnabled = !!enabled;
      if (!galaxyForceEnabled) {
        coolGalaxyForce();
        return;
      }
      if (layoutMode === 'galaxy') {
        rebuildGalaxyForceAnchors();
        reheatGalaxyForce(0.5, 130);
      }
    });
    register('getForceMotion', () => galaxyForceEnabled);
    register('fitSelection', () => {
      const selection = lastFocusSelection.filter(n => n.visible !== false);
      if (selection.length > 0) frameSelection(selection, selection[0], 0.9);
    });
    const refreshLinksAndLabels = () => {
      invalidateGalaxyForceCache();
      // Memory-based: save original visibility before hiding, restore when unhiding
      allLinks.forEach(l => {
        const s = l.userData.source as THREE.Group;
        const t = l.userData.target as THREE.Group;
        if (!s.visible || !t.visible) {
          // Link should be hidden by filter — save its current state first
          if (!l.userData._filtered) {
            l.userData._filtered = true;
            l.userData._wasVisible = l.userData.targetVisible ?? l.visible;
          }
          if (l.userData.flowMesh) l.userData.flowMesh.visible = false;
          l.visible = false;
        } else if (l.userData._filtered) {
          // Both endpoints visible again — restore previous visibility
          l.userData._filtered = false;
          if (l.userData._wasVisible !== undefined && l.userData._wasVisible) {
            const targetOpacity = typeof l.userData.targetOpacity === 'number'
              ? l.userData.targetOpacity
              : (l.material as THREE.LineBasicMaterial).opacity;
            setLinkOpacity(l, targetOpacity, 0.16);
          } else {
            l.visible = false;
          }
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
      resetCameraView();
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
    camera.position.copy(DEFAULT_CAMERA_POSITION);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(getTargetRendererPixelRatio());
    currentRendererPixelRatio = getTargetRendererPixelRatio();
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
    applyRendererPerformanceBudget();

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
    controls.target.copy(DEFAULT_CONTROLS_TARGET);
    layoutMode = DEFAULT_GRAPH_LAYOUT_MODE;
    useAppStore.getState().setGraphLayoutMode(DEFAULT_GRAPH_LAYOUT_MODE);
    applyNodeModeVisual(useAppStore.getState().mode, true);
    const unsubscribeModeVisual = useAppStore.subscribe((state, prevState) => {
      if (state.mode !== prevState.mode) {
        applyNodeModeVisual(state.mode);
        // Restore controls target for modes with left panel
        if (state.mode === 'dashboard' || state.mode === 'galaxy') {
          gsap.to(controls.target, {
            x: DEFAULT_CONTROLS_TARGET.x,
            y: DEFAULT_CONTROLS_TARGET.y,
            z: DEFAULT_CONTROLS_TARGET.z,
            duration: 0.6,
            ease: 'expo.inOut',
          });
        }
        // Clear locked node when leaving galaxy/dashboard to prevent force simulation starvation
        if (state.mode === 'forge' || state.mode === 'cognition' || state.mode === 'learn') {
          lockedNode = null;
          applyGraphAttention(null);
        }
        requestAnimationFrame(() => {
          if (lockedNode) applyGraphAttention(lockedNode, true);
          else if (hoverAttentionEnabled && hoveredNode) applyHoverPreview(hoveredNode);
        });
      }
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

    applyAtmosphereForLayout(layoutMode);

    // --- Node & link groups ---
    nodesGroup = new THREE.Group();
    linksGroup = new THREE.Group();
    layoutGuideGroup = new THREE.Group();
    galaxyBoundaryGroup = new THREE.Group();
    scene.add(nodesGroup);
    scene.add(linksGroup);
    scene.add(galaxyBoundaryGroup);
    scene.add(layoutGuideGroup);
    applyLayoutMotion(layoutMode);
    applyLayoutGuides(layoutMode);
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
      nodeRaycastTargets.length = 0;
      Object.keys(typeVisible).forEach(k => delete typeVisible[k]);
      adjMap.clear();
      clusterNodes.clear();
      clusterSuns.clear();
      clusterLabelData.length = 0;
      nodeLabelItems.length = 0;
      clearNodeLabels();

      const storeVaults = useAppStore.getState().vaults;
      const vaultName = storeVaults.find(v => v.id === vid)?.name || vid || `CENTRAL_INTELLIGENCE`;
      if (!n.some(node => node.isRoot)) createCore(vaultName);
      createClustersFromData(c, n, e);
      captureInitialGalaxyPositions();

      if (layoutMode !== 'galaxy') {
        coolGalaxyForce();
        configureControlsForLayout(layoutMode);
        applyLayoutMotion(layoutMode);
        applyAtmosphereForLayout(layoutMode);
        applyLayoutGuides(layoutMode);
        const initialLayoutTargets = computeLayoutTargets(layoutMode);
        initialLayoutTargets.forEach((target, node) => {
          node.position.copy(target);
        });
        refreshLinkGeometry();
        frameLayoutCamera(layoutMode, 0);
      }

      clearLearningPath();
      buildDemoLearningPath(dataRef.current.learningPathSteps);
      createLearningPath();
      updateGalaxyPerformanceBudget(allNodes.length, allLinks.length);
      rebuildGalaxyForceAnchors();
      rebuildGalaxyBoundaryRings();
      applyNodeModeVisual(useAppStore.getState().mode, true);
      applyLayoutLinkVisibility(layoutMode);
      reheatGalaxyForce(0.55, 145);
      const appState = useAppStore.getState();
      const selectedNode = appState.mode === 'galaxy' ? appState.selectedNode : null;
      const selectedGroup = selectedNode?.id
        ? allNodes.find((node) => String(node.userData.id || '') === selectedNode.id)
        : null;
      if (selectedGroup) {
        lockedNode = selectedGroup;
        lastFocusSelection = getFocusSelection(selectedGroup);
        setResetButtonVisible(true);
        requestAnimationFrame(() => applyGraphAttention(selectedGroup, true));
      }
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

      const menuWidth = 190;
      const menuHeight = 196;
      const safeX = Math.min(x, window.innerWidth - menuWidth - 12);
      const safeY = Math.min(y, window.innerHeight - menuHeight - 12);
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed',
        `left:${Math.max(12, safeX)}px`,
        `top:${Math.max(12, safeY)}px`,
        'z-index:100',
        'background:linear-gradient(180deg,rgba(16,20,28,0.72),rgba(5,8,14,0.62)),rgba(0,0,0,0.42)',
        'backdrop-filter:blur(20px)',
        'border:1px solid rgba(255,255,255,0.10)',
        'border-radius:16px',
        'padding:6px',
        `min-width:${menuWidth}px`,
        'box-shadow:0 12px 40px rgba(0,0,0,0.6)',
        'font-family:JetBrains Mono, monospace',
        'font-size:11px',
        'color:rgba(255,255,255,0.72)',
      ].join(';');

      const name = (node.userData.name as string) || 'untitled';
      const nodeId = (node.userData.id as string) || '';

      const items: { label: string; action: () => void; danger?: boolean }[] = [
        {
          label: '在工作台预览',
          action: () => {
            focusNode(node);
            openNodeInForgePreview(node);
          },
        },
        {
          label: '复制标题',
          action: () => navigator.clipboard.writeText(name).catch(() => {}),
        },
        {
          label: '复制 [[链接]]',
          action: () => navigator.clipboard.writeText(`[[${name}]]`).catch(() => {}),
        },
        {
          label: '删除卡片',
          action: async () => {
            if (!window.confirm(`确定删除「${name}」？\n此操作不可撤销。`)) return;
            try {
              const res = await client.api.vault.card[':id'].$delete({
                param: { id: nodeId },
                query: { vid: vaultIdRef.current ?? undefined },
              });
              const data = await res.json() as { success?: boolean; error?: string; deletedSessionIds?: string[] };
              if (!res.ok || !data.success) throw new Error(data.error || `删除失败 (${res.status})`);
              if (useAppStore.getState().selectedNode?.id === nodeId) {
                useAppStore.getState().clearSelectedNode();
              }
              window.dispatchEvent(new CustomEvent('axiom:card-deleted', {
                detail: { cardId: nodeId, deletedSessionIds: data.deletedSessionIds ?? [] },
              }));
            } catch (err) {
              window.alert(err instanceof Error ? err.message : '删除卡片失败');
            }
          },
          danger: true,
        },
      ];

      el.innerHTML = [
        `<div style="padding:8px 10px 9px;border-bottom:1px solid rgba(255,255,255,0.07);color:rgba(207,250,254,0.72);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>`,
        ...items.map((item, i) =>
          `<div data-idx="${i}" style="margin-top:4px;padding:8px 10px;border-radius:10px;cursor:pointer;transition:background 0.12s,color 0.12s,border-color 0.12s;color:${item.danger ? 'rgba(252,165,165,0.82)' : 'rgba(255,255,255,0.68)'};border:1px solid transparent;display:flex;align-items:center;gap:6px">${item.label}</div>`
        ),
      ].join('');

      // Hover + click
      el.querySelectorAll('[data-idx]').forEach((btn) => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        btn.addEventListener('mouseenter', () => {
          (btn as HTMLElement).style.background = items[idx]?.danger ? 'rgba(248,113,113,0.08)' : 'rgba(34,211,238,0.075)';
          (btn as HTMLElement).style.borderColor = items[idx]?.danger ? 'rgba(248,113,113,0.18)' : 'rgba(103,232,249,0.16)';
          (btn as HTMLElement).style.color = items[idx]?.danger ? 'rgba(254,202,202,0.94)' : 'rgba(207,250,254,0.92)';
        });
        btn.addEventListener('mouseleave', () => {
          (btn as HTMLElement).style.background = 'transparent';
          (btn as HTMLElement).style.borderColor = 'transparent';
          (btn as HTMLElement).style.color = items[idx]?.danger ? 'rgba(252,165,165,0.82)' : 'rgba(255,255,255,0.68)';
        });
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
      const targets = nodeRaycastTargets.length > 0 ? nodeRaycastTargets : nodesGroup.children;
      const hits = raycaster.intersectObjects(targets, nodeRaycastTargets.length === 0);
      for (const hit of hits) {
        const node = getNodeFromRaycastObject(hit.object);
        if (node && !node.userData.isSun) {
          showContextMenu(node, me.clientX, me.clientY);
          return;
        }
      }
    };
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // Hover attention is user-configurable; when it is disabled, only press and
    // click paths raycast so dense graphs stay responsive.
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDown: { x: number; y: number; node: THREE.Group | null; previousLockedNode: THREE.Group | null } | null = null;
    function setMouseFromEvent(e: MouseEvent): void {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }
    function getNodeFromRaycastObject(object: THREE.Object3D): THREE.Group | null {
      const linkedNode = object.userData.raycastNode as THREE.Group | undefined;
      if (linkedNode?.userData?.name && linkedNode.visible !== false) return linkedNode;

      let obj = object;
      while (obj.parent && obj.parent !== nodesGroup && obj.parent !== scene) obj = obj.parent;
      if (obj.userData && obj.userData.name && obj.visible !== false) return obj as THREE.Group;
      return null;
    }
    function findNodeAt(e: MouseEvent): THREE.Group | null {
      setMouseFromEvent(e);
      raycaster.setFromCamera(mouse, camera);
      const targets = nodeRaycastTargets.length > 0 ? nodeRaycastTargets : nodesGroup.children;
      const hits = raycaster.intersectObjects(targets, nodeRaycastTargets.length === 0);
      for (const hit of hits) {
        const node = getNodeFromRaycastObject(hit.object);
        if (node) return node;
      }
      return null;
    }

    function getDragSelection(node: THREE.Group): THREE.Group[] {
      if (node.userData.isSun) {
        const clusterMembers = clusterNodes.get(node.userData.clusterId) || [];
        return [node, ...clusterMembers].filter(n => n.visible !== false);
      }
      return [node];
    }

    function buildDragFollowers(selection: THREE.Group[]): DragFollower[] {
      const selected = new Set(selection);
      const followers = new Map<THREE.Group, DragFollower>();

      const getOrCreateFollower = (node: THREE.Group, strength: number): DragFollower => {
        const existing = followers.get(node);
        if (existing) {
          existing.strength = Math.max(existing.strength, strength);
          return existing;
        }
        const follower = {
          node,
          strength,
          velocity: new THREE.Vector3(),
          restPosition: node.position.clone(),
          springs: [],
        };
        followers.set(node, follower);
        return follower;
      };

      const getSpringStrength = (link: THREE.Line): number => {
        const edgeWeight = Math.max(0, Number(link.userData.edgeWeight) || 1);
        const semanticBoost = link.userData.semantic ? 0.004 : 0.0015;
        const internalPenalty = link.userData.isInternal ? -0.0015 : 0;
        return THREE.MathUtils.clamp(0.004 + Math.log1p(edgeWeight) * 0.0028 + semanticBoost + internalPenalty, 0.0025, 0.014);
      };

      allLinks.forEach((link) => {
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        if (!source || !target) return;

        const sourceSelected = selected.has(source);
        const targetSelected = selected.has(target);
        if (sourceSelected === targetSelected) return;

        const followerNode = sourceSelected ? target : source;
        if (followerNode.visible === false || followerNode.userData.isSun || selected.has(followerNode)) return;

        getOrCreateFollower(followerNode, getSpringStrength(link));
      });

      allLinks.forEach((link) => {
        const source = link.userData.source as THREE.Group | undefined;
        const target = link.userData.target as THREE.Group | undefined;
        if (!source || !target) return;
        const sourceFollower = followers.get(source);
        const targetFollower = followers.get(target);
        const sourceCanPull = selected.has(source) || !!sourceFollower;
        const targetCanPull = selected.has(target) || !!targetFollower;
        if (!sourceCanPull || !targetCanPull) return;

        const restDistance = Math.max(24, source.position.distanceTo(target.position));
        const strength = getSpringStrength(link);
        if (sourceFollower && !selected.has(source)) {
          sourceFollower.springs.push({ other: target, restDistance, strength });
        }
        if (targetFollower && !selected.has(target)) {
          targetFollower.springs.push({ other: source, restDistance, strength });
        }
      });

      return Array.from(followers.values())
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 32);
    }

    function getLinksForDragNodes(nodes: THREE.Group[]): THREE.Line[] {
      return getLinksConnectedToNodes(nodes, true);
    }

    function beginNodeDrag(node: THREE.Group, e: MouseEvent): void {
      if (layoutMode !== 'galaxy') return;
      setMouseFromEvent(e);
      raycaster.setFromCamera(mouse, camera);

      const normal = camera.getWorldDirection(new THREE.Vector3());
      const worldPoint = node.getWorldPosition(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldPoint);
      const intersection = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, intersection)) return;

      const localIntersection = nodesGroup.worldToLocal(intersection.clone());
      const selection = getDragSelection(node);
      const followers = buildDragFollowers(selection);
      const movingNodes = [...selection, ...followers.map((follower) => follower.node)];
      activeNodeDrag = {
        node,
        selection,
        followers,
        links: getLinksForDragNodes(movingNodes),
        plane,
        offset: node.position.clone().sub(localIntersection),
        anchorPosition: node.position.clone(),
        targetAnchor: node.position.clone(),
        velocity: new THREE.Vector3(),
        controlsEnabledBeforeDrag: controls.enabled,
        moved: false,
      };
      dragSettle = null;
      controls.enabled = false;
    }

    function updateNodeDrag(e: MouseEvent): boolean {
      if (!activeNodeDrag) return false;
      setMouseFromEvent(e);
      raycaster.setFromCamera(mouse, camera);
      const intersection = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(activeNodeDrag.plane, intersection)) return false;

      const localIntersection = nodesGroup.worldToLocal(intersection.clone());
      activeNodeDrag.targetAnchor.copy(localIntersection.add(activeNodeDrag.offset));
      if (activeNodeDrag.targetAnchor.distanceToSquared(activeNodeDrag.anchorPosition) > 0.16) activeNodeDrag.moved = true;
      return true;
    }

    function endNodeDrag(): boolean {
      const moved = !!activeNodeDrag?.moved;
      if (activeNodeDrag) {
        controls.enabled = activeNodeDrag.controlsEnabledBeforeDrag;
        if (moved && activeNodeDrag.followers.length > 0) {
          dragSettle = {
            followers: activeNodeDrag.followers.map((follower) => ({
              node: follower.node,
              strength: follower.strength,
              velocity: follower.velocity.clone(),
              restPosition: follower.restPosition.clone(),
              springs: follower.springs,
            })),
            links: activeNodeDrag.links,
            frames: 0,
          };
        }
        activeNodeDrag = null;
        if (moved) {
          rebuildGalaxyBoundaryRings();
          reheatGalaxyForce(0.46, 120);
        }
      }
      return moved;
    }

    function applyDragDelta(nodes: THREE.Group[], delta: THREE.Vector3): void {
      if (delta.lengthSq() < 0.000001) return;
      nodes.forEach((node) => {
        node.position.add(delta);
        syncGalaxyForceAnchor(node);
      });
    }

    function stepDragFollowers(
      followers: DragFollower[],
      settling: boolean
    ): boolean {
      let active = false;
      followers.forEach((follower) => {
        const force = new THREE.Vector3();

        follower.springs.forEach((spring) => {
          const toOther = spring.other.position.clone().sub(follower.node.position);
          const distance = Math.max(0.001, toOther.length());
          const stretch = distance - spring.restDistance;
          force.add(toOther.multiplyScalar((stretch / distance) * spring.strength));
        });

        const toRest = follower.restPosition.clone().sub(follower.node.position);
        const restStrength = settling ? 0.018 : 0.0055;
        force.add(toRest.multiplyScalar(restStrength));

        follower.velocity.add(force).multiplyScalar(settling ? 0.84 : 0.88);
        if (follower.velocity.lengthSq() > 0.0005 || toRest.lengthSq() > 1.4) active = true;
        applyDragDelta([follower.node], follower.velocity);
      });
      return active;
    }

    function stepNodeDragPhysics(): void {
      if (!activeNodeDrag) return;

      const toTarget = activeNodeDrag.targetAnchor.clone().sub(activeNodeDrag.anchorPosition);
      activeNodeDrag.velocity
        .add(toTarget.multiplyScalar(0.16))
        .multiplyScalar(0.74);

      const delta = activeNodeDrag.velocity.clone();
      if (delta.lengthSq() < 0.0001 && activeNodeDrag.targetAnchor.distanceToSquared(activeNodeDrag.anchorPosition) < 0.0001) return;

      applyDragDelta(activeNodeDrag.selection, delta);
      activeNodeDrag.anchorPosition.add(delta);

      stepDragFollowers(activeNodeDrag.followers, false);

      refreshLinkGeometryForLinks(activeNodeDrag.links);
    }

    function stepDragSettle(): void {
      if (!dragSettle) return;

      dragSettle.frames += 1;
      const active = stepDragFollowers(dragSettle.followers, true);

      refreshLinkGeometryForLinks(dragSettle.links);
      if (!active || dragSettle.frames > 110) dragSettle = null;
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const node = findNodeAt(e);
      pointerDown = { x: e.clientX, y: e.clientY, node, previousLockedNode: lockedNode };
      pressedNode = node;
      if (node) {
        renderer.domElement.style.cursor = 'grabbing';
        if (autoRotateBeforeFocus === null) autoRotateBeforeFocus = controls.autoRotate;
        controls.autoRotate = false;
        if (layoutMode === 'galaxy') {
          beginNodeDrag(node, e);
          applyHoverPreview(node);
        } else {
          applyGraphAttention(node, false);
        }
      }

      // Dismiss any existing edge info panel first
      const existing = document.getElementById('galaxy-edge-panel');
      if (existing) existing.remove();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (pressedNode) {
        updateNodeDrag(e);
        renderer.domElement.style.cursor = 'grabbing';
        return;
      }
      if (!hoverAttentionEnabled || lockedNode || layoutMode !== 'galaxy') return;
      const now = performance.now();
      if (now - lastHoverRaycastAt < 90) return;
      lastHoverRaycastAt = now;
      const node = findNodeAt(e);
      renderer.domElement.style.cursor = node ? 'pointer' : '';
      if (node === hoveredNode) return;
      hoveredNode = node;
      applyHoverPreview(node);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || !pointerDown) return;
      const pointerMoved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
      const downState = pointerDown;
      const draggedNode = endNodeDrag();
      const moved = pointerMoved > 5 || draggedNode;
      pointerDown = null;
      pressedNode = null;
      renderer.domElement.style.cursor = '';
      if (moved) {
        hoveredNode = null;
        clearHoverPreview();
        if (downState.previousLockedNode) applyGraphAttention(downState.previousLockedNode, true);
        else {
          if (layoutMode !== 'galaxy') applyGraphAttention(null);
          else {
            clearNodeLabels();
            restoreAutoRotateAfterTransientAttention();
          }
        }
        return;
      }

      const node = downState.node && findNodeAt(e) === downState.node ? downState.node : findNodeAt(e);
      if (node) {
        clearHoverPreview(0);
        focusNode(node);
        openNodeInForgePreview(node);
        return;
      }

      hoveredNode = null;
      clearHoverPreview();
      if (downState.previousLockedNode) applyGraphAttention(downState.previousLockedNode, true);
      else {
        if (layoutMode !== 'galaxy') applyGraphAttention(null);
        else {
          clearNodeLabels();
          restoreAutoRotateAfterTransientAttention();
        }
      }
    };
    const onMouseLeave = () => {
      pointerDown = null;
      pressedNode = null;
      hoveredNode = null;
      endNodeDrag();
      renderer.domElement.style.cursor = '';
      clearHoverPreview();
      if (lockedNode) applyGraphAttention(lockedNode, true);
      else {
        if (layoutMode !== 'galaxy') applyGraphAttention(null);
        else restoreAutoRotateAfterTransientAttention();
      }
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
      applyRendererPerformanceBudget();
    };
    window.addEventListener('resize', onResize);

    // --- Animation loop ---

    function animate() {
      animationId = requestAnimationFrame(animate);
      const time = performance.now() * 0.001;
      controls.update();
      stepNodeDragPhysics();
      stepDragSettle();
      stepGalaxyForceSimulation();
      if (layoutAnimating) refreshLinkGeometry();
      if (centerSpinActive && !layoutAnimating) {
        const baseSpeed = layoutMode === 'radial' ? 0.0018 : 0.00135;
        nodesGroup.rotation.y += baseSpeed * Math.max(0, controls.autoRotateSpeed || 0.2);
        syncGraphGroupRotation();
      }
      composer.render();
      renderLabels();

      // Dynamic Nebula Rotation
      if (nebulaGroup) {
        nebulaGroup.children.forEach(c => {
          c.rotation.z += (c.userData.rotationSpeed || 0.0002);
        });
      }

      if (galaxyBoundaryGroup?.visible) {
        galaxyBoundaryGroup.children.forEach((child) => {
          const spin = Number(child.userData.boundarySpin) || 0;
          if (spin) child.rotation.y += spin;
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
          const ring = n.userData.ring as THREE.Mesh;
          if (!ring.visible) return;
          const ringMaterial = ring.material as THREE.MeshBasicMaterial;
          const role = ring.userData.focusRole as 'focus' | 'neighbor' | null | undefined;
          ring.rotation.z += role === 'focus' ? 0.018 : 0.01;
          const baseOpacity = role === 'focus' ? 0.68 : role === 'neighbor' ? 0.36 : 0.2;
          const pulse = role === 'focus' ? 0.1 : role === 'neighbor' ? 0.05 : 0.1;
          ringMaterial.opacity = baseOpacity + Math.sin(time * 3) * pulse;
        }
      });

      nodesGroup.position.y = 0;
      linksGroup.position.y = 0;

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
      const targetEl = document.getElementById('cluster-target');
      if (targetEl)
        targetEl.textContent = `${controls.target.x.toFixed(1)} / ${controls.target.y.toFixed(1)} / ${controls.target.z.toFixed(1)}`;
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
      gsap.killTweensOf(nodesGroup.rotation);
      if (layoutTween) {
        layoutTween.kill();
        layoutTween = null;
      }

      // Clean up registered galaxy actions
      [
        'resetCameraView',
        'toggleLearningPath',
        'isLearningPathVisible',
        'rebuildLearningPath',
        'setAutoRotate',
        'getAutoRotate',
        'setRotateSpeed',
        'getRotateSpeed',
        'setBloom',
        'getBloom',
        'setMilkyWay',
        'getMilkyWay',
        'setLayoutMode',
        'getLayoutMode',
        'setProjectionMode',
        'getProjectionMode',
        'setHoverAttention',
        'getHoverAttention',
        'setSemanticClusterLens',
        'getSemanticClusterLens',
        'setForceMotion',
        'getForceMotion',
        'fitSelection',
        'setNodeTypeVisible',
        'getTypeVisible',
        'setExternalEdgesVisible',
        'setInternalEdgesVisible',
        'setAllNodesVisible',
        'focusOverview',
        'focusByCluster',
        'focusZenMode',
        'showOrphansOnly',
        'showAllNodes',
        'focusRecent',
        'focusNodeById',
        'findNodeByTitle',
        'buildGalaxyScene',
      ].forEach(unregister);

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
      clearLayoutGuides();
      clearGalaxyBoundaryRings();
      scene.remove(layoutGuideGroup);
      scene.remove(galaxyBoundaryGroup);

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
      glowTextureCache.forEach((texture) => texture.dispose());
      glowTextureCache.clear();

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

      // Dispose scene children (stars, milky way, etc.)
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
