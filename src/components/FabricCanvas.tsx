"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { Canvas, Image as FabricImage, FabricObject } from "fabric";
import { Project, Layer } from "@/types";

interface FabricCanvasProps {
  project: Project | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  selectedLayerId?: string;
  transformMode?: "normal" | "skew";
}

export interface FabricCanvasRef {
  updateLayer: (layer: Layer) => void;
  removeLayer: (layerId: string) => void;
  selectLayer: (layerId: string) => void;
  exportCanvas: (scale?: number) => Promise<string>;
}

const FabricCanvas = forwardRef<FabricCanvasRef, FabricCanvasProps>(
  (
    { project, onLayerUpdate, selectedLayerId, transformMode = "normal" },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<Canvas | null>(null);
    const objectLayerMapRef = useRef<Map<FabricObject, string>>(new Map());

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
      exportCanvas: (scale = 1) => {
        return exportCanvasAsDataURL(scale);
      },
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

        console.log("Object modified with transform:", normalizedTransform);

        onLayerUpdate(layerId, {
          transform: normalizedTransform,
        });
      });

      // Add additional debugging events for skew mode
      canvas.on("object:scaling", (e) => {
        if (transformMode === "skew") {
          console.log("Scaling in skew mode:", {
            skewX: e.target?.skewX,
            skewY: e.target?.skewY,
            scaleX: e.target?.scaleX,
            scaleY: e.target?.scaleY,
          });
        }
      });

      canvas.on("object:skewing", (e) => {
        console.log("Skewing detected:", {
          skewX: e.target?.skewX,
          skewY: e.target?.skewY,
        });
      });

      // Handle selection events
      canvas.on("selection:created", (e) => {
        const obj = e.selected?.[0];
        if (obj) {
          const layerId = objectLayerMapRef.current.get(obj);
          if (layerId) {
            // Could emit selection change event here
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
      if (!project || !fabricCanvasRef.current) return;

      updateCanvasFromProject(project);
    }, [project]);

    // Update transform controls when mode changes
    useEffect(() => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      console.log(`Transform mode changed to: ${transformMode}`);

      const objects = canvas.getObjects();
      console.log(`Canvas has ${objects.length} objects`);

      objects.forEach((obj, index) => {
        console.log(`Object ${index} properties before update:`, {
          type: obj.type,
          hasControls: obj.hasControls,
          lockSkewingX: obj.lockSkewingX,
          lockSkewingY: obj.lockSkewingY,
        });

        if (transformMode === "skew") {
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
    }, [transformMode]);

    const updateCanvasFromProject = async (project: Project) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

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

      canvas.setWidth(project.base.width * scale);
      canvas.setHeight(project.base.height * scale);

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
        });

        // Apply transform mode settings immediately
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

        fabricImg.transparentCorners = false;

        // Store layer ID mapping
        objectLayerMapRef.current.set(fabricImg, layer.id);

        canvas.add(fabricImg);
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
        });

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
        canvas.remove(fabricObj);
        objectLayerMapRef.current.delete(fabricObj);
        canvas.renderAll();
      }
    };

    const selectFabricLayer = (layerId: string) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();
      const fabricObj = objects.find(
        (obj) => objectLayerMapRef.current.get(obj) === layerId
      );

      if (fabricObj) {
        canvas.setActiveObject(fabricObj);
        canvas.renderAll();
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
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
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
