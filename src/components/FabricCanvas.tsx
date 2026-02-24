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
  Text,
} from "fabric";
import { Project, Layer, CanvasState, DetectedMask } from "@/types";
import { CANVAS_MAX_WIDTH, CANVAS_MAX_HEIGHT } from "@/constants/canvas";
import { MaskRenderer } from "@/utils/mask";

const MASK_HANDLE_RADIUS = 3;
const MASK_HANDLE_COLOR = "rgba(0, 168, 107, 0.5)";
const MASK_HANDLE_SELECTED_COLOR = "#f97316";
const MASK_EDGE_INSERT_THRESHOLD = 25;
const MASK_OVERLAY_FILL = "rgba(0, 255, 0, 0.2)";
const MASK_OVERLAY_STROKE = "#00ff00";
const MASK_OVERLAY_STROKE_WIDTH = 1;

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
  onZoomChange?: (zoom: number) => void;
  minZoom?: number;
  maxZoom?: number;
  detectedMasks?: DetectedMask[];
  showDetections?: boolean;
  onDetectionClick?: (maskId: string) => void;
  colorPickMode?: boolean;
  onColorPick?: (point: { x: number; y: number }) => void;
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
  resetZoomAndPan: () => void;
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
      onZoomChange,
      minZoom,
      maxZoom,
      detectedMasks = [],
      showDetections = false,
      onDetectionClick,
      colorPickMode = false,
      onColorPick,
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<Canvas | null>(null);
    const objectLayerMapRef = useRef<Map<FabricObject, string>>(new Map());
    const dragOpacityMapRef = useRef<Map<FabricObject, number>>(new Map());
    const lastDraggedObjectRef = useRef<FabricObject | null>(null);
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
      defaultCursor: string;
      hoverCursor: string;
    } | null>(null);
    const skipCanvasStateSyncRef = useRef(0);
    const isSpaceKeyDownRef = useRef(false);
    const zoomDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const lastProjectRef = useRef<{
      baseImageData: string | undefined;
      layerCount: number;
    }>({ baseImageData: undefined, layerCount: 0 });
    const projectRef = useRef<Project | null>(project);
    const canvasStateRef = useRef(canvasState);
    const onLayerUpdateRef = useRef(onLayerUpdate);
    const onLayerSelectedRef = useRef(onLayerSelected);

    const PAN_PRECISION = 2;
    const ZOOM_EPSILON = 0.0001;
    const PAN_EPSILON = 0.1;

    const normalizePan = (pan: { x: number; y: number }) => ({
      x: Number(pan.x.toFixed(PAN_PRECISION)),
      y: Number(pan.y.toFixed(PAN_PRECISION)),
    });

    const pansAreClose = (
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => {
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
        canvasState?.selectedLayerId === layer.id &&
        layer.mask.enabled &&
        layer.mask.visible &&
        layer.mask.path.length > 0
      );
    };

    const selectMaskHandle = (handle: Circle | null) => {
      const canvas = fabricCanvasRef.current;
      const previous = selectedMaskHandleRef.current;

      // Prevent re-entrant calls if already selecting the same handle
      if (previous === handle) {
        return;
      }

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
      if (canvas && canvas.bringObjectToFront) {
        canvas.bringObjectToFront(handle);
      }
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
          selectedMaskHandleInfoRef.current = null;
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

    const bringMaskHandlesToFront = (fabricObj: FabricObject) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const handles: Circle[] | undefined = (fabricObj as any)
        ._maskPointHandles;
      if (!handles?.length) {
        return;
      }

      handles.forEach((handle) => {
        if (canvas.bringObjectToFront) {
          canvas.bringObjectToFront(handle);
        }
      });

      canvas.requestRenderAll();
    };

    const getMaskAbsolutePoints = (
      layer: Layer,
      canvas: Canvas
    ): [number, number][] => {
      const offX = (layer.mask.offset?.x ?? 0) * canvas.width;
      const offY = (layer.mask.offset?.y ?? 0) * canvas.height;
      return layer.mask.path.map(
        ([x, y]) => [x * canvas.width + offX, y * canvas.height + offY] as [
          number,
          number
        ]
      );
    };

    const createMaskOverlayShape = (
      absPoints: [number, number][],
      smoothing: number,
      layer: Layer
    ): FabricObject => {
      if (smoothing > 0 && absPoints.length >= 3) {
        const d = MaskRenderer.toSmoothedClosedPathD(absPoints, smoothing);
        return new Path(d, {
          fill: MASK_OVERLAY_FILL,
          stroke: MASK_OVERLAY_STROKE,
          strokeWidth: MASK_OVERLAY_STROKE_WIDTH,
          selectable: !layer.locked,
          evented: !layer.locked,
          objectCaching: false,
        }) as FabricObject;
      }

      const maskPoints = absPoints.map(([x, y]) => ({ x, y }));
      return new Polygon(maskPoints as any, {
        fill: MASK_OVERLAY_FILL,
        stroke: MASK_OVERLAY_STROKE,
        strokeWidth: MASK_OVERLAY_STROKE_WIDTH,
        selectable: !layer.locked,
        evented: !layer.locked,
        objectCaching: false,
      }) as unknown as FabricObject;
    };

    const removeMaskOverlaysForLayer = (
      layerId: string,
      primaryLayerObj?: FabricObject
    ) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const overlays = canvas.getObjects().filter((candidate) => {
        if (!(candidate as any)._isMaskOverlay) return false;
        return (candidate as any)._maskLayerId === layerId;
      });

      overlays.forEach((overlay) => {
        if (canvas.getActiveObject() === overlay) {
          canvas.discardActiveObject();
        }
        overlay.off();
        canvas.remove(overlay);
        dragOpacityMapRef.current.delete(overlay);
        if (lastDraggedObjectRef.current === overlay) {
          lastDraggedObjectRef.current = null;
        }
      });

      if (primaryLayerObj) {
        (primaryLayerObj as any)._maskPolygon = undefined;
      } else {
        const layerObject = canvas
          .getObjects()
          .find((candidate) => objectLayerMapRef.current.get(candidate) === layerId);
        if (layerObject) {
          (layerObject as any)._maskPolygon = undefined;
        }
      }
    };

    const syncMaskOverlayForLayer = (fabricObj: FabricObject, layer: Layer) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const shouldRenderMask =
        layer.mask.enabled && layer.mask.visible && layer.mask.path.length > 0;

      if (!shouldRenderMask) {
        removeMaskHandles(fabricObj);
        removeMaskOverlaysForLayer(layer.id, fabricObj);
        return;
      }

      const absPoints = getMaskAbsolutePoints(layer, canvas);
      const smoothing = layer.mask.smoothing ?? 0;

      removeMaskOverlaysForLayer(layer.id, fabricObj);
      const maskShape = createMaskOverlayShape(absPoints, smoothing, layer);
      (fabricObj as any)._maskPolygon = maskShape;
      canvas.add(maskShape);

      configureMaskOverlay(maskShape, layer, fabricObj);
      bringMaskHandlesToFront(fabricObj);
    };

    const createMaskPointHandles = (
      maskShape: FabricObject,
      layer: Layer,
      fabricObj: FabricObject
    ) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      if (layer.mask.path.length === 0) {
        return;
      }

      removeMaskHandles(fabricObj);

      const offX = (layer.mask.offset?.x ?? 0) * canvas.width;
      const offY = (layer.mask.offset?.y ?? 0) * canvas.height;

      const previousSelectionInfo =
        selectedMaskHandleInfoRef.current &&
        selectedMaskHandleInfoRef.current.layerId === layer.id
          ? selectedMaskHandleInfoRef.current
          : null;

      // --- Mask Handles ---
      const handles: Circle[] = layer.mask.path.map(([nx, ny], index) => {
        const handle = new Circle({
          left: nx * canvas.width + offX,
          top: ny * canvas.height + offY,
          radius: MASK_HANDLE_RADIUS,
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
          objectCaching: false,
        });

        (handle as any)._maskPointIndex = index;
        (handle as any)._isMaskHandle = true;
        (handle as any)._maskLayerId = layer.id;

        // Don't add custom mousedown handler - let Fabric.js handle selection naturally
        // Visual selection will be handled via selection events on the canvas

        const clampToCanvas = () => {
          if (!canvas) return;
          const radius = handle.get("radius") ?? MASK_HANDLE_RADIUS;
          const half = radius;
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
        if (canvas.bringObjectToFront) {
          canvas.bringObjectToFront(handle);
        }
        return handle;
      });

      (fabricObj as any)._maskPointHandles = handles;
      bringMaskHandlesToFront(fabricObj);

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

      const inSelectMode = canvasState?.tool === "select";
      // Mask overlays are only directly transformable in select mode.
      const allowMaskTransform =
        inSelectMode &&
        !layer.locked &&
        layer.mask.enabled &&
        layer.mask.visible;

      maskShape.hasBorders = true;
      maskShape.objectCaching = false;
      maskShape.borderScaleFactor = 0.5;
      maskShape.hoverCursor = layer.locked
        ? "not-allowed"
        : allowMaskTransform
        ? "move"
        : "default";
      maskShape.evented = allowMaskTransform;
      maskShape.selectable = allowMaskTransform;

      // Show transform controls only when select mode can actually transform this mask.
      if (inSelectMode && allowMaskTransform) {
        maskShape.hasControls = true;
        maskShape.lockScalingX = false;
        maskShape.lockScalingY = false;
        maskShape.lockRotation = false;
        maskShape.lockMovementX = false;
        maskShape.lockMovementY = false;
      } else {
        maskShape.hasControls = false;
        maskShape.lockScalingX = true;
        maskShape.lockScalingY = true;
        maskShape.lockRotation = true;
        maskShape.lockMovementX = true;
        maskShape.lockMovementY = true;
      }

      (maskShape as any)._isMaskOverlay = true;
      (maskShape as any)._maskLayerId = layer.id;

      maskShape.off("mousedown");
      maskShape.off("moving");
      maskShape.off("modified");

      maskShape.on("mousedown", () => {
        (maskShape as any)._transformStart = {
          left: maskShape.left ?? 0,
          top: maskShape.top ?? 0,
          scaleX: maskShape.scaleX ?? 1,
          scaleY: maskShape.scaleY ?? 1,
          angle: maskShape.angle ?? 0,
        };

        const handles: Circle[] | undefined = (fabricObj as any)
          ._maskPointHandles;
        (maskShape as any)._dragHandleStartPositions = handles?.map(
          (handle) => ({
            left: handle.left ?? 0,
            top: handle.top ?? 0,
          })
        );
      });

      maskShape.on("moving", () => {
        if (!(maskShape as any)._transformStart) {
          (maskShape as any)._transformStart = {
            left: maskShape.left ?? 0,
            top: maskShape.top ?? 0,
            scaleX: maskShape.scaleX ?? 1,
            scaleY: maskShape.scaleY ?? 1,
            angle: maskShape.angle ?? 0,
          };
        }

        const snappedLeft = Math.round(maskShape.left || 0);
        const snappedTop = Math.round(maskShape.top || 0);

        if (snappedLeft !== maskShape.left || snappedTop !== maskShape.top) {
          maskShape.set({ left: snappedLeft, top: snappedTop });
        }

        const transformStart = (maskShape as any)._transformStart;
        const handleStartPositions = (maskShape as any)
          ._dragHandleStartPositions as { left: number; top: number }[] | undefined;
        const handles: Circle[] | undefined = (fabricObj as any)
          ._maskPointHandles;

        if (
          transformStart &&
          handleStartPositions &&
          handles &&
          handles.length === handleStartPositions.length
        ) {
          const diffX = (maskShape.left ?? 0) - transformStart.left;
          const diffY = (maskShape.top ?? 0) - transformStart.top;

          handles.forEach((handle, index) => {
            const start = handleStartPositions[index];
            handle.set({
              left: start.left + diffX,
              top: start.top + diffY,
            });
            handle.setCoords();
          });

          canvas.requestRenderAll();
        }
      });

      maskShape.on("modified", () => {
        const canvasInstance = fabricCanvasRef.current;
        if (!canvasInstance) return;

        const transformStart = (maskShape as any)._transformStart ?? {
          left: 0,
          top: 0,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
        };

        const currentLeft = maskShape.left ?? 0;
        const currentTop = maskShape.top ?? 0;
        const currentScaleX = maskShape.scaleX ?? 1;
        const currentScaleY = maskShape.scaleY ?? 1;
        const currentAngle = maskShape.angle ?? 0;

        (maskShape as any)._transformStart = undefined;
        (maskShape as any)._dragHandleStartPositions = undefined;

        const canvasWidth = canvasInstance.getWidth();
        const canvasHeight = canvasInstance.getHeight();

        if (!canvasWidth || !canvasHeight) {
          canvas.requestRenderAll();
          bringMaskHandlesToFront(fabricObj);
          return;
        }

        const layerId = objectLayerMapRef.current.get(fabricObj);
        if (!layerId) return;

        const currentLayer =
          project?.layers.find((candidate) => candidate.id === layerId) ??
          layer;

        // Check if this was a scale/rotate operation (not just a move)
        const wasScaled =
          Math.abs(currentScaleX - transformStart.scaleX) > 0.001 ||
          Math.abs(currentScaleY - transformStart.scaleY) > 0.001;
        const wasRotated = Math.abs(currentAngle - transformStart.angle) > 0.1;

        if (wasScaled || wasRotated) {
          // Handle scale/rotate: transform all mask points
          const offX = (currentLayer.mask.offset?.x ?? 0) * canvasWidth;
          const offY = (currentLayer.mask.offset?.y ?? 0) * canvasHeight;

          // Get original absolute points
          const originalAbsPoints = currentLayer.mask.path.map(
            ([nx, ny]) =>
              [nx * canvasWidth + offX, ny * canvasHeight + offY] as [
                number,
                number
              ]
          );

          // Calculate center of the original mask
          let centerX = 0,
            centerY = 0;
          originalAbsPoints.forEach(([x, y]) => {
            centerX += x;
            centerY += y;
          });
          centerX /= originalAbsPoints.length;
          centerY /= originalAbsPoints.length;

          // Transform each point
          const angleRad = (currentAngle * Math.PI) / 180;
          const cos = Math.cos(angleRad);
          const sin = Math.sin(angleRad);

          const transformedPoints: [number, number][] = originalAbsPoints.map(
            ([x, y]) => {
              // Translate to origin
              const dx = x - centerX;
              const dy = y - centerY;

              // Apply scale
              const scaledX = dx * currentScaleX;
              const scaledY = dy * currentScaleY;

              // Apply rotation
              const rotatedX = scaledX * cos - scaledY * sin;
              const rotatedY = scaledX * sin + scaledY * cos;

              // Translate back and apply position offset
              const finalX =
                rotatedX + centerX + (currentLeft - transformStart.left);
              const finalY =
                rotatedY + centerY + (currentTop - transformStart.top);

              // Convert to normalized coordinates (remove the offset since we baked it into the points)
              return [
                Number((finalX / canvasWidth).toFixed(5)),
                Number((finalY / canvasHeight).toFixed(5)),
              ] as [number, number];
            }
          );

          // Reset mask shape transform
          maskShape.set({
            left: 0,
            top: 0,
            scaleX: 1,
            scaleY: 1,
            angle: 0,
          });
          maskShape.setCoords();

          // Clear the applied offset since we baked it into the points
          (maskShape as any)._appliedOffset = { x: 0, y: 0 };

          // Update the mask path and clear the offset (since we baked it into points)
          onLayerUpdate(layerId, {
            mask: {
              ...currentLayer.mask,
              path: transformedPoints,
              editorPath: transformedPoints,
              offset: { x: 0, y: 0 },
              editorOffset: { x: 0, y: 0 },
            },
          });
        } else {
          // Handle move only: update offset
          const diffX = Math.round(currentLeft - transformStart.left);
          const diffY = Math.round(currentTop - transformStart.top);

          if (diffX === 0 && diffY === 0) {
            maskShape.set({ left: 0, top: 0 });
            maskShape.setCoords();
            canvas.requestRenderAll();
            bringMaskHandlesToFront(fabricObj);
            return;
          }

          const previousOffset =
            (maskShape as any)._appliedOffset ?? initialOffset;
          const nextOffset = {
            x: previousOffset.x + diffX / canvasWidth,
            y: previousOffset.y + diffY / canvasHeight,
          };

          (maskShape as any)._appliedOffset = nextOffset;

          maskShape.set({ left: 0, top: 0 });
          maskShape.setCoords();

          onLayerUpdate(layerId, {
            mask: {
              ...currentLayer.mask,
              offset: nextOffset,
              editorOffset: nextOffset,
            },
          });

          const handles: Circle[] | undefined = (fabricObj as any)
            ._maskPointHandles;
          if (handles?.length) {
            const offX = nextOffset.x * canvasWidth;
            const offY = nextOffset.y * canvasHeight;
            handles.forEach((handle, index) => {
              const point = currentLayer.mask.path[index];
              if (!point) return;
              handle.set({
                left: point[0] * canvasWidth + offX,
                top: point[1] * canvasHeight + offY,
              });
              handle.setCoords();
            });
          }
        }

        canvas.requestRenderAll();
        bringMaskHandlesToFront(fabricObj);
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
          if (canvas.getActiveObject()) {
            canvas.discardActiveObject();
            canvas.requestRenderAll();
          }
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
            feather: 0.5,
            smoothing: 1.0,
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
      resetZoomAndPan: () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        // Reset the internal refs directly
        canvasZoomRef.current = 1;
        canvasPanRef.current = { x: 0, y: 0 };

        // Clear any pending skip counts
        skipCanvasStateSyncRef.current = 0;

        // Apply the transform immediately
        applyZoomAndPanToCanvas(canvas, 1, { x: 0, y: 0 });

        // Notify parent components of the change
        if (onZoomChange) {
          onZoomChange(1);
        }
        if (onPanChange) {
          onPanChange({ x: 0, y: 0 });
        }
      },
    }));

    useEffect(() => {
      projectRef.current = project;
    }, [project]);

    useEffect(() => {
      canvasStateRef.current = canvasState;
    }, [canvasState]);

    useEffect(() => {
      onLayerUpdateRef.current = onLayerUpdate;
    }, [onLayerUpdate]);

    useEffect(() => {
      onLayerSelectedRef.current = onLayerSelected;
    }, [onLayerSelected]);

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

      const restoreDragOpacity = (target?: FabricObject) => {
        const targets = target
          ? dragOpacityMapRef.current.has(target)
            ? [target]
            : []
          : Array.from(dragOpacityMapRef.current.keys());

        if (targets.length === 0) {
          return;
        }

        let didUpdate = false;
        targets.forEach((fabricObj) => {
          const storedOpacity = dragOpacityMapRef.current.get(fabricObj);
          if (storedOpacity === undefined) {
            return;
          }

          let nextOpacity = storedOpacity;
          const layerId = objectLayerMapRef.current.get(fabricObj);
          if (layerId) {
            const currentProject = projectRef.current;
            const layer = currentProject?.layers.find((l) => l.id === layerId);
            if (layer) {
              nextOpacity = layer.opacity;
            }
          }

          fabricObj.set("opacity", nextOpacity);
          if (fabricObj === lastDraggedObjectRef.current) {
            canvas.setActiveObject(fabricObj);
            fabricObj.setCoords?.();
          }
          dragOpacityMapRef.current.delete(fabricObj);
          didUpdate = true;
        });

        if (didUpdate) {
          canvas.requestRenderAll();
        }
      };

      const getInteractionTarget = (e: any): FabricObject | undefined => {
        const directTarget = e?.target as FabricObject | undefined;
        if (directTarget) {
          return directTarget;
        }
        return e?.transform?.target as FabricObject | undefined;
      };

      const handleObjectInteractionStart = (e: any) => {
        const obj = getInteractionTarget(e);
        if (!obj || dragOpacityMapRef.current.has(obj)) {
          return;
        }

        if (!objectLayerMapRef.current.has(obj)) {
          return;
        }

        lastDraggedObjectRef.current = obj;

        const currentOpacity = obj.opacity ?? 1;
        if (currentOpacity <= 0.5) {
          return;
        }

        dragOpacityMapRef.current.set(obj, currentOpacity);
        obj.set("opacity", 0.5);
        canvas.requestRenderAll();
      };

      const handleMouseUpAfterDrag = () => {
        if (dragOpacityMapRef.current.size > 0) {
          restoreDragOpacity();
        }

        const lastDragged = lastDraggedObjectRef.current;
        if (lastDragged) {
          if (!dragOpacityMapRef.current.has(lastDragged)) {
            canvas.setActiveObject(lastDragged);
            lastDragged.setCoords?.();
            canvas.requestRenderAll();
          }
          lastDraggedObjectRef.current = null;
        }
      };

      // Handle object modification events
      canvas.on("object:modified", (e) => {
        const obj = e.target;
        if (!obj) return;

        restoreDragOpacity(obj);

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

            onLayerUpdateRef.current(layerId, {
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

            onLayerUpdateRef.current(layerId, {
              transform: normalizedTransform,
            });
          }
        };

        calculateNormalizedScale();
      });

      canvas.on("before:transform", handleObjectInteractionStart);
      canvas.on("object:moving", handleObjectInteractionStart);
      canvas.on("object:scaling", handleObjectInteractionStart);
      canvas.on("object:rotating", handleObjectInteractionStart);
      canvas.on("mouse:up", handleMouseUpAfterDrag);

      // Handle selection events
      canvas.on("selection:created", (e) => {
        const obj = e.selected?.[0];
        if (obj) {
          // Check if it's a mask handle
          if ((obj as any)._isMaskHandle) {
            selectMaskHandle(obj as Circle);
            return;
          }

          const layerId =
            objectLayerMapRef.current.get(obj) ??
            ((obj as any)._isMaskOverlay
              ? ((obj as any)._maskLayerId as string | undefined)
              : undefined);
          if (layerId && onLayerSelectedRef.current) {
            // Notify parent that a layer has been selected on canvas
            onLayerSelectedRef.current(layerId);
          }
        }
      });

      canvas.on("selection:updated", (e) => {
        const obj = e.selected?.[0];
        if (obj) {
          // Check if it's a mask handle
          if ((obj as any)._isMaskHandle) {
            selectMaskHandle(obj as Circle);
            return;
          }

          const layerId =
            objectLayerMapRef.current.get(obj) ??
            ((obj as any)._isMaskOverlay
              ? ((obj as any)._maskLayerId as string | undefined)
              : undefined);
          if (layerId && onLayerSelectedRef.current) {
            // Notify parent that a different layer has been selected on canvas
            onLayerSelectedRef.current(layerId);
          }
        }
      });

      canvas.on("selection:cleared", () => {
        // When selection is cleared, deselect mask handle
        if (canvasStateRef.current?.tool === "mask") {
          selectMaskHandle(null);
        }
      });

      return () => {
        canvas.off("before:transform", handleObjectInteractionStart);
        canvas.off("object:moving", handleObjectInteractionStart);
        canvas.off("object:scaling", handleObjectInteractionStart);
        canvas.off("object:rotating", handleObjectInteractionStart);
        canvas.off("mouse:up", handleMouseUpAfterDrag);
        canvas.dispose();
        fabricCanvasRef.current = null;
      };
    }, []);

    // Pan handling effect - register directly on canvas DOM element to survive canvas.clear()
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !canvas.upperCanvasEl) return;

      const canvasElement = canvas.upperCanvasEl;

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
        if (
          clientEvent.clientX === undefined ||
          clientEvent.clientY === undefined
        ) {
          return null;
        }

        return { x: clientEvent.clientX, y: clientEvent.clientY };
      };

      const updatePanFromPosition = (position: { x: number; y: number }) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas || !lastPosition) {
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

        // Don't notify parent during panning - only when done
        // This prevents React state updates from interfering with smooth panning
      };

      // Use native DOM events on canvas element instead of Fabric events
      const handleCanvasMouseDown = (event: MouseEvent) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        // In pan tool mode, always pan
        // In select or mask mode, pan with space key or middle mouse button
        const isPanTool = canvasState?.tool === "pan";
        const shouldPan =
          isPanTool || isSpaceKeyDownRef.current || event.button === 1;

        if (!shouldPan) {
          // Normal behavior - allow object selection or mask drawing
          return;
        }

        // Start panning
        const position = getClientPosition(event);
        if (!position) return;

        isPanning = true;
        lastPosition = position;
        canvas.discardActiveObject();
        if (canvas.upperCanvasEl) {
          canvas.setCursor("grabbing");
        }
        event?.preventDefault?.();
        event?.stopPropagation?.();

        window.addEventListener("mousemove", handleWindowMouseMove);
        window.addEventListener("mouseup", handleWindowMouseUp);
      };

      const handleWindowMouseMove = (event: MouseEvent | PointerEvent) => {
        if (!isPanning) return;
        const position = getClientPosition(event);
        if (!position) return;

        updatePanFromPosition(position);
      };

      const handleWindowMouseUp = () => {
        endPan();
      };

      const endPan = () => {
        const canvas = fabricCanvasRef.current;
        if (!isPanning) return;
        isPanning = false;
        lastPosition = null;

        // Notify parent of final pan position now that panning is done
        if (onPanChange && canvas) {
          const finalPan = canvasPanRef.current ?? { x: 0, y: 0 };
          skipCanvasStateSyncRef.current += 1; // Skip the next state sync since we're already synced
          onPanChange(finalPan);
        }

        // Reset cursor based on current tool and space key state
        if (canvas?.upperCanvasEl) {
          if (canvasState?.tool === "pan") {
            canvas.setCursor("grab");
          } else if (canvasState?.tool === "select") {
            if (isSpaceKeyDownRef.current) {
              canvas.setCursor("grab");
            } else {
              canvas.setCursor("default");
            }
          } else if (canvasState?.tool === "mask") {
            if (isSpaceKeyDownRef.current) {
              canvas.setCursor("grab");
            } else {
              canvas.setCursor("crosshair");
            }
          }
        }

        window.removeEventListener("mousemove", handleWindowMouseMove);
        window.removeEventListener("mouseup", handleWindowMouseUp);
      };

      // Space key handling for pan mode in select and mask tools
      const handleKeyDown = (event: KeyboardEvent) => {
        const canvas = fabricCanvasRef.current;
        if (
          !canvas ||
          (canvasState?.tool !== "select" && canvasState?.tool !== "mask")
        )
          return;
        if (event.code === "Space" && !isSpaceKeyDownRef.current) {
          // Prevent space from triggering other actions
          const activeElement = document.activeElement as HTMLElement;
          if (
            activeElement &&
            (activeElement.tagName === "INPUT" ||
              activeElement.tagName === "TEXTAREA")
          ) {
            return; // Don't override space in input fields
          }

          event.preventDefault();
          isSpaceKeyDownRef.current = true;

          // Make all objects non-selectable and non-evented to enable panning over them
          canvas.selection = false;
          const objects = canvas.getObjects();

          objects.forEach((obj) => {
            if (
              objectLayerMapRef.current.has(obj) ||
              (obj as any)._isMaskHandle ||
              (obj as any)._isMaskOverlay
            ) {
              (obj as any)._wasSelectable = obj.selectable;
              (obj as any)._wasEvented = obj.evented;
              obj.selectable = false;
              obj.evented = false;
              obj.hoverCursor = "grab";
            }
          });

          canvas.defaultCursor = "grab";
          canvas.hoverCursor = "grab";
          if (!isPanning && canvas.upperCanvasEl) {
            canvas.setCursor("grab");
          }
          canvas.renderAll();
        }
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        if (event.code === "Space" && isSpaceKeyDownRef.current) {
          event.preventDefault();
          isSpaceKeyDownRef.current = false;
          if (canvasState?.tool === "select") {
            // Restore object selectability
            canvas.selection = false; // Keep false to prevent multi-select box
            const objects = canvas.getObjects();
            objects.forEach((obj) => {
              if (objectLayerMapRef.current.has(obj)) {
                obj.selectable =
                  (obj as any)._wasSelectable !== undefined
                    ? (obj as any)._wasSelectable
                    : true;
                obj.evented =
                  (obj as any)._wasEvented !== undefined
                    ? (obj as any)._wasEvented
                    : true;
                delete (obj as any)._wasSelectable;
                delete (obj as any)._wasEvented;

                const layerId = objectLayerMapRef.current.get(obj);
                const layer = project?.layers.find((l) => l.id === layerId);
                obj.hoverCursor = layer?.locked ? "not-allowed" : "move";
              }
            });

            canvas.defaultCursor = "default";
            canvas.hoverCursor = "move";
            if (!isPanning && canvas.upperCanvasEl) {
              canvas.setCursor("default");
            }
            canvas.renderAll();
          } else if (canvasState?.tool === "mask") {
            // Restore mask tool state
            canvas.selection = false;
            const objects = canvas.getObjects();
            objects.forEach((obj) => {
              if (
                objectLayerMapRef.current.has(obj) ||
                (obj as any)._isMaskHandle ||
                (obj as any)._isMaskOverlay
              ) {
                obj.selectable =
                  (obj as any)._wasSelectable !== undefined
                    ? (obj as any)._wasSelectable
                    : false;
                obj.evented =
                  (obj as any)._wasEvented !== undefined
                    ? (obj as any)._wasEvented
                    : false;
                delete (obj as any)._wasSelectable;
                delete (obj as any)._wasEvented;

                // Restore proper cursor for mask mode
                if ((obj as any)._isMaskHandle) {
                  const layerId = (obj as any)._maskLayerId;
                  const layer = project?.layers.find((l) => l.id === layerId);
                  obj.hoverCursor = layer?.locked ? "not-allowed" : "move";
                } else if ((obj as any)._isMaskOverlay) {
                  const layerId = (obj as any)._maskLayerId;
                  const layer = project?.layers.find((l) => l.id === layerId);
                  obj.hoverCursor = layer?.locked ? "not-allowed" : "move";
                }
              }
            });

            canvas.defaultCursor = "crosshair";
            canvas.hoverCursor = "crosshair";
            if (!isPanning && canvas.upperCanvasEl) {
              canvas.setCursor("crosshair");
            }
            canvas.renderAll();
          }
        }
      };

      // Register on canvas DOM element, not Fabric events
      canvasElement.addEventListener("mousedown", handleCanvasMouseDown);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      return () => {
        canvasElement.removeEventListener("mousedown", handleCanvasMouseDown);
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
        endPan();
      };
    }, [canvasState?.tool, onPanChange, project]);

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

      if (skipCanvasStateSyncRef.current > 0) {
        skipCanvasStateSyncRef.current -= 1;
        canvasZoomRef.current = nextZoom;
        canvasPanRef.current = normalizePan(nextPan);
        return;
      }

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
      if (!canvas || !canvas.upperCanvasEl) return;
      if (!onZoomChange) return;

      const minZoomValue = Math.max(minZoom ?? 0.25, 0.05);
      const maxZoomValue = Math.max(maxZoom ?? 4, minZoomValue);

      // Shared zoom logic that zooms toward cursor position
      const performZoom = (event: WheelEvent) => {
        const activeCanvas = fabricCanvasRef.current;
        if (!activeCanvas) {
          return;
        }

        const currentZoom = canvasZoomRef.current ?? activeCanvas.getZoom();
        const currentPan =
          canvasPanRef.current ?? getPanFromViewport(activeCanvas);

        // Adjust sensitivity based on modifier keys
        const sensitivity = event.ctrlKey ? 0.02 : 0.0015;
        const zoomFactor = Math.exp(-event.deltaY * sensitivity);
        let nextZoom = currentZoom * zoomFactor;
        nextZoom = Math.min(Math.max(nextZoom, minZoomValue), maxZoomValue);

        if (Math.abs(nextZoom - currentZoom) < ZOOM_EPSILON) {
          return;
        }

        const rect = activeCanvas.upperCanvasEl?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        // Get mouse position relative to canvas
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;

        // Calculate world coordinates at pointer position before zoom
        const baseCurrent = getBaseTranslation(activeCanvas, currentZoom);
        const translateCurrentX = baseCurrent.x + currentPan.x;
        const translateCurrentY = baseCurrent.y + currentPan.y;

        const worldX = (pointerX - translateCurrentX) / currentZoom;
        const worldY = (pointerY - translateCurrentY) / currentZoom;

        // Calculate new pan to keep the same world point under the cursor
        const baseNext = getBaseTranslation(activeCanvas, nextZoom);
        const translateNextX = pointerX - worldX * nextZoom;
        const translateNextY = pointerY - worldY * nextZoom;

        const nextPanRaw = {
          x: translateNextX - baseNext.x,
          y: translateNextY - baseNext.y,
        };

        const normalizedNextPan = normalizePan(nextPanRaw);

        // Update refs immediately for smooth zooming
        canvasZoomRef.current = nextZoom;
        canvasPanRef.current = normalizedNextPan;

        // Apply to canvas immediately
        applyZoomAndPanToCanvas(activeCanvas, nextZoom, normalizedNextPan);

        // Debounce state updates to parent to avoid jitter
        if (zoomDebounceTimerRef.current) {
          clearTimeout(zoomDebounceTimerRef.current);
        }

        zoomDebounceTimerRef.current = setTimeout(() => {
          // Notify parent after zooming settles
          if (onPanChange && !pansAreClose(normalizedNextPan, currentPan)) {
            skipCanvasStateSyncRef.current += 1;
            onPanChange(normalizedNextPan);
          }

          skipCanvasStateSyncRef.current += 1;
          if (onZoomChange) {
            onZoomChange(nextZoom);
          }

          zoomDebounceTimerRef.current = null;
        }, 50); // 50ms debounce - smooth but responsive
      };

      // Native wheel event handler for smooth scrolling zoom
      const handleNativeWheel = (event: WheelEvent) => {
        // Prevent default scrolling behavior
        event.preventDefault();
        event.stopPropagation();

        performZoom(event);
      };

      // Fabric.js wheel event handler (backup for compatibility)
      const handleWheel = (opt: any) => {
        const event = opt?.e as WheelEvent | undefined;
        if (!event) {
          return;
        }

        // Prevent default and stop propagation
        event.preventDefault();
        event.stopPropagation();
        opt.e.preventDefault();
        opt.e.stopPropagation();

        performZoom(event);
      };

      // Register both native and Fabric handlers
      const canvasElement = canvas.upperCanvasEl;
      canvasElement.addEventListener("wheel", handleNativeWheel, {
        passive: false,
      });
      canvas.on("mouse:wheel", handleWheel);

      return () => {
        // Clear any pending debounced zoom updates
        if (zoomDebounceTimerRef.current) {
          clearTimeout(zoomDebounceTimerRef.current);
          zoomDebounceTimerRef.current = null;
        }

        canvasElement.removeEventListener("wheel", handleNativeWheel);
        canvas.off("mouse:wheel", handleWheel);
      };
    }, [minZoom, maxZoom, onPanChange, onZoomChange]);

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

      if (canvasState?.tool === "pan") {
        // In pan tool mode, make everything non-selectable and set pan cursor
        canvas.selection = false;
        canvas.defaultCursor = "grab";
        canvas.hoverCursor = "grab";

        const objects = canvas.getObjects();
        objects.forEach((obj) => {
          if (objectLayerMapRef.current.has(obj)) {
            obj.selectable = false;
            obj.evented = false;
            obj.hoverCursor = "grab";
          }
        });
      } else if (canvasState?.tool === "mask") {
        // Disable object selection when in mask mode
        canvas.selection = false; // Keep false to prevent multi-selection box
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
              // Make sure handles can be moved even though canvas.selection is false
              handle.lockMovementX = false;
              handle.lockMovementY = false;
            });

            const maskShape = (obj as any)._maskPolygon as
              | FabricObject
              | undefined;
            if (maskShape) {
              maskShape.evented = false;
              maskShape.selectable = false;
              maskShape.hoverCursor = layer?.locked
                ? "not-allowed"
                : "default";
              maskShape.hasControls = false;
              maskShape.hasBorders = true;
              maskShape.lockRotation = true;
              maskShape.lockScalingX = true;
              maskShape.lockScalingY = true;
              maskShape.lockMovementX = true;
              maskShape.lockMovementY = true;
              if (showHandles) {
                bringMaskHandlesToFront(obj);
              }
            }
          } else if ((obj as any)._isMaskOverlay) {
            const layerId = (obj as any)._maskLayerId as string | undefined;
            const layer = project?.layers.find((l) => l.id === layerId);
            obj.evented = false;
            obj.selectable = false;
            obj.hoverCursor = layer?.locked
              ? "not-allowed"
              : "default";
            obj.hasControls = false;
            obj.hasBorders = true;
            obj.lockRotation = true;
            obj.lockScalingX = true;
            obj.lockScalingY = true;
            obj.lockMovementX = true;
            obj.lockMovementY = true;
            if (layerId && layerId === canvasState.selectedLayerId) {
              const layerObject = canvas
                .getObjects()
                .find(
                  (candidate) =>
                    objectLayerMapRef.current.get(candidate) === layerId
                );
              if (layerObject) {
                bringMaskHandlesToFront(layerObject);
              }
            }
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
        // Disable multi-selection box (we'll use pan on empty canvas instead)
        canvas.selection = false;
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
              // In select mode, allow mask movement, scaling, and rotation
              const allowMaskTransform =
                !!layer &&
                !layer.locked &&
                layer.mask.enabled &&
                layer.mask.visible;
              maskShape.evented = allowMaskTransform;
              maskShape.selectable = allowMaskTransform;
              maskShape.hoverCursor = layer?.locked
                ? "not-allowed"
                : allowMaskTransform
                ? "move"
                : "default";
              // Enable standard controls in select mode (scaling and rotation)
              maskShape.hasControls = allowMaskTransform;
              maskShape.hasBorders = true;
              maskShape.lockRotation = !allowMaskTransform;
              maskShape.lockScalingX = !allowMaskTransform;
              maskShape.lockScalingY = !allowMaskTransform;
              maskShape.lockMovementX = !allowMaskTransform;
              maskShape.lockMovementY = !allowMaskTransform;
            }
          } else if ((obj as any)._isMaskOverlay) {
            const layerId = (obj as any)._maskLayerId as string | undefined;
            const layer = project?.layers.find((l) => l.id === layerId);
            // In select mode, allow mask movement, scaling, and rotation
            const allowMaskTransform =
              !!layer &&
              !layer.locked &&
              layer.mask.enabled &&
              layer.mask.visible;
            obj.evented = allowMaskTransform;
            obj.selectable = allowMaskTransform;
            obj.hoverCursor = layer?.locked
              ? "not-allowed"
              : allowMaskTransform
              ? "move"
              : "default";
            // Enable standard controls in select mode (scaling and rotation)
            obj.hasControls = allowMaskTransform;
            obj.hasBorders = true;
            obj.lockRotation = !allowMaskTransform;
            obj.lockScalingX = !allowMaskTransform;
            obj.lockScalingY = !allowMaskTransform;
            obj.lockMovementX = !allowMaskTransform;
            obj.lockMovementY = !allowMaskTransform;
          }
        });
      }

      canvas.requestRenderAll();
    }, [canvasState?.tool, canvasState?.selectedLayerId, project]);

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
          feather: 0.5,
          smoothing: 1.0,
          offset: { x: 0, y: 0 },
          editorPath: normalizedPoints,
          editorSmoothing: 1.0,
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

      const removeTrailingDuplicatePoint = (finalPointer?: {
        x: number;
        y: number;
      }) => {
        if (!maskDrawingRef.current.isDrawing) return;
        const points = maskDrawingRef.current.points;
        if (points.length === 0) return;

        if (points.length >= 2) {
          const last = points[points.length - 1];
          const prev = points[points.length - 2];
          const dx = last.x - prev.x;
          const dy = last.y - prev.y;
          const distanceSq = dx * dx + dy * dy;

          // Double-clicks can create two nearly identical points; drop the extra point.
          if (distanceSq <= 16) {
            points.pop();
            const duplicateCircle = maskDrawingRef.current.pointCircles.pop();
            if (duplicateCircle && fabricCanvasRef.current) {
              fabricCanvasRef.current.remove(duplicateCircle);
            }
          }
        }

        if (finalPointer) {
          const lastPoint = points[points.length - 1];
          lastPoint.x = finalPointer.x;
          lastPoint.y = finalPointer.y;
        }

        if (maskDrawingRef.current.currentPolygon) {
          maskDrawingRef.current.currentPolygon.set({
            points: [...points],
          });
        }

        fabricCanvasRef.current?.renderAll();
      };

      const handleMouseDown = (e: any) => {
        if (colorPickMode && onColorPick) {
          if ((e.e as MouseEvent).button !== 0) {
            return;
          }

          const pointer = canvas.getPointer(e.e);
          const normalizedPoint = {
            x: Math.min(Math.max(pointer.x / canvas.width, 0), 1),
            y: Math.min(Math.max(pointer.y / canvas.height, 0), 1),
          };

          onColorPick(normalizedPoint);
          return;
        }

        if (canvasState?.tool === "mask" && canvasState?.selectedLayerId) {
          const target = e.target as FabricObject | undefined;

          if (target) {
            if ((target as any)._isMaskHandle) {
              return; // interacting with existing handle
            }

            if ((target as any)._isMaskOverlay) {
              return; // interacting with mask overlay
            }
          } else {
            // Clicking on empty canvas - deselect mask handle
            selectMaskHandle(null);
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
          const canvas = fabricCanvasRef.current;
          removeTrailingDuplicatePoint(canvas?.getPointer(e.e));
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
      colorPickMode,
      canvasState?.tool,
      canvasState?.selectedLayerId,
      onColorPick,
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
          const img = await loadImageFromDataURL(project.base.imageData);
          const fabricImage = new FabricImage(img, {
            scaleX: scale,
            scaleY: scale,
            originX: "left",
            originY: "top",
          });
          canvas.backgroundImage = fabricImage;
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
        syncMaskOverlayForLayer(fabricImg, layer);

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
        syncMaskOverlayForLayer(fabricObj, layer);

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
        removeMaskHandles(fabricObj);
        removeMaskOverlaysForLayer(layerId, fabricObj);

        canvas.remove(fabricObj);
        objectLayerMapRef.current.delete(fabricObj);
        canvas.renderAll();
      }
    };

    const selectFabricLayer = (layerId: string) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const activeObject = canvas.getActiveObject();
      const activeLayerId = activeObject
        ? objectLayerMapRef.current.get(activeObject)
        : undefined;
      if (activeLayerId === layerId) {
        return;
      }

      const objects = canvas.getObjects();
      const fabricObj = objects.find(
        (obj) => objectLayerMapRef.current.get(obj) === layerId
      );

      if (fabricObj) {
        canvas.setActiveObject(fabricObj);
        canvas.requestRenderAll();
      } else if (activeObject) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
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

    // Render detected masks overlay
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      // Remove any existing detection overlays
      const existingDetections = canvas
        .getObjects()
        .filter((obj: any) => obj._isDetectionOverlay);
      existingDetections.forEach((obj) => canvas.remove(obj));

      if (!showDetections || detectedMasks.length === 0) {
        canvas.renderAll();
        return;
      }

      // Add new detection overlays
      detectedMasks.forEach((detection) => {
        const points = detection.path.map(([x, y]) => ({
          x: x * canvas.width,
          y: y * canvas.height,
        }));

        const polygon = new Polygon(points, {
          fill: "transparent",
          stroke: detection.color,
          strokeWidth: 3,
          selectable: true,
          evented: true,
          hoverCursor: "pointer",
          objectCaching: false,
        });

        (polygon as any)._isDetectionOverlay = true;
        (polygon as any)._detectionId = detection.id;

        // Add click handler
        polygon.on("mousedown", () => {
          if (onDetectionClick) {
            onDetectionClick(detection.id);
          }
        });

        canvas.add(polygon);

        // Add confidence label
        const bbox = detection.bbox;
        const labelText = `${(detection.confidence * 100).toFixed(0)}%`;
        const text = new Text(labelText, {
          left: (bbox.x + bbox.w / 2) * canvas.width,
          top: bbox.y * canvas.height - 20,
          fontSize: 14,
          fill: "#ffffff",
          backgroundColor: detection.color,
          padding: 4,
          selectable: false,
          evented: false,
        } as any);

        (text as any)._isDetectionOverlay = true;
        canvas.add(text);
      });

      canvas.renderAll();

      // Cleanup
      return () => {
        const detections = canvas
          .getObjects()
          .filter((obj: any) => obj._isDetectionOverlay);
        detections.forEach((obj) => canvas.remove(obj));
        canvas.renderAll();
      };
    }, [showDetections, detectedMasks, onDetectionClick]);

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
