"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */

import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import {
  Canvas,
  Image as FabricImage,
  FabricObject,
  Polygon,
  Circle,
  Path,
} from "fabric";
import { Project, Layer, CanvasState } from "@/types";
import { CANVAS_MAX_WIDTH, CANVAS_MAX_HEIGHT } from "@/constants/canvas";
import { MaskRenderer } from "@/utils/mask";

const MASK_HANDLE_COLOR = "#00a86b";
const MASK_HANDLE_SELECTED_COLOR = "#f97316";
const MASK_EDGE_INSERT_THRESHOLD = 25;

interface FabricCanvasProps {
  project: Project | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  selectedLayerId?: string;
  transformMode?: "normal" | "skew";
  canvasState?: CanvasState;
  onMaskFinished?: () => void;
  onLayerSelected?: (layerId: string) => void;
  onMaskStateChange?: (state: {
    isDrawing: boolean;
    pointCount: number;
  }) => void;
  onPanChange?: (pan: { x: number; y: number }) => void;
}

export interface FabricCanvasRef {
  updateLayer: (layer: Layer) => void;
  removeLayer: (layerId: string) => void;
  selectLayer: (layerId: string) => void;
  clearSelection: () => void;
  exportCanvas: (scale?: number) => Promise<string>;
  cancelMaskDrawing: () => void;
  finishMaskDrawing: () => void;
  getMaskDrawingState: () => { isDrawing: boolean; pointCount: number };
}

