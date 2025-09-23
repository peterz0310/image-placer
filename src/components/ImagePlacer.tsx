"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Project, Layer, BaseImage, CanvasState } from "@/types";
import FabricCanvas, { FabricCanvasRef } from "./FabricCanvas";
import LayerProperties from "./LayerProperties";
import FloatingToolbar from "./FloatingToolbar";
import { ProjectExporter, renderComposite } from "@/utils/export";
import JSZip from "jszip";
import { v4 as uuidv4 } from "uuid";
import {
  Upload,
  FolderOpen,
  RotateCcw,
  Plus,
  Archive,
  Move3D,
  Maximize,
  MousePointer2,
  Scissors,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Trash2,
  Image as ImageIcon,
  Check,
  X,
  Layers,
  Square,
} from "lucide-react";

export default function ImagePlacer() {
  const [project, setProject] = useState<Project | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
    tool: "select",
    transformMode: "normal",
  });

  const [maskDrawingState, setMaskDrawingState] = useState({
    isDrawing: false,
    pointCount: 0,
  });

  const [error, setError] = useState<string | null>(null);

  // Memoize sorted layers for better performance (layers don't have zIndex, so use array order)
  const sortedLayers = useMemo(() => {
    if (!project?.layers) return [];
    return [...project.layers];
  }, [project?.layers]);

  // Memoize selected layer for performance
  const selectedLayer = useMemo(() => {
    if (!canvasState.selectedLayerId || !project?.layers) return undefined;
    return project.layers.find(
      (layer) => layer.id === canvasState.selectedLayerId
    );
  }, [canvasState.selectedLayerId, project?.layers]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fabricCanvasRef = useRef<FabricCanvasRef>(null);

  // Update mask drawing state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (fabricCanvasRef.current && canvasState.tool === "mask") {
        const state = fabricCanvasRef.current.getMaskDrawingState();
        setMaskDrawingState(state);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [canvasState.tool]);

  // Update canvas selection when selectedLayerId changes
  useEffect(() => {
    if (fabricCanvasRef.current) {
      if (canvasState.selectedLayerId) {
        fabricCanvasRef.current.selectLayer(canvasState.selectedLayerId);
      } else {
        // Clear selection when no layer is selected
        fabricCanvasRef.current.clearSelection();
      }
    }
  }, [canvasState.selectedLayerId]);

  /**
   * Updates layer properties and triggers canvas re-render
   */
  const handleLayerUpdate = useCallback(
    (layerId: string, updates: Partial<Layer>) => {
      if (!project) return;

      setProject((prev) => {
        if (!prev) return null;

        return {
          ...prev,
          layers: prev.layers.map((layer) =>
            layer.id === layerId ? { ...layer, ...updates } : layer
          ),
          metadata: {
            ...prev.metadata!,
            modified: new Date().toISOString(),
          },
        };
      });
    },
    [project]
  );

  /**
   * Handles base image upload and initializes a new project
   */
  const handleBaseImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear any previous errors
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const baseImage: BaseImage = {
            name: file.name,
            width: img.width,
            height: img.height,
            imageData: e.target?.result as string,
            originalFile: file,
          };

          const newProject: Project = {
            version: 1,
            base: baseImage,
            layers: [],
            metadata: {
              created: new Date().toISOString(),
              modified: new Date().toISOString(),
            },
          };

          setProject(newProject);
        } catch (error) {
          setError(
            `Failed to load base image: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      };
      img.onerror = () => {
        setError(
          "Failed to load the selected image file. Please try a different image."
        );
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      setError("Failed to read the selected file. Please try again.");
    };
    reader.readAsDataURL(file);
  };

  /**
   * Handles overlay image uploads and adds them as new layers
   */
  const handleOverlayUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !project) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      // Generate unique name if duplicate exists
      const generateUniqueName = (
        baseName: string,
        existingLayers: Layer[]
      ): string => {
        const existingNames = existingLayers.map((layer) => layer.name);
        if (!existingNames.includes(baseName)) {
          return baseName;
        }

        const nameParts = baseName.split(".");
        const extension = nameParts.pop();
        const nameWithoutExt = nameParts.join(".");

        let counter = 1;
        let uniqueName;
        do {
          uniqueName = `${nameWithoutExt} (${counter})${
            extension ? "." + extension : ""
          }`;
          counter++;
        } while (existingNames.includes(uniqueName));

        return uniqueName;
      };

      const uniqueName = generateUniqueName(file.name, project.layers);

      const newLayer: Layer = {
        id: uuidv4(),
        name: uniqueName,
        transform: {
          left: 0.5,
          top: 0.5,
          scaleX: 0.25,
          scaleY: 0.25,
          angle: 0,
        },
        quad: {
          enabled: false,
          points: [],
        },
        mask: {
          enabled: false,
          visible: true,
          path: [],
          feather: 0,
        },
        opacity: 1,
        visible: true,
        locked: false,
        imageData: e.target?.result as string,
        originalFile: file,
      };

      setProject((prev) =>
        prev
          ? {
              ...prev,
              layers: [...prev.layers, newLayer],
              metadata: {
                ...prev.metadata!,
                modified: new Date().toISOString(),
              },
            }
          : null
      );

      // Switch to transform mode and select the new layer
      setCanvasState((prev) => ({
        ...prev,
        selectedLayerId: newLayer.id,
        tool: "select",
      }));
    };
    reader.readAsDataURL(file);

    // Clear the input so the same file can be selected again
    event.target.value = "";
  };

  /**
   * Exports the current project as a ZIP file with all assets
   */
  const exportProjectZIP = async () => {
    if (!project) return;

    try {
      // First render the composite
      const compositeBlob = await renderComposite(project, 1);

      // Then create the ZIP
      const zipBlob = await ProjectExporter.exportZIP(project, compositeBlob, {
        includeOriginalAssets: true,
        renderScale: 1,
        format: "png",
        quality: 1.0,
      });

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-");
      ProjectExporter.downloadBlob(
        zipBlob,
        `image-placer-project-${timestamp}.zip`
      );
    } catch (error) {
      console.error("Error exporting ZIP:", error);
    }
  };

  const loadProject = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(".zip")) {
      // Handle ZIP file
      try {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);

        // Look for project.json
        const projectFile = zipContent.files["project.json"];
        if (!projectFile) {
          alert("Invalid project ZIP: project.json not found");
          return;
        }

        const projectJson = await projectFile.async("string");
        const projectData = JSON.parse(projectJson) as Project;

        // Add backward compatibility for mask visibility
        projectData.layers.forEach((layer) => {
          if (layer.mask && typeof layer.mask.visible === "undefined") {
            layer.mask.visible = true; // Default to visible for existing projects
          }
        });

        // Load base image from assets
        const baseImageFile =
          zipContent.files[`assets/${projectData.base.name}`];
        if (baseImageFile) {
          const baseImageBlob = await baseImageFile.async("blob");
          const baseImageDataUrl = await blobToDataURL(
            baseImageBlob,
            projectData.base.name
          );
          projectData.base.imageData = baseImageDataUrl;
        }

        // Load layer images from assets
        for (const layer of projectData.layers) {
          const layerImageFile = zipContent.files[`assets/${layer.name}`];
          if (layerImageFile) {
            const layerImageBlob = await layerImageFile.async("blob");
            const layerImageDataUrl = await blobToDataURL(
              layerImageBlob,
              layer.name
            );
            layer.imageData = layerImageDataUrl;
          }
        }

        setProject({
          ...projectData,
          metadata: {
            created: projectData.metadata?.created || new Date().toISOString(),
            modified: new Date().toISOString(),
            author: projectData.metadata?.author,
          },
        });
      } catch (error) {
        console.error("Error loading ZIP project:", error);
        alert("Error loading ZIP project file. Please check the file format.");
      }
    } else {
      // Handle JSON file (existing logic)
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const projectData = JSON.parse(e.target?.result as string) as Project;

          // Add backward compatibility for mask visibility
          projectData.layers.forEach((layer) => {
            if (layer.mask && typeof layer.mask.visible === "undefined") {
              layer.mask.visible = true; // Default to visible for existing projects
            }
          });

          setProject({
            ...projectData,
            metadata: {
              created:
                projectData.metadata?.created || new Date().toISOString(),
              modified: new Date().toISOString(),
              author: projectData.metadata?.author,
            },
          });

          // Reset canvas state for new project
          setCanvasState((prev) => ({
            ...prev,
            selectedLayerId: undefined,
          }));
        } catch (error) {
          console.error("Error loading JSON project:", error);
          alert("Error loading project file. Please check the file format.");
        }
      };
      reader.readAsText(file);
    }

    // Clear the input
    event.target.value = "";
  };

  /**
   * Converts a Blob to a data URL with proper MIME type detection
   * Handles cases where JSZip extracts files with incorrect MIME types
   */
  const blobToDataURL = (blob: Blob, filename?: string): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      try {
        // If blob doesn't have proper MIME type, try to infer it from filename
        let mimeType = blob.type;

        if (
          (blob.type === "application/octet-stream" || !blob.type) &&
          filename
        ) {
          const ext = filename.toLowerCase().split(".").pop();

          switch (ext) {
            case "jpg":
            case "jpeg":
              mimeType = "image/jpeg";
              break;
            case "png":
              mimeType = "image/png";
              break;
            case "gif":
              mimeType = "image/gif";
              break;
            case "webp":
              mimeType = "image/webp";
              break;
            case "bmp":
              mimeType = "image/bmp";
              break;
            default:
              mimeType = "application/octet-stream";
          }
        }

        // Convert blob to array buffer and then to base64
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        const dataURL = `data:${mimeType};base64,${base64}`;
        resolve(dataURL);
      } catch (error) {
        reject(error);
      }
    });
  };

  const resetProject = () => {
    if (
      confirm(
        "Are you sure you want to start over? This will clear all your work."
      )
    ) {
      setProject(null);
      setCanvasState({
        zoom: 1,
        pan: { x: 0, y: 0 },
        tool: "select",
        transformMode: "normal",
      });

      // Reset mask drawing state
      setMaskDrawingState({
        isDrawing: false,
        pointCount: 0,
      });

      // Clear file input values to allow reloading the same files
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (overlayInputRef.current) {
        overlayInputRef.current.value = "";
      }
      if (projectInputRef.current) {
        projectInputRef.current.value = "";
      }

      // Clear canvas selection to ensure clean state
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.clearSelection();
      }
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 text-white p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <div className="relative">
            <ImageIcon size={24} className="text-gray-300" />
            <Layers
              size={12}
              className="text-blue-400 absolute -bottom-0.5 -right-0.5"
            />
          </div>
          Image Placer
        </h1>
        <div className="flex gap-2">
          {!project ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm flex items-center gap-2"
              >
                <Upload size={16} />
                Load Base Image
              </button>
              <button
                onClick={() => projectInputRef.current?.click()}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-sm flex items-center gap-2"
              >
                <FolderOpen size={16} />
                Load Project
              </button>
            </>
          ) : (
            <>
              <button
                onClick={exportProjectZIP}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm flex items-center gap-2"
              >
                <Archive size={16} />
                Export
              </button>
              <button
                onClick={resetProject}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm flex items-center gap-2"
              >
                <RotateCcw size={16} />
                Reset
              </button>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleBaseImageUpload}
          className="hidden"
        />
        <input
          ref={overlayInputRef}
          type="file"
          accept="image/*"
          onChange={handleOverlayUpload}
          className="hidden"
        />
        <input
          ref={projectInputRef}
          type="file"
          accept=".json,.zip"
          onChange={loadProject}
          className="hidden"
        />
      </header>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <X className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <div className="ml-auto pl-3">
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar - Layers */}
        {project && (
          <div className="w-80 bg-gray-100 border-r flex flex-col min-h-0">
            {/* Fixed Header */}
            <div className="p-4 flex-shrink-0">
              <h3 className="font-semibold mb-4 text-gray-900 flex items-center gap-2">
                <Layers size={20} className="text-gray-600" />
                Layers
              </h3>

              {/* Base Image Info */}
              <div className="mb-4 p-3 bg-white rounded border">
                <div className="font-medium text-sm text-gray-800 flex items-center gap-2">
                  <Square size={16} className="text-blue-600" />
                  Base Image
                </div>
                <div className="text-sm text-gray-900 ml-6">
                  {project.base.name}
                </div>
                <div className="text-xs text-gray-700 ml-6">
                  {project.base.width} × {project.base.height}
                </div>
              </div>

              {/* Add Overlay Button */}
              <div className="mb-4">
                <button
                  onClick={() => overlayInputRef.current?.click()}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                  <Plus size={18} />
                  Add Overlay Image
                </button>
              </div>
            </div>

            {/* Scrollable Layers List */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="space-y-2">
                {project.layers.map((layer, index) => (
                  <div
                    key={layer.id}
                    className={`p-3 bg-white rounded border cursor-pointer transition-colors ${
                      canvasState.selectedLayerId === layer.id
                        ? "border-blue-500 bg-blue-50"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setCanvasState((prev) => ({
                        ...prev,
                        selectedLayerId: layer.id,
                        tool: "select", // Switch to transform mode when selecting a layer
                      }));
                      fabricCanvasRef.current?.selectLayer(layer.id);
                    }}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex items-center gap-2">
                          {/* Image thumbnail preview */}
                          <div className="w-8 h-8 rounded border bg-gray-100 flex-shrink-0 overflow-hidden">
                            {layer.imageData ? (
                              <img
                                src={layer.imageData}
                                alt={layer.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ImageIcon
                                size={16}
                                className="text-gray-400 m-auto"
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className="font-medium text-sm text-gray-900 leading-tight"
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 2,
                                overflow: "hidden",
                                wordBreak: "break-word",
                              }}
                            >
                              {layer.name}
                            </div>
                            <div className="text-xs text-gray-700 mt-1">
                              Opacity: {Math.round(layer.opacity * 100)}%
                              {!layer.visible && " • Hidden"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 items-center">
                        {/* Visibility toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProject((prev) => {
                              if (!prev) return null;

                              return {
                                ...prev,
                                layers: prev.layers.map((l) =>
                                  l.id === layer.id
                                    ? { ...l, visible: !l.visible }
                                    : l
                                ),
                                metadata: {
                                  ...prev.metadata!,
                                  modified: new Date().toISOString(),
                                },
                              };
                            });
                          }}
                          className={`text-xs px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                            layer.visible
                              ? "bg-blue-600 hover:bg-blue-700 text-white"
                              : "bg-gray-300 hover:bg-gray-400 text-gray-700"
                          }`}
                          title={layer.visible ? "Hide layer" : "Show layer"}
                        >
                          {layer.visible ? (
                            <Eye size={14} />
                          ) : (
                            <EyeOff size={14} />
                          )}
                        </button>

                        {/* Lock toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProject((prev) => {
                              if (!prev) return null;

                              const targetLayer = prev.layers.find(
                                (l) => l.id === layer.id
                              );
                              if (!targetLayer) return prev;

                              const wasLocked = targetLayer.locked;

                              // If we're unlocking and this layer is selected, make sure it becomes selectable
                              if (
                                wasLocked &&
                                canvasState.selectedLayerId === layer.id
                              ) {
                                // Force canvas to update selection after unlocking
                                setTimeout(() => {
                                  fabricCanvasRef.current?.selectLayer(
                                    layer.id
                                  );
                                }, 50);
                              }

                              return {
                                ...prev,
                                layers: prev.layers.map((l) =>
                                  l.id === layer.id
                                    ? { ...l, locked: !l.locked }
                                    : l
                                ),
                                metadata: {
                                  ...prev.metadata!,
                                  modified: new Date().toISOString(),
                                },
                              };
                            });
                          }}
                          className={`text-xs px-2 py-1 rounded transition-colors font-medium flex items-center gap-1 ${
                            layer.locked
                              ? "bg-yellow-600 hover:bg-yellow-700 text-white"
                              : "bg-gray-300 hover:bg-gray-400 text-gray-700"
                          }`}
                          title={layer.locked ? "Unlock layer" : "Lock layer"}
                        >
                          {layer.locked ? (
                            <Lock size={14} />
                          ) : (
                            <LockOpen size={14} />
                          )}
                        </button>

                        {/* Delete button */}
                        <button
                          className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors font-medium flex items-center gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            fabricCanvasRef.current?.removeLayer(layer.id);
                            setProject((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    layers: prev.layers.filter(
                                      (l) => l.id !== layer.id
                                    ),
                                  }
                                : null
                            );
                            if (canvasState.selectedLayerId === layer.id) {
                              setCanvasState((prev) => ({
                                ...prev,
                                selectedLayerId: undefined,
                              }));
                            }
                          }}
                          title="Delete layer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Mask Controls */}
                    <div className="border-t pt-2 space-y-2">
                      <div className="text-xs font-medium text-gray-800 mb-1">
                        Mask
                      </div>

                      <div className="flex items-center justify-between">
                        <label className="flex items-center text-xs">
                          <input
                            type="checkbox"
                            checked={layer.mask.enabled}
                            onChange={(e) => {
                              e.stopPropagation();
                              setProject((prev) => {
                                if (!prev) return null;

                                return {
                                  ...prev,
                                  layers: prev.layers.map((l) =>
                                    l.id === layer.id
                                      ? {
                                          ...l,
                                          mask: {
                                            ...l.mask,
                                            enabled: e.target.checked,
                                          },
                                        }
                                      : l
                                  ),
                                  metadata: {
                                    ...prev.metadata!,
                                    modified: new Date().toISOString(),
                                  },
                                };
                              });
                            }}
                            className="mr-1 w-3 h-3"
                          />
                          <span className="text-gray-700">Enable</span>
                        </label>

                        <label className="flex items-center text-xs">
                          <input
                            type="checkbox"
                            checked={layer.mask.visible}
                            onChange={(e) => {
                              e.stopPropagation();
                              setProject((prev) => {
                                if (!prev) return null;

                                return {
                                  ...prev,
                                  layers: prev.layers.map((l) =>
                                    l.id === layer.id
                                      ? {
                                          ...l,
                                          mask: {
                                            ...l.mask,
                                            visible: e.target.checked,
                                          },
                                        }
                                      : l
                                  ),
                                  metadata: {
                                    ...prev.metadata!,
                                    modified: new Date().toISOString(),
                                  },
                                };
                              });
                            }}
                            className="mr-1 w-3 h-3"
                          />
                          <span className="text-gray-700">Show</span>
                        </label>
                      </div>

                      {!layer.locked && (
                        <div className="text-xs text-gray-600 mt-2 p-2 bg-blue-50 rounded">
                          {canvasState.tool === "mask" &&
                          canvasState.selectedLayerId === layer.id ? (
                            <span className="text-blue-700 flex items-center gap-1">
                              <MousePointer2 size={12} />
                              Click on canvas to start drawing mask
                            </span>
                          ) : (
                            <span>
                              Switch to Mask tool to draw on this layer
                            </span>
                          )}
                        </div>
                      )}

                      {layer.mask.path.length > 0 && (
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>{layer.mask.path.length} points</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLayerUpdate(layer.id, {
                                mask: { ...layer.mask, path: [] },
                              });
                            }}
                            className="text-red-600 hover:text-red-700"
                          >
                            Clear
                          </button>
                        </div>
                      )}

                      {layer.mask.enabled && (
                        <div className="space-y-1">
                          <label className="block text-xs text-gray-700">
                            Feather: {layer.mask.feather.toFixed(1)}px
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="10"
                            step="0.5"
                            value={layer.mask.feather}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleLayerUpdate(layer.id, {
                                mask: {
                                  ...layer.mask,
                                  feather: parseFloat(e.target.value),
                                },
                              });
                            }}
                            className="w-full h-1"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Canvas Area */}
        <div className="flex-1 bg-gray-50 flex items-center justify-center relative">
          {project && (
            <FloatingToolbar
              tool={canvasState.tool}
              transformMode={canvasState.transformMode}
              onToolChange={(tool) =>
                setCanvasState((prev) => ({ ...prev, tool }))
              }
              onTransformModeChange={(transformMode) =>
                setCanvasState((prev) => ({ ...prev, transformMode }))
              }
            />
          )}
          {project ? (
            <FabricCanvas
              ref={fabricCanvasRef}
              project={project}
              onLayerUpdate={handleLayerUpdate}
              selectedLayerId={canvasState.selectedLayerId}
              transformMode={canvasState.transformMode}
              canvasState={canvasState}
              onCanvasStateChange={setCanvasState}
              onMaskFinished={() => {
                // Switch back to transform mode when mask drawing is finished
                setCanvasState((prev) => ({
                  ...prev,
                  tool: "select",
                }));
              }}
              onLayerSelected={(layerId) => {
                // When a layer is selected on canvas, update the layer selection and switch to transform mode
                setCanvasState((prev) => ({
                  ...prev,
                  selectedLayerId: layerId,
                  tool: "select",
                }));
              }}
            />
          ) : (
            <div className="text-center text-gray-500 max-w-md mx-auto p-8">
              <div className="flex justify-center mb-6">
                <div className="relative">
                  <ImageIcon size={64} className="text-gray-300" />
                  <Layers
                    size={24}
                    className="text-blue-400 absolute -bottom-1 -right-1"
                  />
                </div>
              </div>
              <h1 className="text-2xl mb-4 font-bold text-gray-800">
                Welcome to Image Placer
              </h1>
              <p className="text-base mb-6 text-gray-600 leading-relaxed">
                Create stunning compositions by layering images with precision
                tools for transformation, masking, and positioning.
              </p>

              <div className="text-left space-y-4 mb-8">
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <Upload size={16} className="text-blue-500" />
                    Getting Started
                  </h3>
                  <p className="text-sm text-gray-600">
                    Load a base image to start your project, then add overlay
                    images as layers.
                  </p>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <Move3D size={16} className="text-green-500" />
                    Features
                  </h3>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Transform layers (move, scale, rotate, skew)</li>
                    <li>• Create custom masks for precise control</li>
                    <li>• Adjust opacity and layer visibility</li>
                    <li>• Export high-quality compositions</li>
                  </ul>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <Archive size={16} className="text-orange-500" />
                    Project Management
                  </h3>
                  <p className="text-sm text-gray-600">
                    Save your work as project files and resume editing anytime
                    with full layer preservation.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
                >
                  <Upload size={18} />
                  Start with Base Image
                </button>
                <button
                  onClick={() => projectInputRef.current?.click()}
                  className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
                >
                  <FolderOpen size={18} />
                  Load Project
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Layer Properties */}
        {project && (
          <div className="w-80 bg-gray-100 border-l">
            {/* Transform Mode Indicator */}
            <div className="p-4 border-b bg-gray-50">
              {canvasState.tool === "mask" ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-sm font-medium text-gray-900">
                      Mask Mode
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 space-y-2">
                    {canvasState.selectedLayerId ? (
                      <>
                        {maskDrawingState.isDrawing ? (
                          <div className="space-y-2">
                            <p className="text-green-700 font-medium">
                              Drawing mask... ({maskDrawingState.pointCount}{" "}
                              points)
                            </p>
                            <p>• Click to add points</p>
                            <p>• Double-click to finish (need 3+ points)</p>
                            <p>• Right-click to cancel</p>

                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() =>
                                  fabricCanvasRef.current?.finishMaskDrawing()
                                }
                                disabled={maskDrawingState.pointCount < 3}
                                className={`px-3 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                                  maskDrawingState.pointCount >= 3
                                    ? "bg-green-600 hover:bg-green-700 text-white"
                                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                                }`}
                              >
                                <Check size={12} />
                                Finish Mask
                              </button>
                              <button
                                onClick={() =>
                                  fabricCanvasRef.current?.cancelMaskDrawing()
                                }
                                className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center gap-1"
                              >
                                <X size={12} />
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p>• Click on canvas to start drawing mask</p>
                            <p>• Points will appear as red dots</p>
                            <p>• Use the controls below when drawing</p>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="text-orange-600 font-medium">
                        Please select a layer to draw a mask
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        canvasState.transformMode === "skew"
                          ? "bg-orange-500"
                          : "bg-blue-500"
                      }`}
                    ></div>
                    <span className="text-sm font-medium text-gray-900">
                      {canvasState.transformMode === "skew"
                        ? "Skew Mode"
                        : "Transform Mode"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    {canvasState.transformMode === "skew"
                      ? "Drag corners to skew the selected layer"
                      : "Drag corners to scale, center to move, rotation handle to rotate"}
                  </p>
                </div>
              )}
            </div>

            <LayerProperties
              layer={
                canvasState.selectedLayerId
                  ? project.layers.find(
                      (l) => l.id === canvasState.selectedLayerId
                    ) || null
                  : null
              }
              onUpdateLayer={(updates) => {
                if (canvasState.selectedLayerId) {
                  handleLayerUpdate(canvasState.selectedLayerId, updates);
                  // Update the fabric canvas as well
                  const updatedLayer = {
                    ...project.layers.find(
                      (l) => l.id === canvasState.selectedLayerId
                    )!,
                    ...updates,
                  };
                  fabricCanvasRef.current?.updateLayer(updatedLayer);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
