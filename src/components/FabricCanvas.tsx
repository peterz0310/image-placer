"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import {
  Canvas,
  Image as FabricImage,
  FabricObject,
  Polygon,
  Point,
  Circle,
} from "fabric";
import { Project, Layer, CanvasState } from "@/types";

interface FabricCanvasProps {
  project: Project | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  selectedLayerId?: string;
  transformMode?: "normal" | "skew";
  canvasState?: CanvasState;
  onCanvasStateChange?: (
    state: CanvasState | ((prev: CanvasState) => CanvasState)
  ) => void;
  onMaskFinished?: () => void;
  onLayerSelected?: (layerId: string) => void;
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
      onCanvasStateChange,
      onMaskFinished,
      onLayerSelected,
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

    const lastProjectRef = useRef<{
      baseImageData: string | undefined;
      layerCount: number;
    }>({ baseImageData: undefined, layerCount: 0 });

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
      if (!canvasRef.current || fabricCanvasRef.current) return;

      const canvas = new Canvas(canvasRef.current, {
        width: 800,
        height: 600,
        backgroundColor: "#f0f0f0",
      });

      fabricCanvasRef.current = canvas;

      // Handle object modification events
      canvas.on("object:modified", (e) => {
        const obj = e.target;
        if (!obj) return;

        const layerId = objectLayerMapRef.current.get(obj);
        if (!layerId) return;

        // Convert Fabric.js coordinates back to normalized coordinates
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

        resetMaskDrawing();
        canvas.renderAll();
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

        resetMaskDrawing();
        canvas.renderAll();
      };

      const resetMaskDrawing = () => {
        maskDrawingRef.current = {
          isDrawing: false,
          points: [],
          pointCircles: [],
          currentPolygon: undefined,
          targetLayerId: undefined,
        };
      };

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

    // Update individual layer properties when they change (without rebuilding canvas)
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

            // Also update mask visualization for this layer
            updateFabricLayer(layer);
          }
        });

        canvas.requestRenderAll();
      }
    }, [
      project?.layers
        ?.map(
          (l) =>
            `${l.id}-${l.transform.left}-${l.transform.top}-${l.transform.scaleX}-${l.transform.scaleY}-${l.transform.angle}-${l.opacity}-${l.visible}-${l.locked}-${l.mask.enabled}-${l.mask.visible}-${l.mask.path.length}-${l.mask.feather}`
        )
        .join(","),
    ]);

    // Update transform controls when mode changes
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();

      objects.forEach((obj, index) => {
        const layerId = objectLayerMapRef.current.get(obj);
        const layer = project?.layers.find((l) => l.id === layerId);
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

          obj.on("mouseup", resetSkewStart);
          obj.on("modified", resetSkewStart);

          // Set visual indicators for skew mode
          obj.borderColor = "#ff6600";
          obj.cornerColor = "#ff6600";
          obj.cornerSize = 10;
          obj.transparentCorners = false;

          console.log(
            `Enabled REAL skewing on object ${index} - dragging handles will modify skewX/skewY`
          );
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

          console.log(`Disabled skewing on object ${index}`);
        } // Force controls update
        obj.setCoords();
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
          }
        });
      }
    }, [canvasState?.tool]);

    // Mask drawing helper functions
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
    };

    // Handle mask drawing events
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const handleMouseDown = (e: any) => {
        if (canvasState?.tool === "mask" && canvasState?.selectedLayerId) {
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
            // Start new mask - automatically enable mask for this layer
            maskDrawingRef.current.isDrawing = true;
            maskDrawingRef.current.points = [point];
            maskDrawingRef.current.pointCircles = [];
            maskDrawingRef.current.targetLayerId = canvasState.selectedLayerId;

            // Automatically enable the mask when starting to draw
            onLayerUpdate(canvasState.selectedLayerId, {
              mask: {
                ...selectedLayer!.mask,
                enabled: true,
              },
            });

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
        if (canvasState?.tool === "mask" && maskDrawingRef.current.isDrawing) {
          finishMask();
        }
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

      // Clear existing objects
      canvas.clear();
      objectLayerMapRef.current.clear();

      // Set canvas size based on base image dimensions
      const maxWidth = 800;
      const maxHeight = 600;
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

        // Apply transform mode settings immediately, but respect layer locking
        if (!layer.locked) {
          if (transformMode === "skew") {
            fabricImg.lockSkewingX = false;
            fabricImg.lockSkewingY = false;
            fabricImg.lockRotation = true;
            fabricImg.lockScalingX = false; // Keep scaling unlocked but hide corner controls
            fabricImg.lockScalingY = false; // Keep scaling unlocked but hide corner controls
            fabricImg.lockMovementX = false;
            fabricImg.lockMovementY = false;

            // Hide corner controls, show only side controls for skewing
            fabricImg.setControlsVisibility({
              tl: false, // top-left corner
              tr: false, // top-right corner
              br: false, // bottom-right corner
              bl: false, // bottom-left corner
              ml: true, // middle-left (for skewY)
              mt: true, // middle-top (for skewX)
              mr: true, // middle-right (for skewY)
              mb: true, // middle-bottom (for skewX)
              mtr: false, // rotation control
            });

            fabricImg.borderColor = "#ff6600";
            fabricImg.cornerColor = "#ff6600";
            fabricImg.cornerSize = 10;
          } else {
            fabricImg.lockSkewingX = true;
            fabricImg.lockSkewingY = true;
            fabricImg.lockRotation = false;
            fabricImg.lockScalingX = false;
            fabricImg.lockScalingY = false;
            fabricImg.lockMovementX = false;
            fabricImg.lockMovementY = false;

            // Show all controls in normal mode
            fabricImg.setControlsVisibility({
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

            fabricImg.borderColor = "#0066cc";
            fabricImg.cornerColor = "#0066cc";
            fabricImg.cornerSize = 8;
          }
        } else {
          // Layer is locked - hide all controls and show locked visual style
          fabricImg.setControlsVisibility({
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

          fabricImg.borderColor = "#999999";
          fabricImg.cornerColor = "#999999";
          fabricImg.cornerSize = 0;
        }

        fabricImg.transparentCorners = false;

        // Store layer ID mapping
        objectLayerMapRef.current.set(fabricImg, layer.id);

        canvas.add(fabricImg);

        // Add mask visualization if mask is enabled and visible
        if (
          layer.mask.enabled &&
          layer.mask.visible &&
          layer.mask.path.length > 0
        ) {
          const maskPoints = layer.mask.path.map((point) => ({
            x: point[0] * canvas.width,
            y: point[1] * canvas.height,
          }));

          const maskPolygon = new Polygon(maskPoints, {
            fill: "rgba(0, 255, 0, 0.2)",
            stroke: "#00ff00",
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
          });

          // Store reference to mask polygon for this layer
          (fabricImg as any)._maskPolygon = maskPolygon;
          canvas.add(maskPolygon);
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

        if (
          layer.mask.enabled &&
          layer.mask.visible &&
          layer.mask.path.length > 0
        ) {
          const maskPoints = layer.mask.path.map((point) => ({
            x: point[0] * canvas.width,
            y: point[1] * canvas.height,
          }));

          const maskPolygon = new Polygon(maskPoints, {
            fill: "rgba(0, 255, 0, 0.2)",
            stroke: "#00ff00",
            strokeWidth: 1,
            strokeDashArray: [5, 5],
            selectable: false,
            evented: false,
          });

          (fabricObj as any)._maskPolygon = maskPolygon;
          canvas.add(maskPolygon);
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