const FabricCanvas = forwardRef<FabricCanvasRef, FabricCanvasProps>(
  (
    {
      project,
      onLayerUpdate,
      selectedLayerId,
      transformMode = "normal",
      canvasState,
      onMaskFinished,
      onLayerSelected,
      onMaskStateChange,
      onPanChange,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<Canvas | null>(null);
    const objectLayerMapRef = useRef<Map<FabricObject, string>>(new Map());
    const maskDrawingRef = useRef<{
      isDrawing: boolean;
      points: { x: number; y: number }[];
      currentPolygon?: Polygon;
      pointCircles: Circle[];
      targetLayerId?: string;
    }>({
      isDrawing: false,
      points: [],
      pointCircles: [],
    });

    const selectedMaskHandleRef = useRef<Circle | null>(null);
    const selectedMaskHandleInfoRef = useRef<{
      layerId: string;
      index: number;
    } | null>(null);

    const canvasZoomRef = useRef<number>(1);
    const canvasPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const previousInteractionStateRef = useRef<{
      skipTargetFind: boolean;
      selection: boolean;
      defaultCursor: string | undefined;
      hoverCursor: string | undefined;
    } | null>(null);

    const lastProjectRef = useRef<{
      baseImageData: string | undefined;
      layerCount: number;
    }>({ baseImageData: undefined, layerCount: 0 });
    const projectRef = useRef<Project | null>(project);

    const PAN_PRECISION = 2;
    const ZOOM_EPSILON = 0.0001;
    const PAN_EPSILON = 0.1;

    const normalizePan = (pan: { x: number; y: number }) => ({
      x: Number(pan.x.toFixed(PAN_PRECISION)),
      y: Number(pan.y.toFixed(PAN_PRECISION)),
    });

    const pansAreClose = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      return (
        Math.abs(a.x - b.x) < PAN_EPSILON && Math.abs(a.y - b.y) < PAN_EPSILON
      );
    };

    const getBaseTranslation = (canvas: Canvas, zoom: number) => {
      const width = canvas.getWidth();
      const height = canvas.getHeight();
      return {
        x: (width / 2) * (1 - zoom),
        y: (height / 2) * (1 - zoom),
      };
    };

    const applyZoomAndPanToCanvas = (
      canvas: Canvas,
      zoomValue: number,
      panValue?: { x: number; y: number }
    ) => {
      const normalizedZoom = Math.max(0.05, zoomValue || 1);
      const baseTranslation = getBaseTranslation(canvas, normalizedZoom);
      const pan = panValue ? normalizePan(panValue) : { x: 0, y: 0 };
      const translateX = baseTranslation.x + pan.x;
      const translateY = baseTranslation.y + pan.y;

      canvas.setViewportTransform([
        normalizedZoom,
        0,
        0,
        normalizedZoom,
        translateX,
        translateY,
      ]);
      canvas.requestRenderAll();
    };

    const getPanFromViewport = (canvas: Canvas) => {
      const vpt = canvas.viewportTransform;
      if (!vpt) {
        return { x: 0, y: 0 };
      }

      const zoom = canvas.getZoom();
      const baseTranslation = getBaseTranslation(canvas, zoom);
      const pan = {
        x: vpt[4] - baseTranslation.x,
        y: vpt[5] - baseTranslation.y,
      };

      return normalizePan(pan);
    };

    const adjustPanForZoomChange = (
      canvas: Canvas,
      currentZoom: number,
      currentPan: { x: number; y: number },
      nextZoom: number
    ) => {
      const width = canvas.getWidth();
      const height = canvas.getHeight();
      const centerX = width / 2;
      const centerY = height / 2;

      const baseCurrent = getBaseTranslation(canvas, currentZoom);
      const translateCurrentX = baseCurrent.x + currentPan.x;
      const translateCurrentY = baseCurrent.y + currentPan.y;

      const worldCenterX = (centerX - translateCurrentX) / currentZoom;
      const worldCenterY = (centerY - translateCurrentY) / currentZoom;

      const baseNext = getBaseTranslation(canvas, nextZoom);
      const translateNextX = centerX - worldCenterX * nextZoom;
      const translateNextY = centerY - worldCenterY * nextZoom;

      const adjustedPan = {
        x: translateNextX - baseNext.x,
        y: translateNextY - baseNext.y,
      };

      return normalizePan(adjustedPan);
    };

    // Helper function to apply transform mode settings to a fabric object
    const applyTransformModeToObject = (obj: FabricObject, layer: Layer) => {
      const isLocked = layer?.locked || false;

      if (isLocked) {
        // Layer is locked - skip transform mode changes and ensure it stays locked
        obj.selectable = false;
        obj.evented = false;
        obj.lockMovementX = true;
        obj.lockMovementY = true;
        obj.lockRotation = true;
        obj.lockScalingX = true;
        obj.lockScalingY = true;
        obj.lockSkewingX = true;
        obj.lockSkewingY = true;

        obj.setControlsVisibility({
          tl: false,
          tr: false,
          br: false,
          bl: false,
          ml: false,
          mt: false,
          mr: false,
          mb: false,
          mtr: false,
        });

        obj.borderColor = "#999999";
        obj.cornerColor = "#999999";
        obj.cornerSize = 0;
      } else if (transformMode === "skew") {
        // Enable skewing mode
        obj.lockSkewingX = false;
        obj.lockSkewingY = false;
        obj.lockRotation = true;
        obj.lockScalingX = false; // Keep unlocked so handles work
        obj.lockScalingY = false; // Keep unlocked so handles work
        obj.lockMovementX = false;
        obj.lockMovementY = false;

        // Show only side controls for skewing
        obj.setControlsVisibility({
          tl: false,
          tr: false,
          br: false,
          bl: false,
          ml: true, // middle-left
          mt: true, // middle-top
          mr: true, // middle-right
          mb: true, // middle-bottom
          mtr: false,
        });

        // Only override handlers if not already overridden
        if (!(obj as any)._skewHandlersApplied) {
          // Override control handlers to modify skew instead of scale
          const originalML = obj.controls.ml.actionHandler;
          const originalMR = obj.controls.mr.actionHandler;
          const originalMT = obj.controls.mt.actionHandler;
          const originalMB = obj.controls.mb.actionHandler;

          // Store original handlers so we can restore them
          (obj as any)._originalHandlers = {
            originalML,
            originalMR,
            originalMT,
            originalMB,
          };

          // Custom skew handlers
          obj.controls.ml.actionHandler = (
            eventData: any,
            transformData: any,
            x: number,
            y: number
          ) => {
            const target = transformData.target;
            const canvas = target.canvas;
            if (!canvas) return false;

            const pointer = canvas.getPointer(eventData);
            const startSkewY =
              (target as any)._skewStartY !== undefined
                ? (target as any)._skewStartY
                : target.skewY || 0;

            if ((target as any)._skewStartY === undefined) {
              (target as any)._skewStartY = target.skewY || 0;
              (target as any)._skewStartPointer = pointer.y;
            }

            const deltaY =
              (pointer.y - (target as any)._skewStartPointer) * 0.2;
            const newSkewY = Math.max(-45, Math.min(45, startSkewY + deltaY));
            target.set("skewY", newSkewY);
            canvas.renderAll();

            return true;
          };

          obj.controls.mr.actionHandler = (
            eventData: any,
            transformData: any,
            x: number,
            y: number
          ) => {
            const target = transformData.target;
            const canvas = target.canvas;
            if (!canvas) return false;

            const pointer = canvas.getPointer(eventData);
            const startSkewY =
              (target as any)._skewStartY !== undefined
                ? (target as any)._skewStartY
                : target.skewY || 0;

            if ((target as any)._skewStartY === undefined) {
              (target as any)._skewStartY = target.skewY || 0;
              (target as any)._skewStartPointer = pointer.y;
            }

            const deltaY =
              (pointer.y - (target as any)._skewStartPointer) * -0.2;
            const newSkewY = Math.max(-45, Math.min(45, startSkewY + deltaY));
            target.set("skewY", newSkewY);
            canvas.renderAll();

            return true;
          };

          obj.controls.mt.actionHandler = (
            eventData: any,
            transformData: any,
            x: number,
            y: number
          ) => {
            const target = transformData.target;
            const canvas = target.canvas;
            if (!canvas) return false;

            const pointer = canvas.getPointer(eventData);
            const startSkewX =
              (target as any)._skewStartX !== undefined
                ? (target as any)._skewStartX
                : target.skewX || 0;

            if ((target as any)._skewStartX === undefined) {
              (target as any)._skewStartX = target.skewX || 0;
              (target as any)._skewStartPointer = pointer.x;
            }

            const deltaX =
              (pointer.x - (target as any)._skewStartPointer) * 0.2;
            const newSkewX = Math.max(-45, Math.min(45, startSkewX + deltaX));
            target.set("skewX", newSkewX);
            canvas.renderAll();

            return true;
          };

          obj.controls.mb.actionHandler = (
            eventData: any,
            transformData: any,
            x: number,
            y: number
          ) => {
            const target = transformData.target;
            const canvas = target.canvas;
            if (!canvas) return false;

            const pointer = canvas.getPointer(eventData);
            const startSkewX =
              (target as any)._skewStartX !== undefined
                ? (target as any)._skewStartX
                : target.skewX || 0;

            if ((target as any)._skewStartX === undefined) {
              (target as any)._skewStartX = target.skewX || 0;
              (target as any)._skewStartPointer = pointer.x;
            }

            const deltaX =
              (pointer.x - (target as any)._skewStartPointer) * -0.2;
            const newSkewX = Math.max(-45, Math.min(45, startSkewX + deltaX));
            target.set("skewX", newSkewX);
            canvas.renderAll();

            return true;
          };

          // Reset skew start values on mouse up
          const resetSkewStart = () => {
            delete (obj as any)._skewStartX;
            delete (obj as any)._skewStartY;
            delete (obj as any)._skewStartPointer;
          };

          // Remove any existing listeners first to avoid duplicates
          obj.off("mouseup", resetSkewStart);
          obj.off("modified", resetSkewStart);

          obj.on("mouseup", resetSkewStart);
          obj.on("modified", resetSkewStart);

          (obj as any)._skewHandlersApplied = true;
        }

        // Set visual indicators for skew mode
        obj.borderColor = "#ff6600";
        obj.cornerColor = "#ff6600";
        obj.cornerSize = 10;
        obj.transparentCorners = false;
      } else {
        // Normal transform mode - disable skewing, enable scaling and rotation
        obj.lockSkewingX = true;
        obj.lockSkewingY = true;
        obj.lockRotation = false;
        obj.lockScalingX = false;
        obj.lockScalingY = false;
        obj.lockMovementX = false;
        obj.lockMovementY = false;

        // Show all controls in normal mode
        obj.setControlsVisibility({
          tl: true, // top-left corner
          tr: true, // top-right corner
          br: true, // bottom-right corner
          bl: true, // bottom-left corner
          ml: true, // middle-left
          mt: true, // middle-top
          mr: true, // middle-right
          mb: true, // middle-bottom
          mtr: true, // rotation control
        });

        // Restore original handlers if they exist
        const originalHandlers = (obj as any)._originalHandlers;
        if (originalHandlers) {
          obj.controls.ml.actionHandler = originalHandlers.originalML;
          obj.controls.mr.actionHandler = originalHandlers.originalMR;
          obj.controls.mt.actionHandler = originalHandlers.originalMT;
          obj.controls.mb.actionHandler = originalHandlers.originalMB;
          delete (obj as any)._originalHandlers;
          delete (obj as any)._skewHandlersApplied;
        }

        // Clean up any skew tracking properties
        delete (obj as any)._skewStartX;
        delete (obj as any)._skewStartY;
        delete (obj as any)._skewStartPointer;

        // Set visual indicators for normal mode
        obj.borderColor = "#0066cc";
        obj.cornerColor = "#0066cc";
        obj.cornerSize = 8;
        obj.transparentCorners = false;
      }

      // Force controls update
      obj.setCoords();
    };

    const shouldShowMaskHandles = (layer?: Layer | null) => {
      return (
        !!layer &&
        !layer.locked &&
        canvasState?.tool === "mask" &&
        layer.mask.enabled &&
        layer.mask.visible &&
        layer.mask.path.length > 0
      );
    };

    const selectMaskHandle = (handle: Circle | null) => {
      const canvas = fabricCanvasRef.current;
      const previous = selectedMaskHandleRef.current;

      if (previous && previous !== handle) {
        previous.set({ fill: MASK_HANDLE_COLOR });
        (previous as any)._isSelectedMaskHandle = false;
      }

      if (!handle) {
        if (previous) {
          previous.set({ fill: MASK_HANDLE_COLOR });
          (previous as any)._isSelectedMaskHandle = false;
        }
        selectedMaskHandleRef.current = null;
        selectedMaskHandleInfoRef.current = null;
        canvas?.requestRenderAll();
        return;
      }

      selectedMaskHandleRef.current = handle;
      selectedMaskHandleInfoRef.current = {
        layerId: (handle as any)._maskLayerId,
        index: (handle as any)._maskPointIndex ?? 0,
      };

      handle.set({ fill: MASK_HANDLE_SELECTED_COLOR });
      (handle as any)._isSelectedMaskHandle = true;
      (handle as any).bringToFront?.();
      canvas?.requestRenderAll();
    };

    const removeMaskHandles = (fabricObj: FabricObject) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const handles: Circle[] | undefined = (fabricObj as any)
        ._maskPointHandles;
      if (handles?.length) {
        const selectedHandle = selectedMaskHandleRef.current;
        handles.forEach((handle) => {
          handle.off();
          canvas.remove(handle);
        });
        if (selectedHandle && handles.includes(selectedHandle)) {
          selectedHandle.set({ fill: MASK_HANDLE_COLOR });
          (selectedHandle as any)._isSelectedMaskHandle = false;
          selectedMaskHandleRef.current = null;
        }
      }
      (fabricObj as any)._maskPointHandles = [];
      canvas.requestRenderAll();
    };

    const updateMaskVisualizationFromHandles = (
      layer: Layer,
      maskShape: FabricObject,
      handles: Circle[]
    ) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || handles.length === 0) return;

      const absPoints = handles.map(
        (handle) => [handle.left ?? 0, handle.top ?? 0] as [number, number]
      );

      if (maskShape instanceof Polygon) {
        maskShape.set({
          points: absPoints.map(([x, y]) => ({ x, y })),
        });
      } else if (maskShape instanceof Path) {
        const smoothing = layer.mask.smoothing ?? 0;
        const d = MaskRenderer.toSmoothedClosedPathD(absPoints, smoothing);
        const tempPath = new Path(d);
        maskShape.set({
          path: tempPath.path,
          pathOffset: tempPath.pathOffset,
        });
        (maskShape as Path).pathOffset = tempPath.pathOffset;
        tempPath.dispose?.();
      }

      maskShape.setCoords();
      maskShape.dirty = true;
      canvas.requestRenderAll();
    };

    const commitMaskHandlePositions = (
      layer: Layer,
      handles: Circle[],
      fabricObj: FabricObject
    ) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const layerId = objectLayerMapRef.current.get(fabricObj);
      if (!layerId) return;

      const latestLayer =
        project?.layers.find((candidate) => candidate.id === layerId) ?? layer;

      const offX = (latestLayer.mask.offset?.x ?? 0) * canvas.width;
      const offY = (latestLayer.mask.offset?.y ?? 0) * canvas.height;

      const nextPath = handles.map((handle) => {
        const absX = handle.left ?? 0;
        const absY = handle.top ?? 0;
        return [
          Number(((absX - offX) / canvas.width).toFixed(5)),
          Number(((absY - offY) / canvas.height).toFixed(5)),
        ] as [number, number];
      });

      onLayerUpdate(layerId, {
        mask: {
          ...latestLayer.mask,
          path: nextPath,
          editorPath: nextPath,
        },
      });
    };

    const createMaskPointHandles = (
      maskShape: FabricObject,
      layer: Layer,
      fabricObj: FabricObject
    ) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || layer.mask.path.length === 0) return;

      removeMaskHandles(fabricObj);

      const offX = (layer.mask.offset?.x ?? 0) * canvas.width;
      const offY = (layer.mask.offset?.y ?? 0) * canvas.height;

      const previousSelectionInfo =
        selectedMaskHandleInfoRef.current &&
        selectedMaskHandleInfoRef.current.layerId === layer.id
          ? selectedMaskHandleInfoRef.current
          : null;

      const handles: Circle[] = layer.mask.path.map(([nx, ny], index) => {
        const handle = new Circle({
          left: nx * canvas.width + offX,
          top: ny * canvas.height + offY,
          radius: 6,
          fill: MASK_HANDLE_COLOR,
          stroke: "#ffffff",
          strokeWidth: 2,
          originX: "center",
          originY: "center",
          hasBorders: false,
          hasControls: false,
          lockMovementX: false,
          lockMovementY: false,
          hoverCursor: layer.locked ? "not-allowed" : "move",
          selectable: !layer.locked && shouldShowMaskHandles(layer),
          evented: !layer.locked && shouldShowMaskHandles(layer),
          visible: shouldShowMaskHandles(layer),
        });

        (handle as any)._maskPointIndex = index;
        (handle as any)._isMaskHandle = true;
        (handle as any)._maskLayerId = layer.id;

        handle.on("mousedown", () => {
          if (canvasState?.tool === "mask" && !layer.locked) {
            selectMaskHandle(handle);
          }
        });

        const clampToCanvas = () => {
          if (!canvas) return;
          const half = handle.radius ?? 6;
          const minX = -canvas.width * 0.25;
          const maxX = canvas.width * 1.25;
          const minY = -canvas.height * 0.25;
          const maxY = canvas.height * 1.25;

          const clampedLeft = Math.min(
            Math.max(handle.left ?? 0, minX + half),
            maxX - half
          );
          const clampedTop = Math.min(
            Math.max(handle.top ?? 0, minY + half),
            maxY - half
          );
          handle.set({ left: clampedLeft, top: clampedTop });
        };

        handle.on("moving", () => {
          clampToCanvas();
          updateMaskVisualizationFromHandles(layer, maskShape, handles);
        });

        const commit = () => {
          clampToCanvas();
          updateMaskVisualizationFromHandles(layer, maskShape, handles);
          commitMaskHandlePositions(layer, handles, fabricObj);
          if (canvasState?.tool === "mask" && !layer.locked) {
            selectMaskHandle(handle);
          }
        };

        handle.on("mouseup", commit);

        canvas.add(handle);
        (handle as any).bringToFront?.();
        return handle;
      });

      (fabricObj as any)._maskPointHandles = handles;

      if (previousSelectionInfo) {
        const nextHandle = handles[previousSelectionInfo.index];
        if (nextHandle) {
          selectMaskHandle(nextHandle);
        } else {
          selectMaskHandle(null);
        }
      }
      canvas.requestRenderAll();
    };

    const deleteMaskHandle = (handle: Circle | null) => {
      if (!handle || !project) return;

      const layerId = (handle as any)._maskLayerId as string | undefined;
      if (!layerId) return;

      const layer = project.layers.find(
        (candidate) => candidate.id === layerId
      );
      if (!layer || layer.locked) return;

      const pointIndex = (handle as any)._maskPointIndex;
      if (typeof pointIndex !== "number") return;

      const basePath =
        layer.mask.editorPath && layer.mask.editorPath.length >= 3
          ? [...layer.mask.editorPath]
          : [...layer.mask.path];

      if (!basePath.length) return;

      const nextPath = basePath.filter((_, idx) => idx !== pointIndex);

      if (nextPath.length < 3) {
        onLayerUpdate(layerId, {
          mask: {
            ...layer.mask,
            enabled: false,
            path: [],
            editorPath: [],
          },
        });
      } else {
        onLayerUpdate(layerId, {
          mask: {
            ...layer.mask,
            path: nextPath,
            editorPath: nextPath,
          },
        });
      }

      selectMaskHandle(null);
    };

    const findClosestPointOnMask = (
      absolutePoints: [number, number][],
      target: { x: number; y: number }
    ) => {
      let bestIndex = -1;
      let bestDistance = Infinity;
      let bestPoint: [number, number] | null = null;

      for (let i = 0; i < absolutePoints.length; i++) {
        const start = absolutePoints[i];
        const end = absolutePoints[(i + 1) % absolutePoints.length];

        const segmentVectorX = end[0] - start[0];
        const segmentVectorY = end[1] - start[1];
        const segmentLengthSq = segmentVectorX ** 2 + segmentVectorY ** 2;

        let t = 0;
        if (segmentLengthSq > 0) {
          t =
            ((target.x - start[0]) * segmentVectorX +
              (target.y - start[1]) * segmentVectorY) /
            segmentLengthSq;
          t = Math.max(0, Math.min(1, t));
        }

        const closestPoint: [number, number] = [
          start[0] + segmentVectorX * t,
          start[1] + segmentVectorY * t,
        ];

        const distance = Math.hypot(
          target.x - closestPoint[0],
          target.y - closestPoint[1]
        );

        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
          bestPoint = closestPoint;
        }
      }

      return {
        index: bestIndex,
        distance: bestDistance,
        point: bestPoint,
      };
    };

    const isPointerNearMaskEdge = (
      layer: Layer,
      pointer: { x: number; y: number },
      canvas: Canvas
    ) => {
      if (!layer.mask.enabled) return false;

      const basePath =
        layer.mask.editorPath && layer.mask.editorPath.length >= 3
          ? layer.mask.editorPath
          : layer.mask.path;

      if (!basePath || basePath.length < 3) return false;

      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      if (!canvasWidth || !canvasHeight) return false;

      const offsetX = (layer.mask.offset?.x ?? 0) * canvasWidth;
      const offsetY = (layer.mask.offset?.y ?? 0) * canvasHeight;

      const absolutePoints: [number, number][] = basePath.map(([x, y]) => [
        x * canvasWidth + offsetX,
        y * canvasHeight + offsetY,
      ]);

      if (absolutePoints.length < 3) return false;

      const { distance } = findClosestPointOnMask(absolutePoints, pointer);
      return distance <= MASK_EDGE_INSERT_THRESHOLD;
    };

    const insertMaskPointAtPosition = (pointer: { x: number; y: number }) => {
      if (!project || !canvasState?.selectedLayerId) return;

      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const layer = project.layers.find(
        (candidate) => candidate.id === canvasState.selectedLayerId
      );
      if (!layer || layer.locked || !layer.mask.enabled) return;

      const basePath =
        layer.mask.editorPath && layer.mask.editorPath.length >= 3
          ? layer.mask.editorPath
          : layer.mask.path;

      if (!basePath || basePath.length < 3) return;

      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      if (!canvasWidth || !canvasHeight) return;

      const offsetX = (layer.mask.offset?.x ?? 0) * canvasWidth;
      const offsetY = (layer.mask.offset?.y ?? 0) * canvasHeight;

      const absolutePoints: [number, number][] = basePath.map(([x, y]) => [
        x * canvasWidth + offsetX,
        y * canvasHeight + offsetY,
      ]);

      if (absolutePoints.length < 3) return;

      const { index, distance, point } = findClosestPointOnMask(
        absolutePoints,
        pointer
      );

      if (index < 0 || !point || distance > MASK_EDGE_INSERT_THRESHOLD) {
        return;
      }

      const normalizedPoint: [number, number] = [
        Number(((point[0] - offsetX) / canvasWidth).toFixed(5)),
        Number(((point[1] - offsetY) / canvasHeight).toFixed(5)),
      ];

      const nextPath = [
        ...basePath.slice(0, index + 1),
        normalizedPoint,
        ...basePath.slice(index + 1),
      ];

      selectedMaskHandleInfoRef.current = {
        layerId: layer.id,
        index: index + 1,
      };

      onLayerUpdate(layer.id, {
        mask: {
          ...layer.mask,
          path: nextPath,
          editorPath: nextPath,
        },
      });
    };

    const configureMaskOverlay = (
      maskShape: FabricObject,
      layer: Layer,
      fabricObj: FabricObject
    ) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) {
        return;
      }

      const initialOffset = layer.mask.offset ?? { x: 0, y: 0 };
      (maskShape as any)._appliedOffset = { ...initialOffset };

      maskShape.hasBorders = true;
      maskShape.hasControls = false;
      maskShape.lockScalingX = true;
      maskShape.lockScalingY = true;
      maskShape.lockRotation = true;
      maskShape.objectCaching = true;
      maskShape.borderScaleFactor = 0.5;
      const inMaskMode = canvasState?.tool === "mask";
      const allowMaskDrag = !inMaskMode && !layer.locked;
      maskShape.hoverCursor = inMaskMode
        ? "default"
        : layer.locked
        ? "not-allowed"
        : "move";
      maskShape.evented = allowMaskDrag;
      maskShape.selectable = allowMaskDrag;
      (maskShape as any)._isMaskOverlay = true;
      (maskShape as any)._maskLayerId = layer.id;

      maskShape.off("mousedown");
      maskShape.off("moving");
      maskShape.off("modified");

      maskShape.on("mousedown", () => {
        (maskShape as any)._dragStart = {
          left: maskShape.left ?? 0,
          top: maskShape.top ?? 0,
        };
      });

      maskShape.on("moving", () => {
        if (!(maskShape as any)._dragStart) {
          (maskShape as any)._dragStart = {
            left: maskShape.left ?? 0,
            top: maskShape.top ?? 0,
          };
        }

        const snappedLeft = Math.round(maskShape.left || 0);
        const snappedTop = Math.round(maskShape.top || 0);

        if (snappedLeft !== maskShape.left || snappedTop !== maskShape.top) {
          maskShape.set({ left: snappedLeft, top: snappedTop });
        }
      });

      maskShape.on("modified", () => {
        const dragStart: { left: number; top: number } = (maskShape as any)
          ._dragStart ?? { left: 0, top: 0 };
        const currentLeft = maskShape.left ?? 0;
        const currentTop = maskShape.top ?? 0;

        const diffX = Math.round(currentLeft - dragStart.left);
        const diffY = Math.round(currentTop - dragStart.top);

        (maskShape as any)._dragStart = undefined;

        if (diffX === 0 && diffY === 0) {
          maskShape.set({ left: dragStart.left, top: dragStart.top });
          canvas.requestRenderAll();
          return;
        }

        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();

        if (!canvasWidth || !canvasHeight) {
          maskShape.set({ left: dragStart.left, top: dragStart.top });
          canvas.requestRenderAll();
          return;
        }

        const previousOffset =
          (maskShape as any)._appliedOffset ?? initialOffset;

        const nextOffset = {
          x: previousOffset.x + diffX / canvasWidth,
          y: previousOffset.y + diffY / canvasHeight,
        };

        (maskShape as any)._appliedOffset = nextOffset;

        const layerId = objectLayerMapRef.current.get(fabricObj);

        if (layerId) {
          const currentLayer =
            project?.layers.find((candidate) => candidate.id === layerId) ??
            layer;

          onLayerUpdate(layerId, {
            mask: {
              ...currentLayer.mask,
              offset: nextOffset,
              editorOffset: nextOffset,
            },
          });
        }

        maskShape.set({ left: 0, top: 0 });
        canvas.requestRenderAll();

        const handles: Circle[] | undefined = (fabricObj as any)
          ._maskPointHandles;
        if (handles?.length) {
          const offX = nextOffset.x * canvas.width;
          const offY = nextOffset.y * canvas.height;
          handles.forEach((handle, index) => {
            const point = layer.mask.path[index];
            if (!point) return;
            handle.set({
              left: point[0] * canvas.width + offX,
              top: point[1] * canvas.height + offY,
            });
          });
          canvas.requestRenderAll();
        }
      });

      createMaskPointHandles(maskShape, layer, fabricObj);
    };

    useImperativeHandle(ref, () => ({
      updateLayer: (layer: Layer) => {
        updateFabricLayer(layer);
      },
      removeLayer: (layerId: string) => {
        removeFabricLayer(layerId);
      },
      selectLayer: (layerId: string) => {
        selectFabricLayer(layerId);
      },
      clearSelection: () => {
        const canvas = fabricCanvasRef.current;
        if (canvas) {
          canvas.discardActiveObject();
          canvas.renderAll();
        }
      },
      exportCanvas: (scale = 1) => {
        return exportCanvasAsDataURL(scale);
      },
      cancelMaskDrawing: () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        if (maskDrawingRef.current.currentPolygon) {
          canvas.remove(maskDrawingRef.current.currentPolygon);
        }

        maskDrawingRef.current.pointCircles.forEach((circle) => {
          canvas.remove(circle);
        });

        maskDrawingRef.current = {
          isDrawing: false,
          points: [],
          pointCircles: [],
          currentPolygon: undefined,
          targetLayerId: undefined,
        };

        canvas.renderAll();
      },
      finishMaskDrawing: () => {
        const canvas = fabricCanvasRef.current;
        if (
          !canvas ||
          !maskDrawingRef.current.isDrawing ||
          !maskDrawingRef.current.targetLayerId
        )
          return;

        const points = maskDrawingRef.current.points;
        if (points.length < 3) {
          // Auto-cancel if not enough points
          return;
        }

        const normalizedPoints: [number, number][] = points.map((point) => [
          point.x / canvas.width,
          point.y / canvas.height,
        ]);

        onLayerUpdate(maskDrawingRef.current.targetLayerId!, {
          mask: {
            enabled: true,
            visible: true,
            path: normalizedPoints,
            feather: 2.0,
            smoothing: 0.4,
            offset: { x: 0, y: 0 },
          },
        });

        // Clean up
        if (maskDrawingRef.current.currentPolygon) {
          canvas.remove(maskDrawingRef.current.currentPolygon);
        }

        maskDrawingRef.current.pointCircles.forEach((circle) => {
          canvas.remove(circle);
        });

        maskDrawingRef.current = {
          isDrawing: false,
          points: [],
          pointCircles: [],
          currentPolygon: undefined,
          targetLayerId: undefined,
        };

        canvas.renderAll();

        // Notify parent that mask drawing is finished
        if (onMaskFinished) {
          onMaskFinished();
        }
      },
      getMaskDrawingState: () => ({
        isDrawing: maskDrawingRef.current.isDrawing,
        pointCount: maskDrawingRef.current.points.length,
      }),
    }));

    useEffect(() => {
      projectRef.current = project;
    }, [project]);

    useEffect(() => {
      if (!canvasRef.current || fabricCanvasRef.current) return;

      const canvas = new Canvas(canvasRef.current, {
        width: CANVAS_MAX_WIDTH,
        height: CANVAS_MAX_HEIGHT,
        backgroundColor: "#f0f0f0",
        enableRetinaScaling: false,
      });

      fabricCanvasRef.current = canvas;
      canvasZoomRef.current = Math.max(0.05, canvasState?.zoom ?? 1);
      canvasPanRef.current = normalizePan(canvasState?.pan ?? { x: 0, y: 0 });
      applyZoomAndPanToCanvas(
        canvas,
        canvasZoomRef.current,
        canvasPanRef.current
      );

      // Handle object modification events
      canvas.on("object:modified", (e) => {
        const obj = e.target;
        if (!obj) return;

        const layerId = objectLayerMapRef.current.get(obj);
        const currentProject = projectRef.current;
        if (!layerId || !currentProject) return;

        // Find the layer to get original image dimensions
        const layer = currentProject.layers.find((l) => l.id === layerId);
        if (!layer) return;

        // Calculate normalized scale values
        const calculateNormalizedScale = async () => {
          if (!layer.imageData) return;

          try {
            const img = await loadImageFromDataURL(layer.imageData);

            // Match the legacy calculation exactly
            // Legacy: scaledWidth = img.width * scaleX * (exportScale / displayScale)
            // We want: canvas.width * normalizedScaleX = img.width * scaleX * (exportScale / displayScale)
            // At export: canvas.width = project.base.width * exportScale
            // So: project.base.width * exportScale * normalizedScaleX = img.width * scaleX * (exportScale / displayScale)
            // Therefore: normalizedScaleX = (img.width * scaleX) / (project.base.width * displayScale)

            const maxWidth = CANVAS_MAX_WIDTH;
            const maxHeight = CANVAS_MAX_HEIGHT;
            const displayScale = Math.min(
              maxWidth / currentProject.base.width,
              maxHeight / currentProject.base.height,
              1
            );

            const normalizedScaleX =
              (img.width * (obj.scaleX || 1)) /
              (currentProject.base.width * displayScale);
            const normalizedScaleY =
              (img.height * (obj.scaleY || 1)) /
              (currentProject.base.height * displayScale);

            const normalizedTransform = {
              left: (obj.left || 0) / canvas.width,
              top: (obj.top || 0) / canvas.height,
              scaleX: obj.scaleX || 1,
              scaleY: obj.scaleY || 1,
              angle: obj.angle || 0,
              skewX: obj.skewX || 0,
              skewY: obj.skewY || 0,
              normalizedScaleX,
              normalizedScaleY,
            };

            onLayerUpdate(layerId, {
              transform: normalizedTransform,
            });
          } catch (error) {
            console.warn("Failed to calculate normalized scale:", error);
            // Fallback to old behavior
            const normalizedTransform = {
              left: (obj.left || 0) / canvas.width,
              top: (obj.top || 0) / canvas.height,
              scaleX: obj.scaleX || 1,
              scaleY: obj.scaleY || 1,
              angle: obj.angle || 0,
              skewX: obj.skewX || 0,
              skewY: obj.skewY || 0,
            };

            onLayerUpdate(layerId, {
              transform: normalizedTransform,
            });
          }
        };

        calculateNormalizedScale();
      });

      // Add additional debugging events for skew mode
      canvas.on("object:scaling", (e) => {
        // Additional event handling for skew mode can be added here if needed
      });

      canvas.on("object:skewing", (e) => {
        // Skewing events can be tracked here for debugging if needed
      });

      // Handle selection events
      canvas.on("selection:created", (e) => {
        const obj = e.selected?.[0];
        if (obj) {
          const layerId = objectLayerMapRef.current.get(obj);
          if (layerId && onLayerSelected) {
            // Notify parent that a layer has been selected on canvas
            onLayerSelected(layerId);
          }
        }
      });

      canvas.on("selection:updated", (e) => {
        const obj = e.selected?.[0];
        if (obj) {
          const layerId = objectLayerMapRef.current.get(obj);
          if (layerId && onLayerSelected) {
            // Notify parent that a different layer has been selected on canvas
            onLayerSelected(layerId);
          }
        }
      });

      return () => {
        canvas.dispose();
        fabricCanvasRef.current = null;
      };
    }, [onLayerUpdate]);

    // Update canvas when project changes
    useEffect(() => {
      if (!fabricCanvasRef.current) return;

      if (!project) {
        // Clear canvas when project is null (reset scenario)
        const canvas = fabricCanvasRef.current;
        canvas.clear();
        objectLayerMapRef.current.clear();
        return;
      }

      updateCanvasFromProject(project);
    }, [project]);

    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const nextZoom = Math.max(0.05, canvasState?.zoom ?? 1);
      const nextPan = normalizePan(canvasState?.pan ?? { x: 0, y: 0 });

      const currentZoom = canvasZoomRef.current ?? 1;
      const currentPan = canvasPanRef.current ?? { x: 0, y: 0 };

      const zoomChanged = Math.abs(currentZoom - nextZoom) > ZOOM_EPSILON;
      const panChanged = !pansAreClose(currentPan, nextPan);

      if (!zoomChanged && !panChanged) {
        return;
      }

      let effectivePan = nextPan;

      if (zoomChanged) {
        const adjustedPan = adjustPanForZoomChange(
          canvas,
          currentZoom,
          currentPan,
          nextZoom
        );

        if (!pansAreClose(adjustedPan, nextPan)) {
          if (onPanChange) {
            onPanChange(adjustedPan);
          }
          effectivePan = adjustedPan;
        } else {
          effectivePan = nextPan;
        }
      }

      canvasZoomRef.current = nextZoom;
      canvasPanRef.current = normalizePan(effectivePan);
      applyZoomAndPanToCanvas(canvas, nextZoom, canvasPanRef.current);
    }, [canvasState?.zoom, canvasState?.pan, onPanChange]);

    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      if (canvasState?.tool === "pan") {
        if (!previousInteractionStateRef.current) {
          previousInteractionStateRef.current = {
            skipTargetFind: canvas.skipTargetFind,
            selection: canvas.selection,
            defaultCursor: canvas.defaultCursor,
            hoverCursor: canvas.hoverCursor,
          };
        }

        canvas.skipTargetFind = true;
        canvas.selection = false;
        canvas.defaultCursor = "grab";
        canvas.hoverCursor = "grab";
        canvas.setCursor("grab");
      } else if (previousInteractionStateRef.current) {
        const previous = previousInteractionStateRef.current;
        canvas.skipTargetFind = previous.skipTargetFind;
        canvas.selection = previous.selection;
        canvas.defaultCursor = previous.defaultCursor;
        canvas.hoverCursor = previous.hoverCursor;
        canvas.setCursor(previous.defaultCursor || "default");
        previousInteractionStateRef.current = null;
      }
    }, [canvasState?.tool]);

    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      let isPanning = false;
      let lastPosition: { x: number; y: number } | null = null;

      const getClientPosition = (
        event?: MouseEvent | PointerEvent | TouchEvent
      ): { x: number; y: number } | null => {
        if (!event) {
          return null;
        }

        if ("touches" in event) {
          const activeTouch = event.touches[0] || event.changedTouches?.[0];
          if (!activeTouch) {
            return null;
          }
          return { x: activeTouch.clientX, y: activeTouch.clientY };
        }

        const clientEvent = event as MouseEvent | PointerEvent;
        if (clientEvent.clientX === undefined || clientEvent.clientY === undefined) {
          return null;
        }

        return { x: clientEvent.clientX, y: clientEvent.clientY };
      };

      const updatePanFromPosition = (position: { x: number; y: number }) => {
        if (!lastPosition) {
          return;
        }

        const deltaX = position.x - lastPosition.x;
        const deltaY = position.y - lastPosition.y;

        if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
          return;
        }

        const currentPan = canvasPanRef.current ?? { x: 0, y: 0 };
        const updatedPan = normalizePan({
          x: currentPan.x + deltaX,
          y: currentPan.y + deltaY,
        });

        canvasPanRef.current = updatedPan;
        lastPosition = position;

        applyZoomAndPanToCanvas(canvas, canvas.getZoom(), updatedPan);

        if (onPanChange) {
          onPanChange(updatedPan);
        }
      };

      const handleMouseDown = (e: any) => {
        if (canvasState?.tool !== "pan") return;

        const event = e.e as MouseEvent | PointerEvent | TouchEvent | undefined;
        const position = getClientPosition(event);
        if (!position) return;

        isPanning = true;
        lastPosition = position;
        canvas.discardActiveObject();
        canvas.setCursor("grabbing");
        event?.preventDefault?.();
        event?.stopPropagation?.();

        window.addEventListener("mousemove", handleWindowMouseMove);
        window.addEventListener("mouseup", handleWindowMouseUp);
        window.addEventListener("touchmove", handleWindowTouchMove, { passive: false });
        window.addEventListener("touchend", handleWindowTouchEnd);
      };

      const handleMouseMove = (e: any) => {
        if (!isPanning || canvasState?.tool !== "pan") return;

        const event = e.e as MouseEvent | PointerEvent | TouchEvent | undefined;
        const position = getClientPosition(event);
        if (!position) return;

        updatePanFromPosition(position);
      };

      const handleWindowMouseMove = (event: MouseEvent | PointerEvent) => {
        if (!isPanning || canvasState?.tool !== "pan") return;
        const position = getClientPosition(event);
        if (!position) return;

        updatePanFromPosition(position);
      };

      const handleWindowTouchMove = (event: TouchEvent) => {
        if (!isPanning || canvasState?.tool !== "pan") return;
        const position = getClientPosition(event);
        if (!position) return;

        event.preventDefault();
        updatePanFromPosition(position);
      };

      const endPan = () => {
        if (!isPanning) return;
        isPanning = false;
        lastPosition = null;

        if (canvasState?.tool === "pan") {
          canvas.setCursor("grab");
        }

        window.removeEventListener("mousemove", handleWindowMouseMove);
        window.removeEventListener("mouseup", handleWindowMouseUp);
        window.removeEventListener("touchmove", handleWindowTouchMove);
        window.removeEventListener("touchend", handleWindowTouchEnd);
      };

      const handleMouseUp = () => {
        endPan();
      };

      const handleWindowMouseUp = () => {
        endPan();
      };

      const handleWindowTouchEnd = () => {
        endPan();
      };

      canvas.on("mouse:down", handleMouseDown);
      canvas.on("mouse:move", handleMouseMove);
      canvas.on("mouse:up", handleMouseUp);

      return () => {
        canvas.off("mouse:down", handleMouseDown);
        canvas.off("mouse:move", handleMouseMove);
        canvas.off("mouse:up", handleMouseUp);
        endPan();
      };
    }, [canvasState?.tool, onPanChange]);

    // Update individual layer properties when they change (with optimized dependencies)
    useEffect(() => {
      if (!project || !fabricCanvasRef.current) return;

      const canvas = fabricCanvasRef.current;
      const layerObjects = canvas
        .getObjects()
        .filter((obj) => objectLayerMapRef.current.has(obj));

      // Only update if canvas has been built and we have layers
      if (layerObjects.length > 0) {
        project.layers.forEach((layer) => {
          const fabricObj = layerObjects.find(
            (obj) => objectLayerMapRef.current.get(obj) === layer.id
          );
          if (fabricObj) {
            // Update the fabric object properties directly without rebuilding
            fabricObj.set({
              left: layer.transform.left * canvas.width,
              top: layer.transform.top * canvas.height,
              scaleX: layer.transform.scaleX,
              scaleY: layer.transform.scaleY,
              angle: layer.transform.angle,
              skewX: layer.transform.skewX || 0,
              skewY: layer.transform.skewY || 0,
              opacity: layer.opacity,
              visible: layer.visible,
              selectable: !layer.locked,
              evented: !layer.locked,
              lockMovementX: layer.locked,
              lockMovementY: layer.locked,
              lockRotation: layer.locked,
              lockScalingX: layer.locked,
              lockScalingY: layer.locked,
              lockSkewingX: layer.locked,
              lockSkewingY: layer.locked,
            });

            // Reapply transform mode settings after layer update
            applyTransformModeToObject(fabricObj, layer);

            // Also update mask visualization for this layer
            updateFabricLayer(layer);
          }
        });

        canvas.requestRenderAll();
      }
    }, [project?.layers]); // Simplified dependency

    // Update transform controls when mode changes
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();

      objects.forEach((obj, index) => {
        const layerId = objectLayerMapRef.current.get(obj);
        const layer = project?.layers.find((l) => l.id === layerId);

        if (layer) {
          applyTransformModeToObject(obj, layer);
        }
      });

      canvas.renderAll();
    }, [transformMode, project]);

    // Handle tool changes
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      if (canvasState?.tool === "mask") {
        // Disable object selection when in mask mode
        canvas.selection = false;
        canvas.defaultCursor = "crosshair";
        canvas.hoverCursor = "crosshair";

        // Make objects non-selectable and non-evented so they don't interfere with mask drawing
        const objects = canvas.getObjects();
        objects.forEach((obj) => {
          if (objectLayerMapRef.current.has(obj)) {
            obj.selectable = false;
            obj.evented = false; // Disable events so they don't block canvas mouse events
            obj.visible = true; // Explicitly ensure visibility

            const layerId = objectLayerMapRef.current.get(obj);
            const layer = project?.layers.find((l) => l.id === layerId);
            const handles: Circle[] | undefined = (obj as any)
              ._maskPointHandles;
            const showHandles = shouldShowMaskHandles(layer);
            handles?.forEach((handle) => {
              handle.visible = showHandles;
              handle.evented = showHandles;
              handle.selectable = showHandles;
            });

            const maskShape = (obj as any)._maskPolygon as
              | FabricObject
              | undefined;
            if (maskShape) {
              maskShape.evented = false;
              maskShape.selectable = false;
              maskShape.hoverCursor = "default";
            }
          } else if ((obj as any)._isMaskOverlay) {
            obj.evented = false;
            obj.selectable = false;
            obj.hoverCursor = "default";
          }
        });
      } else if (canvasState?.tool === "pan") {
        canvas.selection = false;
        canvas.defaultCursor = "grab";
        canvas.hoverCursor = "grab";

        const objects = canvas.getObjects();
        objects.forEach((obj) => {
          if (objectLayerMapRef.current.has(obj)) {
            obj.selectable = false;
            obj.evented = false;

            const handles: Circle[] | undefined = (obj as any)
              ._maskPointHandles;
            handles?.forEach((handle) => {
              handle.visible = false;
              handle.evented = false;
              handle.selectable = false;
            });

            const maskShape = (obj as any)._maskPolygon as
              | FabricObject
              | undefined;
            if (maskShape) {
              maskShape.evented = false;
              maskShape.selectable = false;
              maskShape.hoverCursor = "default";
            }
          } else if ((obj as any)._isMaskOverlay) {
            obj.evented = false;
            obj.selectable = false;
            obj.hoverCursor = "default";
          }
        });
      } else {
        // Clean up any active mask drawing when switching away from mask tool
        if (maskDrawingRef.current.isDrawing) {
          if (maskDrawingRef.current.currentPolygon) {
            canvas.remove(maskDrawingRef.current.currentPolygon);
          }

          maskDrawingRef.current.pointCircles.forEach((circle) => {
            canvas.remove(circle);
          });

          maskDrawingRef.current = {
            isDrawing: false,
            points: [],
            pointCircles: [],
            currentPolygon: undefined,
            targetLayerId: undefined,
          };
        }
        // Enable object selection in select mode
        canvas.selection = true;
        canvas.defaultCursor = "default";
        canvas.hoverCursor = "move";

        const objects = canvas.getObjects();
        objects.forEach((obj) => {
          // Only make layer objects selectable, not mask polygons or drawing objects
          if (objectLayerMapRef.current.has(obj)) {
            obj.selectable = true;
            obj.evented = true;

            const handles: Circle[] | undefined = (obj as any)
              ._maskPointHandles;
            handles?.forEach((handle) => {
              handle.visible = false;
              handle.evented = false;
              handle.selectable = false;
            });

            const layerId = objectLayerMapRef.current.get(obj);
            const layer = project?.layers.find((l) => l.id === layerId);
            const maskShape = (obj as any)._maskPolygon as
              | FabricObject
              | undefined;
            if (maskShape) {
              const allowMaskDrag =
                !!layer &&
                !layer.locked &&
                layer.mask.enabled &&
                layer.mask.visible;
              maskShape.evented = allowMaskDrag;
              maskShape.selectable = allowMaskDrag;
              maskShape.hoverCursor = allowMaskDrag
                ? "move"
                : layer?.locked
                ? "not-allowed"
                : "default";
            }
          } else if ((obj as any)._isMaskOverlay) {
            const layerId = (obj as any)._maskLayerId as string | undefined;
            const layer = project?.layers.find((l) => l.id === layerId);
            const allowMaskDrag =
              !!layer &&
              !layer.locked &&
              layer.mask.enabled &&
              layer.mask.visible;
            obj.evented = allowMaskDrag;
            obj.selectable = allowMaskDrag;
            obj.hoverCursor = allowMaskDrag
              ? "move"
              : layer?.locked
              ? "not-allowed"
              : "default";
          }
        });
      }

      canvas.requestRenderAll();
    }, [canvasState?.tool, project]);

    // Helper function to notify parent of mask state changes
    const notifyMaskStateChange = () => {
      if (onMaskStateChange) {
        onMaskStateChange({
          isDrawing: maskDrawingRef.current.isDrawing,
          pointCount: maskDrawingRef.current.points.length,
        });
      }
    };

    // Consolidated mask drawing helper functions
    const finishMask = () => {
      const canvas = fabricCanvasRef.current;
      if (
        !canvas ||
        !maskDrawingRef.current.isDrawing ||
        !maskDrawingRef.current.targetLayerId
      )
        return;

      const points = maskDrawingRef.current.points;
      if (points.length < 3) {
        cancelMask();
        return;
      }

      // Convert points to normalized coordinates (0-1 range)
      const normalizedPoints: [number, number][] = points.map((point) => [
        point.x / canvas.width,
        point.y / canvas.height,
      ]);

      // Update layer with mask data
      onLayerUpdate(maskDrawingRef.current.targetLayerId!, {
        mask: {
          enabled: true,
          visible: true,
          path: normalizedPoints,
          feather: 2.0,
          smoothing: 0.4,
          offset: { x: 0, y: 0 },
          editorPath: normalizedPoints,
          editorSmoothing: 0.4,
          editorOffset: { x: 0, y: 0 },
        },
      });

      // Clean up
      if (maskDrawingRef.current.currentPolygon) {
        canvas.remove(maskDrawingRef.current.currentPolygon);
      }

      // Remove point circles
      maskDrawingRef.current.pointCircles.forEach((circle) => {
        canvas.remove(circle);
      });

      maskDrawingRef.current = {
        isDrawing: false,
        points: [],
        pointCircles: [],
        currentPolygon: undefined,
        targetLayerId: undefined,
      };

      canvas.renderAll();
      notifyMaskStateChange();

      // Notify parent that mask drawing is finished
      if (onMaskFinished) {
        onMaskFinished();
      }
    };

    const cancelMask = () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      if (maskDrawingRef.current.currentPolygon) {
        canvas.remove(maskDrawingRef.current.currentPolygon);
      }

      // Remove point circles
      maskDrawingRef.current.pointCircles.forEach((circle) => {
        canvas.remove(circle);
      });

      maskDrawingRef.current = {
        isDrawing: false,
        points: [],
        pointCircles: [],
        currentPolygon: undefined,
        targetLayerId: undefined,
      };

      canvas.renderAll();
      notifyMaskStateChange();
    };

    // Handle mask drawing events
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const handleMouseDown = (e: any) => {
        if (canvasState?.tool === "mask" && canvasState?.selectedLayerId) {
          const target = e.target as FabricObject | undefined;

          if (target) {
            if ((target as any)._isMaskHandle) {
              return; // interacting with existing handle
            }

            if ((target as any)._isMaskOverlay) {
              return; // interacting with mask overlay (offset drag)
            }
          }

          // Check if the selected layer is locked
          const selectedLayer = project?.layers.find(
            (l) => l.id === canvasState.selectedLayerId
          );
          if (selectedLayer?.locked) {
            // Cannot draw mask on locked layer - skip point addition
            return;
          }

          const pointer = canvas.getPointer(e.e);
          const point = { x: pointer.x, y: pointer.y };

          if (!maskDrawingRef.current.isDrawing) {
            if (
              selectedLayer &&
              selectedLayer.mask &&
              isPointerNearMaskEdge(selectedLayer, point, canvas)
            ) {
              return;
            }
            // Start new mask
            maskDrawingRef.current.isDrawing = true;
            maskDrawingRef.current.points = [point];
            maskDrawingRef.current.pointCircles = [];
            maskDrawingRef.current.targetLayerId = canvasState.selectedLayerId;

            // Add first point circle
            const pointCircle = new Circle({
              left: point.x,
              top: point.y,
              radius: 4,
              fill: "#ff0000",
              stroke: "#ffffff",
              strokeWidth: 2,
              selectable: false,
              evented: false,
              originX: "center",
              originY: "center",
            });

            maskDrawingRef.current.pointCircles.push(pointCircle);
            canvas.add(pointCircle);

            // Create preview polygon - start with just the first point
            const polygon = new Polygon([point], {
              fill: "rgba(255, 100, 100, 0.2)",
              stroke: "#ff6666",
              strokeWidth: 2,
              strokeDashArray: [5, 5],
              selectable: false,
              evented: false,
            });

            maskDrawingRef.current.currentPolygon = polygon;
            canvas.add(polygon);
            canvas.renderAll();
            notifyMaskStateChange();
          } else {
            // Add point to current mask
            maskDrawingRef.current.points.push(point);

            // Add point circle
            const pointCircle = new Circle({
              left: point.x,
              top: point.y,
              radius: 4,
              fill: "#ff0000",
              stroke: "#ffffff",
              strokeWidth: 2,
              selectable: false,
              evented: false,
              originX: "center",
              originY: "center",
            });

            maskDrawingRef.current.pointCircles.push(pointCircle);
            canvas.add(pointCircle);

            // Update preview polygon
            if (maskDrawingRef.current.currentPolygon) {
              // Update the polygon with all current points
              if (maskDrawingRef.current.points.length >= 2) {
                // Show line or polygon preview starting from 2 points
                maskDrawingRef.current.currentPolygon.set({
                  points: maskDrawingRef.current.points,
                });
              }
            }
            canvas.renderAll();
            notifyMaskStateChange();
          }
        }
      };

      const handleMouseMove = (e: any) => {
        if (
          canvasState?.tool === "mask" &&
          maskDrawingRef.current.isDrawing &&
          maskDrawingRef.current.points.length > 0
        ) {
          const pointer = canvas.getPointer(e.e);
          const currentPoints = [
            ...maskDrawingRef.current.points,
            { x: pointer.x, y: pointer.y },
          ];

          if (maskDrawingRef.current.currentPolygon) {
            maskDrawingRef.current.currentPolygon.set({
              points: currentPoints,
            });
            canvas.renderAll();
          }
        }
      };

      const handleDoubleClick = (e: any) => {
        if (canvasState?.tool !== "mask") return;

        if (maskDrawingRef.current.isDrawing) {
          finishMask();
          return;
        }

        const target = e.target as FabricObject | undefined;
        if (target) {
          if ((target as any)._isMaskHandle || (target as any)._isMaskOverlay) {
            return;
          }
        }

        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        const pointer = canvas.getPointer(e.e);
        insertMaskPointAtPosition(pointer);
      };

      const handleRightClick = (e: any) => {
        if (
          canvasState?.tool === "mask" &&
          maskDrawingRef.current.isDrawing &&
          (e.e as MouseEvent).button === 2
        ) {
          cancelMask();
        }
      };

      const handleContextMenu = (e: Event) => {
        if (canvasState?.tool === "mask" && maskDrawingRef.current.isDrawing) {
          e.preventDefault();
        }
      };

      // Add event listeners
      canvas.on("mouse:down", handleMouseDown);
      canvas.on("mouse:move", handleMouseMove);
      canvas.on("mouse:dblclick", handleDoubleClick);
      canvas.on("mouse:down", handleRightClick);

      const canvasElement = canvasRef.current;
      if (canvasElement) {
        canvasElement.addEventListener("contextmenu", handleContextMenu);
      }

      // Cleanup
      return () => {
        canvas.off("mouse:down", handleMouseDown);
        canvas.off("mouse:move", handleMouseMove);
        canvas.off("mouse:dblclick", handleDoubleClick);
        canvas.off("mouse:down", handleRightClick);

        if (canvasElement) {
          canvasElement.removeEventListener("contextmenu", handleContextMenu);
        }
      };
    }, [
      canvasState?.tool,
      canvasState?.selectedLayerId,
      onLayerUpdate,
      project,
    ]);

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (canvasState?.tool !== "mask") return;

        const selectedHandle = selectedMaskHandleRef.current;
        if (!selectedHandle) return;

        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement) {
          const tagName = activeElement.tagName;
          if (
            tagName === "INPUT" ||
            tagName === "TEXTAREA" ||
            tagName === "SELECT" ||
            activeElement.isContentEditable
          ) {
            return;
          }
        }

        const handleLayerId = (selectedHandle as any)._maskLayerId as
          | string
          | undefined;
        if (!handleLayerId || handleLayerId !== canvasState?.selectedLayerId) {
          return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          deleteMaskHandle(selectedHandle);
        } else if (event.key === "Escape") {
          selectMaskHandle(null);
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [
      canvasState?.tool,
      canvasState?.selectedLayerId,
      project,
      onLayerUpdate,
    ]);

    useEffect(() => {
      if (canvasState?.tool !== "mask" && selectedMaskHandleRef.current) {
        selectMaskHandle(null);
      }
    }, [canvasState?.tool]);

    useEffect(() => {
      const currentHandle = selectedMaskHandleRef.current;
      if (!currentHandle) return;

      const handleLayerId = (currentHandle as any)._maskLayerId as
        | string
        | undefined;
      if (handleLayerId && handleLayerId !== canvasState?.selectedLayerId) {
        selectMaskHandle(null);
      }
    }, [canvasState?.selectedLayerId]);

    const updateCanvasFromProject = async (project: Project) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      // Check if we actually need to rebuild
      const needsRebuild =
        lastProjectRef.current.baseImageData !== project.base.imageData ||
        lastProjectRef.current.layerCount !== project.layers.length ||
        !canvas.backgroundImage; // Always rebuild if no background image

      if (!needsRebuild) {
        return;
      }

      // Update tracking
      lastProjectRef.current = {
        baseImageData: project.base.imageData,
        layerCount: project.layers.length,
      };

      // Clear existing objects but preserve mask drawing elements if any
      const maskElements: FabricObject[] = [];
      if (maskDrawingRef.current.isDrawing) {
        // Preserve mask drawing elements
        if (maskDrawingRef.current.currentPolygon) {
          maskElements.push(maskDrawingRef.current.currentPolygon);
        }
        maskElements.push(...maskDrawingRef.current.pointCircles);
      }

      canvas.clear();
      objectLayerMapRef.current.clear();

      // Re-add preserved mask drawing elements
      maskElements.forEach((element) => {
        canvas.add(element);
      });

      // Set canvas size based on base image dimensions
      const maxWidth = CANVAS_MAX_WIDTH;
      const maxHeight = CANVAS_MAX_HEIGHT;
      const scale = Math.min(
        maxWidth / project.base.width,
        maxHeight / project.base.height,
        1
      );

      const newWidth = project.base.width * scale;
      const newHeight = project.base.height * scale;

      // Only resize if dimensions actually changed
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.setWidth(newWidth);
        canvas.setHeight(newHeight);
      }

      // Add base image as background
      if (project.base.imageData) {
        try {
          console.log("Loading base image...");
          const img = await loadImageFromDataURL(project.base.imageData);
          const fabricImage = new FabricImage(img, {
            scaleX: scale,
            scaleY: scale,
            originX: "left",
            originY: "top",
          });
          canvas.backgroundImage = fabricImage;
          console.log("Background image set, rendering...");
          canvas.renderAll();
        } catch (error) {
          console.error("Error loading base image:", error);
        }
      }

      // Add overlay layers
      for (const layer of project.layers) {
        if (layer.visible && layer.imageData) {
          await addLayerToCanvas(layer, scale);
        }
      }

      applyZoomAndPanToCanvas(
        canvas,
        canvasZoomRef.current ?? 1,
        canvasPanRef.current
      );
    };

    const addLayerToCanvas = async (layer: Layer, scale: number) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !layer.imageData) return;

      try {
        const img = await loadImageFromDataURL(layer.imageData);
        const fabricImg = new FabricImage(img, {
          left: layer.transform.left * canvas.width,
          top: layer.transform.top * canvas.height,
          scaleX: layer.transform.scaleX,
          scaleY: layer.transform.scaleY,
          angle: layer.transform.angle,
          skewX: layer.transform.skewX || 0,
          skewY: layer.transform.skewY || 0,
          opacity: layer.opacity,
          originX: "center",
          originY: "center",
          selectable: !layer.locked,
          evented: !layer.locked,
          lockMovementX: layer.locked,
          lockMovementY: layer.locked,
          lockRotation: layer.locked,
          lockScalingX: layer.locked,
          lockScalingY: layer.locked,
          lockSkewingX: layer.locked,
          lockSkewingY: layer.locked,
        });

        // Store layer ID mapping
        objectLayerMapRef.current.set(fabricImg, layer.id);

        // Apply transform mode settings immediately using helper function
        applyTransformModeToObject(fabricImg, layer);

        canvas.add(fabricImg);

        // Add mask visualization if mask is enabled and visible
        if (
          layer.mask.enabled &&
          layer.mask.visible &&
          layer.mask.path.length > 0
        ) {
          const offX = (layer.mask.offset?.x ?? 0) * canvas.width;
          const offY = (layer.mask.offset?.y ?? 0) * canvas.height;
          const absPoints: [number, number][] = layer.mask.path.map(
            ([x, y]) =>
              [x * canvas.width + offX, y * canvas.height + offY] as [
                number,
                number
              ]
          );

          const smoothing = layer.mask.smoothing ?? 0;
          let maskShape: FabricObject;
          if (smoothing > 0 && absPoints.length >= 3) {
            const d = MaskRenderer.toSmoothedClosedPathD(absPoints, smoothing);
            // Use Path for smoothed preview
            const path = new Path(d, {
              fill: "rgba(0, 255, 0, 0.2)",
              stroke: "#00ff00",
              strokeWidth: 1,
              // solid stroke for performance
              selectable: !layer.locked,
              evented: !layer.locked,
            });
            maskShape = path as FabricObject;
          } else {
            const maskPoints = absPoints.map(([x, y]) => ({ x, y }));
            maskShape = new Polygon(maskPoints as any, {
              fill: "rgba(0, 255, 0, 0.2)",
              stroke: "#00ff00",
              strokeWidth: 1,
              // solid stroke for performance
              selectable: !layer.locked,
              evented: !layer.locked,
            }) as unknown as FabricObject;
          }

          // Store reference to mask overlay for this layer
          (fabricImg as any)._maskPolygon = maskShape;
          configureMaskOverlay(maskShape, layer, fabricImg);
          canvas.add(maskShape);
        }

        canvas.renderAll();
      } catch (error) {
        console.error("Error adding layer to canvas:", error);
      }
    };

    const updateFabricLayer = (layer: Layer) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      // Find the fabric object for this layer
      const objects = canvas.getObjects();
      const fabricObj = objects.find(
        (obj) => objectLayerMapRef.current.get(obj) === layer.id
      );

      if (fabricObj) {
        // Update properties without triggering multiple renders
        fabricObj.set({
          left: layer.transform.left * canvas.width,
          top: layer.transform.top * canvas.height,
          scaleX: layer.transform.scaleX,
          scaleY: layer.transform.scaleY,
          angle: layer.transform.angle,
          skewX: layer.transform.skewX || 0,
          skewY: layer.transform.skewY || 0,
          opacity: layer.opacity,
          visible: layer.visible,
          selectable: !layer.locked,
          evented: !layer.locked,
          lockMovementX: layer.locked,
          lockMovementY: layer.locked,
          lockRotation: layer.locked,
          lockScalingX: layer.locked,
          lockScalingY: layer.locked,
          lockSkewingX: layer.locked,
          lockSkewingY: layer.locked,
        });

        // Update mask visualization
        const existingMaskPolygon = (fabricObj as any)._maskPolygon;
        if (existingMaskPolygon) {
          canvas.remove(existingMaskPolygon);
          (fabricObj as any)._maskPolygon = undefined;
        }

        removeMaskHandles(fabricObj);

        if (
          layer.mask.enabled &&
          layer.mask.visible &&
          layer.mask.path.length > 0
        ) {
          const offX = (layer.mask.offset?.x ?? 0) * canvas.width;
          const offY = (layer.mask.offset?.y ?? 0) * canvas.height;
          const absPoints: [number, number][] = layer.mask.path.map(
            ([x, y]) =>
              [x * canvas.width + offX, y * canvas.height + offY] as [
                number,
                number
              ]
          );

          const smoothing = layer.mask.smoothing ?? 0;
          let maskShape: FabricObject;
          if (smoothing > 0 && absPoints.length >= 3) {
            const d = MaskRenderer.toSmoothedClosedPathD(absPoints, smoothing);
            const path = new Path(d, {
              fill: "rgba(0, 255, 0, 0.2)",
              stroke: "#00ff00",
              strokeWidth: 1,
              // solid stroke for performance
              selectable: !layer.locked,
              evented: !layer.locked,
            });
            maskShape = path as FabricObject;
          } else {
            const maskPoints = absPoints.map(([x, y]) => ({ x, y }));
            maskShape = new Polygon(maskPoints as any, {
              fill: "rgba(0, 255, 0, 0.2)",
              stroke: "#00ff00",
              strokeWidth: 1,
              // solid stroke for performance
              selectable: !layer.locked,
              evented: !layer.locked,
            }) as unknown as FabricObject;
          }

          (fabricObj as any)._maskPolygon = maskShape;
          configureMaskOverlay(maskShape, layer, fabricObj);
          canvas.add(maskShape);
        }

        // Use requestAnimationFrame to batch renders
        requestAnimationFrame(() => {
          canvas.renderAll();
        });
      }
    };

    const removeFabricLayer = (layerId: string) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();
      const fabricObj = objects.find(
        (obj) => objectLayerMapRef.current.get(obj) === layerId
      );

      if (fabricObj) {
        // Remove associated mask polygon if it exists
        const maskPolygon = (fabricObj as any)._maskPolygon;
        if (maskPolygon) {
          canvas.remove(maskPolygon);
        }

        removeMaskHandles(fabricObj);

        canvas.remove(fabricObj);
        objectLayerMapRef.current.delete(fabricObj);
        canvas.renderAll();
      }
    };

    const selectFabricLayer = (layerId: string) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      // Clear current selection first
      canvas.discardActiveObject();

      const objects = canvas.getObjects();
      const fabricObj = objects.find(
        (obj) => objectLayerMapRef.current.get(obj) === layerId
      );

      if (fabricObj) {
        canvas.setActiveObject(fabricObj);
        console.log(`Selected fabric object for layer: ${layerId}`);
      } else {
        console.log(`No fabric object found for layer: ${layerId}`);
      }

      canvas.renderAll();
    };

    const exportCanvasAsDataURL = async (
      scale: number = 1
    ): Promise<string> => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return "";

      return canvas.toDataURL({
        format: "png" as const,
        quality: 1.0,
        multiplier: scale,
        withoutTransform: true,
      });
    };

    const loadImageFromDataURL = (
      dataURL: string
    ): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        // Validate data URL format
        if (!dataURL || typeof dataURL !== "string") {
          console.error("Invalid data URL:", dataURL);
          reject(new Error("Invalid data URL: not a string"));
          return;
        }

        if (!dataURL.startsWith("data:image/")) {
          reject(new Error("Invalid data URL: not an image data URL"));
          return;
        }

        const img = new Image();

        img.onload = () => {
          console.log("Image loaded successfully:", {
            width: img.width,
            height: img.height,
            src: dataURL.substring(0, 50) + "...",
          });
          resolve(img);
        };

        img.onerror = (error) => {
          console.error("Failed to load image from data URL:", {
            error,
            dataURLStart: dataURL.substring(0, 100) + "...",
            dataURLLength: dataURL.length,
          });
          reject(error);
        };

        img.src = dataURL;
      });
    };

    return (
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="border shadow-lg max-w-full max-h-full"
        />
      </div>
    );
  }
);

FabricCanvas.displayName = "FabricCanvas";

export default FabricCanvas;
