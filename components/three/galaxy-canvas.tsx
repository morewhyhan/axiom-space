'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import gsap from 'gsap';
import type { GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/types/galaxy';

export interface GalaxyCanvasHandle {
  resetCameraView: () => void;
}

interface GalaxyCanvasProps {
  vaultId?: string | null
  nodes?: GalaxyNode[]
  edges?: GalaxyEdge[]
  clusters?: GalaxyCluster[]
  learningPathSteps?: { id: string; index: number; name: string }[]
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
      if ((window as unknown as Record<string, unknown>).__resetCameraView) {
        (window as unknown as Record<string, () => void>).__resetCameraView();
      }
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
      // Neighbors
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
        div.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-100%);padding:1px 8px;border-radius:4px;font-family:"Noto Sans SC","JetBrains Mono",sans-serif;font-weight:700;font-size:15px;color:rgba(255,255,255,0.3);background:rgba(0,0,0,0.25);white-space:nowrap;pointer-events:none;user-select:none;letter-spacing:0.15em;text-transform:uppercase;`;
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
        div.style.cssText = `position:absolute;left:${x}px;top:${top}px;transform:translateX(-50%);padding:2px 8px;border-radius:3px;font-family:"Noto Sans SC","JetBrains Mono",sans-serif;font-weight:${nl.isFocused ? '700' : '400'};font-size:${nl.isFocused ? '15px' : '12px'};color:rgba(255,255,255,${nl.isFocused ? '0.9' : '0.6'});background:rgba(0,0,0,0.35);white-space:nowrap;pointer-events:none;user-select:none;`;
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

    function createCore(name: string): void {
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
        currentClusterId = node.userData.clusterId;
        const cid = node.userData.clusterId;
        const mySubNodes = clusterNodes.get(cid) || [];
        const myClusterSet = new Set<THREE.Group>([node, ...mySubNodes]);
        allNodes.forEach((n) => {
          if (!n.visible) return;
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
          if (l.userData._filtered) return;
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
        // Only include visible neighbors
        const visibleNeighbors = new Set(Array.from(neighbors).filter(n => n.visible));
        const visibleSet = new Set<THREE.Group>([node, ...visibleNeighbors]);
        allNodes.forEach((n) => {
          if (!n.visible) return;
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
          if (l.userData._filtered) return;
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
      // Show card name labels for focused node + neighbors
      setNodeLabelsFromNode(node);

      // Propagate selected node to React store for editing
      if (node.userData && node.userData.id) {
        useAppStore.getState().setSelectedNode({
          id: node.userData.id as string,
          title: (node.userData.name as string) || '',
          type: (node.userData.type as string) || 'fleeting',
        });
        useAppStore.getState().setMode('forge');
      }
    }

    // --- Learning Path ---
    function buildDemoLearningPath(stepsFromProps?: { id: string; index: number; name: string }[]): void {
      const steps: { node: THREE.Group; stepIndex: number }[] = [];

      // Try to map real card IDs to scene nodes
      if (stepsFromProps && stepsFromProps.length > 0) {
        for (const s of stepsFromProps) {
          let found: THREE.Group | undefined;
          for (const [, nodes] of clusterNodes) {
            found = nodes.find(n => n.userData.id === s.id);
            if (found) break;
          }
          if (found) steps.push({ node: found, stepIndex: s.index });
        }
        if (steps.length >= 2) {
          learningPath.steps = steps;
          return;
        }
        // Fall through to hardcoded fallback if not enough real nodes found
        steps.length = 0;
      }

      // Fallback: hardcoded cluster indices
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

    function createClustersFromData(clustersData: GalaxyCluster[], nodesData: GalaxyNode[], edgesData: GalaxyEdge[]): void {
      // Skip if no real data — wait for async fetch
      if (clustersData.length === 0 && nodesData.length === 0) return;

      const CLUSTER_COLORS = [0xa855f7, 0x22d3ee, 0xf472b6, 0x818cf8, 0x34d399, 0xfbbf24];
      const mixColors = [0xa855f7, 0x22d3ee, 0xf472b6];

      // Build a lookup from node title to node data for edge matching
      const nodeTitleToGroup = new Map<string, THREE.Group>();

      // Create sun for each cluster
      clustersData.forEach((cluster, i) => {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / clustersData.length);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const dist = 250 + Math.random() * 100;
        const cx = dist * Math.sin(phi) * Math.cos(theta);
        const cy = dist * Math.cos(phi) * 1.2;
        const cz = dist * Math.sin(phi) * Math.sin(theta);

        const color = parseInt(cluster.color.replace('#', ''), 16);
        const sun = createGlowNode(color, 6, cluster.name);
        sun.position.set(cx, cy, cz);
        sun.userData.isSun = true;
        sun.userData.clusterId = i;
        sun.userData.clusterColor = color;
        nodesGroup.add(sun);
        clusterSuns.set(i, sun);

        // Cluster name label — always visible above the sun
        const clusterPos = new THREE.Vector3(cx, cy, cz);
        addClusterLabel(cluster.name, color, clusterPos);

        // Link sun to center
        const core = allNodes.find(n => n.userData.name === 'CENTRAL_INTELLIGENCE')!;
        createCurve(core, sun, color, 0.1);

        // Create nodes for cards in this cluster — with organic positioning + mixed colors
        const clusterNodeData = nodesData.filter(n => n.clusterId === cluster.id);
        const subNodes: THREE.Group[] = [];
        clusterNodeData.forEach((cardNode, j) => {
          // Use original random positioning for organic look
          const radius = 40 + Math.pow(Math.random(), 0.7) * 160;
          const t = Math.random() * Math.PI * 2;
          const p = Math.acos(Math.random() * 2 - 1);
          const x = cx + radius * Math.sin(p) * Math.cos(t);
          const y = cy + radius * Math.sin(p) * Math.sin(t) * 0.7;
          const z = cz + radius * Math.cos(p);
          const distToSun = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
          const sizeFactor = Math.max(0.4, 1 - distToSun / 250);

          const baseSize = cardNode.type === 'permanent' ? 3.5 : cardNode.type === 'literature' ? 3 : 2.5;
          const nodeSize = baseSize * sizeFactor;
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
          createCurve(sun, node, color, 0.06, false, nodeTypeColor);

          // Store title-to-group mapping for edge lookup
          if (cardNode.title) nodeTitleToGroup.set(cardNode.title, node);
        });

        // Save to clusterNodes for focus/zoom animations
        clusterNodes.set(i, subNodes);

        // Create random internal edges for visual density (like original)
        for (let j = 0; j < subNodes.length; j++) {
          const connCount = 2 + Math.floor(Math.random() * 3);
          for (let k = 0; k < connCount; k++) {
            const targetIdx = Math.floor(Math.random() * subNodes.length);
            if (targetIdx !== j) {
              const linkColor = subNodes[j].userData.trueColor || color;
              createCurve(subNodes[j], subNodes[targetIdx], color, 0, true, linkColor);
            }
          }
        }
      });

      // Create edges from real data (concept-to-concept connections)
      // Same-cluster edges are internal (hidden by default, shown on cluster focus)
      edgesData.forEach(edge => {
        const sourceNode = allNodes.find(n => n.userData.id === edge.sourceId);
        const targetNode = allNodes.find(n => n.userData.id === edge.targetId);
        if (sourceNode && targetNode) {
          const edgeColor = sourceNode.userData.trueColor || sourceNode.userData.clusterColor || 0xffffff;
          const sameCluster = sourceNode.userData.clusterId !== undefined && sourceNode.userData.clusterId !== null
            && sourceNode.userData.clusterId === targetNode.userData.clusterId;
          // Cross-cluster edges always visible; same-cluster edges hidden until focused
          const isCrossCluster = sourceNode.userData.clusterId !== targetNode.userData.clusterId;
          createCurve(sourceNode, targetNode, edgeColor, 0.06, !isCrossCluster, edgeColor);
          if (isCrossCluster) { const lastLink = allLinks[allLinks.length - 1]; if (lastLink) lastLink.userData.isExternal = true; lastLink.visible = false; }
        }
      });

      // Unclustered nodes — place around center
      const unclusteredNodes = nodesData.filter(n => !n.clusterId);
      unclusteredNodes.forEach((cardNode, j) => {
        const angle = (j / Math.max(unclusteredNodes.length, 1)) * Math.PI * 2;
        const radius = 100 + Math.random() * 60;
        const x = Math.cos(angle) * radius;
        const y = (Math.random() - 0.5) * 40;
        const z = Math.sin(angle) * radius;
        const utc = cardNode.type === 'permanent' ? 0xa855f7 : cardNode.type === 'literature' ? 0xf472b6 : 0x22d3ee;
        const node = createGlowNode(utc, 2, cardNode.title);
        node.position.set(x, y, z);
        node.userData.id = cardNode.id;
        node.userData.trueColor = utc;
        nodesGroup.add(node);
      });
    }

    function resetCameraView(): void {
      const resetBtn = document.getElementById('reset-view-btn');
      if (resetBtn) resetBtn.classList.remove('visible');
      clearNodeLabels();
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
        // Reapply type visibility filter
        const t = n.userData.type as string;
        if (t && typeVisible[t] !== undefined) n.visible = typeVisible[t];
      });
      reapplyFilters();
      allLinks.forEach((l) => {
        if (l.userData._filtered) return;
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
    (window as unknown as Record<string, unknown>).__rebuildLearningPath =
      () => {
        clearLearningPath();
        buildDemoLearningPath(dataRef.current.learningPathSteps);
        createLearningPath();
        learningPath.group.visible = learningPath.visible;
      };
    (window as unknown as Record<string, unknown>).__setAutoRotate =
      (on: boolean) => { controls.autoRotate = on; };
    (window as unknown as Record<string, unknown>).__getAutoRotate =
      () => controls.autoRotate;
    (window as unknown as Record<string, unknown>).__setRotateSpeed =
      (s: number) => { controls.autoRotateSpeed = s; };
    (window as unknown as Record<string, unknown>).__getRotateSpeed =
      () => controls.autoRotateSpeed;
    (window as unknown as Record<string, unknown>).__setBloom =
      (v: number) => { if (bloomPass) bloomPass.strength = v; };
    (window as unknown as Record<string, unknown>).__getBloom =
      () => bloomPass?.strength ?? 1.1;
    (window as unknown as Record<string, unknown>).__setMilkyWay =
      (v: boolean) => { if (milkyWay) milkyWay.visible = v; };
    (window as unknown as Record<string, unknown>).__getMilkyWay =
      () => milkyWay?.visible ?? true;
    (window as unknown as Record<string, unknown>).__setCometSpeed =
      (v: number) => { cometSpeedMultiplier = Math.max(0, Math.min(3, v)); };
    (window as unknown as Record<string, unknown>).__getCometSpeed =
      () => cometSpeedMultiplier;
    (window as unknown as Record<string, unknown>).__setCometsVisible =
      (v: boolean) => { scene.children.forEach(c => { if (c.userData && c.userData.isComet) c.visible = v; }); };
    (window as unknown as Record<string, unknown>).__getCometsVisible =
      () => { const c = scene.children.find(c => c.userData && c.userData.isComet); return c ? c.visible !== false : true; };
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
    (window as unknown as Record<string, unknown>).__setNodeTypeVisible =
      (type: string, visible: boolean) => {
        typeVisible[type] = visible;
        allNodes.forEach(n => {
          if (n.userData.type === type) n.visible = visible;
        });
        refreshLinksAndLabels();
        clearNodeLabels();
      };
    (window as unknown as Record<string, unknown>).__getTypeVisible =
      (type: string) => {
        const node = allNodes.find(n => n.userData.type === type);
        return node ? node.visible !== false : true;
      };
    (window as unknown as Record<string, unknown>).__setExternalEdgesVisible =
      (v: boolean) => {
        allLinks.forEach(l => {
          if (l.userData.isExternal && !l.userData._filtered) {
            l.visible = v;
          }
        });
      };
    (window as unknown as Record<string, unknown>).__setInternalEdgesVisible =
      (v: boolean) => {
        allLinks.forEach(l => {
          if (l.userData.isInternal && !l.userData._filtered) {
            // Only toggle edges that are internal by default (same-cluster)
            l.visible = v && (!l.userData._wasVisible === false || true);
          }
        });
      };
    (window as unknown as Record<string, unknown>).__setAllNodesVisible =
      (v: boolean) => {
        allNodes.forEach(n => { n.visible = v; });
        refreshLinksAndLabels();
        clearNodeLabels();
      };

    // ── FOCUS mode functions ──
    (window as unknown as Record<string, unknown>).__focusOverview = () => {
      allNodes.forEach(n => { n.visible = true; n.scale.set(1, 1, 1); });
      allLinks.forEach(l => {
        if (!l.userData._filtered) {
          if (l.userData.isInternal) l.visible = false;
          else l.visible = true;
        }
      });
      clearNodeLabels();
    };
    (window as unknown as Record<string, unknown>).__focusByCluster = () => {
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
    };
    (window as unknown as Record<string, unknown>).__focusZenMode = () => {
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
    };
    (window as unknown as Record<string, unknown>).__showOrphansOnly = () => {
      allNodes.forEach(n => {
        if (n.userData.isSun) { n.visible = true; return; }
        const neighbors = adjMap.get(n);
        n.visible = !neighbors || neighbors.size === 0;
      });
      refreshLinksAndLabels();
    };
    (window as unknown as Record<string, unknown>).__showAllNodes = () => {
      allNodes.forEach(n => { n.visible = true; });
      refreshLinksAndLabels();
    };
    (window as unknown as Record<string, unknown>).__focusRecent = () => {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      allNodes.forEach(n => {
        if (n.userData.createdAt) {
          n.visible = new Date(n.userData.createdAt).getTime() > weekAgo;
        }
      });
      refreshLinksAndLabels();
      clearNodeLabels();
    };

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
    bloomPass.strength = 2.5;
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
    let currentClusterId: number | null = null;
    const typeVisible: Record<string, boolean> = {};
    (window as unknown as Record<string, unknown>).__buildGalaxyScene = (
      n: GalaxyNode[],
      e: GalaxyEdge[],
      c: GalaxyCluster[],
      vid?: string | null
    ) => {
      if (sceneDataRendered && vid === lastVaultId) return;
      if (n.length === 0 && c.length === 0) return;

      // Clear any previous nodes/edges (nodesGroup keeps background scene clean)
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
      // Reset filter state for new vault
      Object.keys(typeVisible).forEach(k => delete typeVisible[k]);
      adjMap.clear();
      clusterNodes.clear();
      clusterSuns.clear();
      clusterLabelData.length = 0;
      nodeLabelItems.length = 0;
      clearNodeLabels();

      const storeVaults = useAppStore.getState().vaults; const vaultName = storeVaults.find(v => v.id === vid)?.name || vid || `CENTRAL_INTELLIGENCE`;
      createCore(vaultName);
      createClustersFromData(c, n, e);
      // Build learning path from real data if available
      clearLearningPath();
      buildDemoLearningPath(dataRef.current.learningPathSteps);
      createLearningPath();
      sceneDataRendered = true;
      lastVaultId = vid || null;
    };

    // If data already available at mount time (fast fetch), render immediately
    const { nodes: dn, edges: de, clusters: dc } = dataRef.current;
    if (dc.length > 0 || dn.length > 0) {
      // Look up vaultId from store for proper core naming
      const initVid = useAppStore.getState().currentVaultId;
      ((window as unknown as Record<string, unknown>).__buildGalaxyScene as (n: GalaxyNode[], e: GalaxyEdge[], c: GalaxyCluster[], vid?: string | null) => void)(dn, de, dc, initVid);
    }

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
      renderLabels();
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
      delete (window as unknown as Record<string, unknown>).__buildGalaxyScene;

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
    const buildFn = (window as unknown as Record<string, unknown>).__buildGalaxyScene;
    if (typeof buildFn === 'function') {
      (buildFn as any)(nodes, edges, clusters, vaultId);
    }
  }, [vaultId, nodes.length > 0]);

  // --- Phase 2: Vault switch — rebuild when vaultId changes after initial build.
  // Previously this keyed off `nodes[0]?.id`/`clusters[0]?.id`, which means
  // switching to an empty vault left both undefined and the effect never fired,
  // so the old scene stayed on screen. Keying on `vaultId` guarantees a rebuild
  // whether the new vault has data or not. The Phase 1 effect handles the very
  // first build; this one only fires on subsequent vault switches.
  useEffect(() => {
    if (!didBuild.current || !vaultId) return;
    const buildFn = (window as unknown as Record<string, unknown>).__buildGalaxyScene;
    if (typeof buildFn === 'function') {
      (buildFn as any)(nodes, edges, clusters, vaultId);
    }
  }, [vaultId]);

  // --- Phase 3: Rebuild learning path when learning path steps data changes ---
  useEffect(() => {
    if (!didBuild.current) return;
    const rebuildFn = (window as unknown as Record<string, unknown>).__rebuildLearningPath;
    if (typeof rebuildFn === 'function') {
      (rebuildFn as () => void)();
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
