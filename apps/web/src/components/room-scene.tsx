import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Box, RotateCcw } from "lucide-react";
import {
  bounds,
  surfacesFor,
  type FloorPlan,
  type Job,
  type SurfacePlan,
} from "@interior-planner/shared";
import { Button } from "./ui/button";

export function RoomScene({
  plan,
  surfacePlans,
  jobs,
  selected,
  onSelect,
  showDesigns,
  onToggleDesigns,
  focusObject,
}: {
  plan: FloorPlan;
  surfacePlans: Record<string, SurfacePlan>;
  jobs: Job[];
  selected: string;
  onSelect: (id: string) => void;
  showDesigns: boolean;
  onToggleDesigns: () => void;
  focusObject: { surfaceId: string; objectId: string; nonce: number } | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    reset = useRef<() => void>(() => {}),
    select = useRef(onSelect);
  const cameraState = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  select.current = onSelect;
  const [ceiling, setCeiling] = useState(false),
    [cutaway, setCutaway] = useState(true),
    [error, setError] = useState("");
  const [dark, setDark] = useState(
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  const geometryKey = JSON.stringify({
    plan,
    surfacePlans,
    jobs: jobs
      .filter((j) => j.status === "completed")
      .map((j) => ({ id: j.id, result: j.result })),
    selected,
    ceiling,
    cutaway,
    dark,
    showDesigns,
    focusObject,
  });
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError(
        "3D rendering needs a browser with WebGL enabled. You can continue editing the 2D plans.",
      );
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D interior. Drag to orbit, scroll to zoom, click a surface to edit it.",
    );
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(dark ? "#191919" : "#fafafa");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.95;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    const box = bounds(plan.points),
      center = new THREE.Vector3(
        (box.minX + box.maxX) / 2,
        plan.height * 0.3,
        (box.minY + box.maxY) / 2,
      ),
      extent = Math.max(box.width, box.height, plan.height);
    const resetCamera = () => {
      camera.position
        .copy(center)
        .add(new THREE.Vector3(extent * 1.05, extent * 0.95, extent * 1.15));
      controls.target.copy(center);
      controls.update();
    };
    reset.current = resetCamera;
    resetCamera();
    if (cameraState.current) {
      camera.position.copy(cameraState.current.position);
      controls.target.copy(cameraState.current.target);
      controls.update();
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb1aaa2, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(center.x + 4, 12, center.z + 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const material = (surfaceId: string, color: string) =>
      new THREE.MeshStandardMaterial({
        color: surfaceId === selected ? (dark ? "#a9a6a0" : "#dad7d1") : color,
        roughness: 0.85,
        side: THREE.DoubleSide,
      });
    const shape = new THREE.Shape();
    plan.points.forEach((p, i) =>
      i === 0 ? shape.moveTo(p.x, -p.y) : shape.lineTo(p.x, -p.y),
    );
    shape.closePath();
    const floor = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }),
      material("floor", dark ? "#827e76" : "#dedbd4"),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    floor.userData.surfaceId = "floor";
    scene.add(floor);
    const roof = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false }),
      material("ceiling", "#eeeeec"),
    );
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = plan.height;
    roof.userData.surfaceId = "ceiling";
    roof.visible = ceiling;
    scene.add(roof);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(floor.geometry),
      new THREE.LineBasicMaterial({ color: dark ? "#aaa69d" : "#b4b0a8" }),
    );
    floor.add(edges);
    const walls: {
      group: THREE.Group;
      normal: THREE.Vector3;
      point: THREE.Vector3;
    }[] = [];
    const groups = new Map<string, THREE.Group>();
    for (const surface of surfacesFor(plan)) {
      const group = new THREE.Group();
      group.userData.surfaceId = surface.id;
      if (surface.kind === "wall") {
        const p = surface.start!,
          q = surface.end!,
          dx = (q.x - p.x) / surface.width,
          dz = (q.y - p.y) / surface.width;
        const normal = new THREE.Vector3(-dz, 0, dx),
          matrix = new THREE.Matrix4().makeBasis(
            new THREE.Vector3(dx, 0, dz),
            new THREE.Vector3(0, 1, 0),
            normal,
          );
        group.quaternion.setFromRotationMatrix(matrix);
        group.position.set(p.x, 0, p.y);
        const wallShape = new THREE.Shape();
        wallShape.moveTo(0, 0);
        wallShape.lineTo(surface.width, 0);
        wallShape.lineTo(surface.width, plan.height);
        wallShape.lineTo(0, plan.height);
        wallShape.closePath();
        for (const opening of surfacePlans[surface.id]?.elements.filter(
          (e) => e.kind === "opening",
        ) ?? []) {
          // Openings touching the floor become notches rather than invalid edge-touching holes.
          const epsilon = 0.002,
            x = Math.max(epsilon, opening.x),
            y = Math.max(epsilon, opening.y),
            right = Math.min(
              surface.width - epsilon,
              opening.x + opening.width,
            ),
            top = Math.min(plan.height - epsilon, opening.y + opening.height);
          if (right > x && top > y) {
            const hole = new THREE.Path();
            hole.moveTo(x, y);
            hole.lineTo(x, top);
            hole.lineTo(right, top);
            hole.lineTo(right, y);
            hole.closePath();
            wallShape.holes.push(hole);
          }
        }
        const mesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(wallShape, {
            depth: plan.wallThickness,
            bevelEnabled: false,
          }),
          material(surface.id, dark ? "#d2d0cc" : "#f0efec"),
        );
        mesh.position.z = -plan.wallThickness / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 30),
          new THREE.LineBasicMaterial({ color: dark ? "#a09d97" : "#c7c4bd" }),
        );
        mesh.add(outline);
        walls.push({ group, normal, point: group.position.clone() });
      } else if (surface.kind === "floor") {
        group.position.set(box.minX, 0, box.maxY);
        group.rotation.x = -Math.PI / 2;
      } else {
        group.position.set(box.minX, plan.height, box.minY);
        group.rotation.x = Math.PI / 2;
        group.visible = ceiling;
      }
      groups.set(surface.id, group);
      scene.add(group);
    }
    const latest = new Map<string, Job>();
    for (const job of jobs)
      if (
        job.status === "completed" &&
        job.result &&
        showDesigns &&
        !latest.has(job.surfaceId)
      )
        latest.set(job.surfaceId, job);
    for (const [id, job] of latest) {
      const group = groups.get(id);
      if (!group) continue;
      for (const object of job.result!.objects) {
        let geometry: THREE.BufferGeometry;
        if (object.primitive === "box")
          geometry = new THREE.BoxGeometry(...object.size);
        else if (object.primitive === "cylinder") {
          geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
          geometry.scale(...object.size);
        } else {
          geometry = new THREE.SphereGeometry(0.5, 24, 16);
          geometry.scale(...object.size);
        }
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: object.color,
            roughness: object.roughness,
            metalness: object.metalness,
          }),
        );
        mesh.position.set(...object.position);
        mesh.rotation.set(...object.rotation);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.surfaceId = id;
        mesh.userData.label = object.label;
        mesh.userData.objectId = object.id;
        group.add(mesh);
        if (
          focusObject?.surfaceId === id &&
          focusObject.objectId === object.id
        ) {
          group.updateWorldMatrix(true, true);
          const targetBox = new THREE.Box3().setFromObject(mesh),
            target = targetBox.getCenter(new THREE.Vector3());
          const distance = Math.max(
            targetBox.getSize(new THREE.Vector3()).length() * 1.8,
            1.5,
          );
          const direction = id.startsWith("wall:")
            ? new THREE.Vector3(0, 0.35, 1).applyQuaternion(group.quaternion)
            : id === "ceiling"
              ? new THREE.Vector3(0.3, -1, 0.3)
              : new THREE.Vector3(0.6, 1, 0.8);
          camera.position
            .copy(target)
            .add(direction.normalize().multiplyScalar(distance));
          controls.target.copy(target);
          controls.update();
          scene.add(new THREE.BoxHelper(mesh, dark ? 0xffffff : 0x171717));
        }
      }
    }
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: dark ? 0.15 : 0.09 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.13;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(
      100,
      100,
      dark ? 0x373737 : 0xdadada,
      dark ? 0x292929 : 0xebebeb,
    );
    grid.position.set(center.x, -0.14, center.z);
    scene.add(grid);
    const raycaster = new THREE.Raycaster();
    let pointerStart = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      pointerStart = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      if (
        Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 5
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        let object: THREE.Object3D | null = hit.object;
        let visible = true;
        for (let p: THREE.Object3D | null = object; p; p = p.parent)
          if (!p.visible) visible = false;
        if (!visible) continue;
        while (object && !object.userData.surfaceId) object = object.parent;
        if (object?.userData.surfaceId) {
          select.current(object.userData.surfaceId);
          break;
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    const resize = () => {
      renderer.setSize(element.clientWidth, element.clientHeight);
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      for (const wall of walls)
        wall.group.visible =
          !cutaway ||
          wall.normal.dot(camera.position.clone().sub(wall.point)) > 0;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cameraState.current = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments
        ) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [geometryKey]);
  return (
    <>
      <div ref={host} className="absolute inset-0" />
      {error ? (
        <div className="absolute inset-0 flex flex-col justify-center items-center bg-background p-10 text-center">
          <Box className="size-8 mb-4 subtle" />
          <p className="text-sm max-w-sm">{error}</p>
        </div>
      ) : (
        <>
          <div className="canvas-tools">
            <Button
              size="sm"
              variant={showDesigns ? "secondary" : "ghost"}
              className="text-[11px] h-7"
              onClick={onToggleDesigns}
            >
              {showDesigns ? "After · Agent design" : "Before · Original room"}
            </Button>
            <span className="border-l mx-1" />
            <label className="flex items-center gap-2 px-2 text-[11px]">
              <input
                type="checkbox"
                checked={cutaway}
                onChange={(e) => setCutaway(e.target.checked)}
              />
              Cutaway
            </label>
            <span className="border-l mx-1" />
            <label className="flex items-center gap-2 px-2 text-[11px]">
              <input
                type="checkbox"
                checked={ceiling}
                onChange={(e) => setCeiling(e.target.checked)}
              />
              Ceiling
            </label>
          </div>
          <p className="canvas-caption">
            {!showDesigns && "Agent changes hidden · "}
            Drag to orbit · Scroll to zoom · Click a surface to select
          </p>
          <div className="canvas-zoom">
            <Button size="sm" variant="ghost" onClick={() => reset.current()}>
              <RotateCcw className="size-3" />
              Reset view
            </Button>
          </div>
        </>
      )}
    </>
  );
}
