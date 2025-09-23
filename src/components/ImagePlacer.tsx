"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Project, Layer, BaseImage, CanvasState } from "@/types";
import FabricCanvas, { FabricCanvasRef } from "./FabricCanvas";
import LayerProperties from "./LayerProperties";
import { ProjectExporter, renderComposite } from "@/utils/export";
import JSZip from "jszip";
import { v4 as uuidv4 } from "uuid";

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

  const handleLayerUpdate = useCallback(
    (layerId: string, updates: Partial<Layer>) => {
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
    []
  );

  const handleBaseImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
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
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

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
          path: [],
          feather: 0,
        },
        opacity: 1,
        blendMode: "normal",
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
    };
    reader.readAsDataURL(file);

    // Clear the input so the same file can be selected again
    event.target.value = "";
  };

  const exportProjectJSON = async () => {
    if (!project) return;

    try {
      const blob = await ProjectExporter.exportJSON(project);
      ProjectExporter.downloadBlob(blob, "project.json");
    } catch (error) {
      console.error("Error exporting JSON:", error);
    }
  };

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

        // Load base image from assets
        const baseImageFile =
          zipContent.files[`assets/${projectData.base.name}`];
        if (baseImageFile) {
          const baseImageBlob = await baseImageFile.async("blob");
          const baseImageDataUrl = await blobToDataURL(baseImageBlob);
          projectData.base.imageData = baseImageDataUrl;
        }

        // Load layer images from assets
        for (const layer of projectData.layers) {
          const layerImageFile = zipContent.files[`assets/${layer.name}`];
          if (layerImageFile) {
            const layerImageBlob = await layerImageFile.async("blob");
            const layerImageDataUrl = await blobToDataURL(layerImageBlob);
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

        console.log("ZIP project loaded successfully");
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

          setProject({
            ...projectData,
            metadata: {
              created:
                projectData.metadata?.created || new Date().toISOString(),
              modified: new Date().toISOString(),
              author: projectData.metadata?.author,
            },
          });

          // Reset canvas state
          setCanvasState((prev) => ({
            ...prev,
            selectedLayerId: undefined,
          }));

          console.log("JSON project loaded successfully");
        } catch (error) {
          console.error("Error loading project:", error);
          alert("Error loading project file. Please check the file format.");
        }
      };
      reader.readAsText(file);
    }

    // Clear the input
    event.target.value = "";
  };

  const blobToDataURL = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 text-white p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Image Placer</h1>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
            disabled={false}
          >
            Load Base Image
          </button>
          <button
            onClick={() => projectInputRef.current?.click()}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-sm"
          >
            Load Project
          </button>

          {/* Transform Mode Toggle */}
          {project && (
            <div className="flex bg-gray-700 rounded">
              <button
                onClick={() =>
                  setCanvasState((prev) => ({
                    ...prev,
                    transformMode: "normal",
                  }))
                }
                className={`px-3 py-2 text-sm rounded-l transition-colors ${
                  canvasState.transformMode === "normal"
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-600"
                }`}
              >
                Transform
              </button>
              <button
                onClick={() =>
                  setCanvasState((prev) => ({ ...prev, transformMode: "skew" }))
                }
                className={`px-3 py-2 text-sm rounded-r transition-colors ${
                  canvasState.transformMode === "skew"
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-600"
                }`}
              >
                Skew
              </button>
            </div>
          )}

          {/* Tool Selection */}
          {project && (
            <div className="flex bg-gray-700 rounded">
              <button
                onClick={() =>
                  setCanvasState((prev) => ({ ...prev, tool: "select" }))
                }
                className={`px-3 py-2 text-sm rounded-l transition-colors ${
                  canvasState.tool === "select"
                    ? "bg-green-600 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-600"
                }`}
              >
                Select
              </button>
              <button
                onClick={() =>
                  setCanvasState((prev) => ({ ...prev, tool: "mask" }))
                }
                className={`px-3 py-2 text-sm rounded-r transition-colors ${
                  canvasState.tool === "mask"
                    ? "bg-green-600 text-white"
                    : "text-gray-300 hover:text-white hover:bg-gray-600"
                }`}
              >
                Mask
              </button>
            </div>
          )}
          {project && (
            <>
              <button
                onClick={() => overlayInputRef.current?.click()}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
              >
                Add Overlay
              </button>
              <button
                onClick={exportProjectJSON}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm"
              >
                Export JSON
              </button>
              <button
                onClick={exportProjectZIP}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm"
              >
                Export ZIP
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

      <div className="flex-1 flex">
        {/* Left Sidebar - Layers */}
        {project && (
          <div className="w-80 bg-gray-100 border-r flex flex-col">
            <div className="p-4">
              <h3 className="font-semibold mb-4 text-gray-900">Layers</h3>

              {/* Base Image Info */}
              <div className="mb-4 p-3 bg-white rounded border">
                <div className="font-medium text-sm text-gray-800">
                  Base Image
                </div>
                <div className="text-sm text-gray-900">{project.base.name}</div>
                <div className="text-xs text-gray-700">
                  {project.base.width} × {project.base.height}
                </div>
              </div>

              {/* Layers List */}
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
                      }));
                      fabricCanvasRef.current?.selectLayer(layer.id);
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium text-sm text-gray-900">
                          {layer.name}
                        </div>
                        <div className="text-xs text-gray-700">
                          Opacity: {Math.round(layer.opacity * 100)}%
                          {!layer.visible && " • Hidden"}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors font-medium"
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
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Canvas Area */}
        <div className="flex-1 bg-gray-50 flex items-center justify-center">
          {project ? (
            <FabricCanvas
              ref={fabricCanvasRef}
              project={project}
              onLayerUpdate={handleLayerUpdate}
              selectedLayerId={canvasState.selectedLayerId}
              transformMode={canvasState.transformMode}
              canvasState={canvasState}
              onCanvasStateChange={setCanvasState}
            />
          ) : (
            <div className="text-center text-gray-500">
              <p className="text-lg mb-2">Welcome to Image Placer</p>
              <p>
                Start by loading a base image to begin creating your composition
              </p>
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
                                className={`px-3 py-1 text-xs rounded transition-colors ${
                                  maskDrawingState.pointCount >= 3
                                    ? "bg-green-600 hover:bg-green-700 text-white"
                                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                                }`}
                              >
                                Finish Mask
                              </button>
                              <button
                                onClick={() =>
                                  fabricCanvasRef.current?.cancelMaskDrawing()
                                }
                                className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                              >
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
