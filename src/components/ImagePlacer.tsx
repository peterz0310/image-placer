"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import NextImage from "next/image";
import { Project, Layer, BaseImage, CanvasState, DetectedMask } from "@/types";
import FabricCanvas, { FabricCanvasRef } from "./FabricCanvas";
import LayerProperties from "./LayerProperties";
import FloatingToolbar from "./FloatingToolbar";
import { ProjectExporter, renderComposite } from "@/utils/export";
import { CANVAS_MAX_WIDTH, CANVAS_MAX_HEIGHT } from "@/constants/canvas";
import { useHistory, useHistoryKeyboard } from "@/hooks/useHistory";
import { getSegmentationInstance } from "@/utils/segmentation";
import { createMaskFromColorSelection } from "@/utils/colorSelection";
import JSZip from "jszip";
import { v4 as uuidv4 } from "uuid";
import {
  type LucideIcon,
  Upload,
  FolderOpen,
  RotateCcw,
  FlipHorizontal,
  Plus,
  Archive,
  Move3D,
  MousePointer2,
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
  Lightbulb,
  Keyboard,
  LifeBuoy,
  Sparkles,
  Pipette,
} from "lucide-react";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;

type WelcomeCallout = {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  description: string;
  bullets?: string[];
};

type QuickStartItem = {
  title: string;
  description: string;
};

const WELCOME_CALLOUTS: WelcomeCallout[] = [
  {
    icon: Upload,
    iconColor: "text-sky-500",
    title: "Bring in your visuals",
    description:
      "Import backgrounds, supporting artwork, or mockups from your library while keeping every layer editable.",
    bullets: [
      "Works with product shots, UI frames, textures, and more",
      "Transparent assets stay intact for compositing",
      "Projects reopen exactly where you left off",
    ],
  },
  {
    icon: Move3D,
    iconColor: "text-emerald-500",
    title: "Arrange every layer with control",
    description:
      "Move, transform, and mask elements using familiar tools so compositions come together quickly.",
    bullets: [
      "Drag, resize, and align directly on the canvas",
      "Switch between standard and skew transforms when perspective is needed",
      "Mask any layer to fine-tune focus and balance",
    ],
  },
  {
    icon: Archive,
    iconColor: "text-orange-500",
    title: "Share polished outputs",
    description:
      "Export flattened previews or save the full project package whenever you need to hand off or iterate.",
    bullets: [
      "Render composites for quick approvals",
      "Bundle source layers and project data for collaborators",
      "Keep brand layouts consistent across versions",
    ],
  },
];

const QUICK_START_ITEMS: QuickStartItem[] = [
  {
    title: "Drop in a background",
    description:
      "Choose the foundation for your scene so every new element has the right context.",
  },
  {
    title: "Stack supporting artwork",
    description:
      "Add logos, screenshots, or renders as separate layers to build the story.",
  },
  {
    title: "Shape the focus",
    description:
      "Mask, blend, and align pieces until the composition feels balanced.",
  },
  {
    title: "Export variations",
    description:
      "Save a composite image or the full project package whenever you need a new version.",
  },
];

const KEYBOARD_SHORTCUTS: QuickStartItem[] = [
  {
    title: "Undo / Redo",
    description: "Cmd/Ctrl + Z and Cmd/Ctrl + Shift + Z",
  },
  {
    title: "Delete Layer",
    description: "Backspace or Delete",
  },
  {
    title: "Toggle Mask Mode",
    description: "Press M while a layer is selected",
  },
  {
    title: "Reset Canvas Zoom",
    description: "Double-click the zoom indicator in the toolbar",
  },
];

const SUPPORT_TIPS = [
  "Name or tag related layers so feedback rounds stay organized.",
  "Reset the zoom whenever you need a quick full-canvas check.",
  "Duplicate promising variations before you head down a new path.",
];

const roundFraction = (value: number, precision = 5) => {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const mirrorNormalizedX = (value: number) => {
  return roundFraction(1 - value, 5);
};

const mirrorMask = (mask: Layer["mask"]): Layer["mask"] => {
  const mirrorPoint = ([x, y]: [number, number]): [number, number] => [
    Math.min(Math.max(mirrorNormalizedX(x), 0), 1),
    roundFraction(y),
  ];

  const mirrorPathArray = (points: [number, number][]) =>
    points.map(mirrorPoint);

  const mirroredOffset = mask.offset
    ? {
        x: roundFraction(-(mask.offset.x ?? 0)),
        y: roundFraction(mask.offset.y ?? 0),
      }
    : mask.offset;

  const mirroredEditorOffset = mask.editorOffset
    ? {
        x: roundFraction(-(mask.editorOffset.x ?? 0)),
        y: roundFraction(mask.editorOffset.y ?? 0),
      }
    : mask.editorOffset;

  return {
    ...mask,
    path: mirrorPathArray(mask.path),
    editorPath: mask.editorPath ? mirrorPathArray(mask.editorPath) : undefined,
    offset: mirroredOffset,
    editorOffset: mirroredEditorOffset,
  };
};

const loadImageElement = (source: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (error) => {
      console.error("Failed to load image for inversion", error);
      reject(new Error("Unable to load image for inversion"));
    };
    img.src = source;
  });
};

const mirrorDataURL = async (dataURL: string): Promise<string> => {
  const image = await loadImageElement(dataURL);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to access 2D context for inversion");
  }

  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(image, 0, 0);

  return canvas.toDataURL();
};

export default function ImagePlacer() {
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    saveState,
    clearHistory,
    getCurrentProject,
  } = useHistory() as ReturnType<typeof useHistory> & {
    getCurrentProject: () => Project | null;
  };

  const historyProject = getCurrentProject();
  const [localProject, setLocalProject] = useState<Project | null>(null);

  const project = localProject;
  const historyProjectRef = useRef<Project | null>(historyProject);
  const saveStateRef = useRef(saveState);

  useEffect(() => {
    if (historyProject !== null) {
      setLocalProject(historyProject);
    }
  }, [historyProject]);

  useEffect(() => {
    historyProjectRef.current = historyProject;
  }, [historyProject]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => {
    if (project?.layers) {
      const newTagInputs: Record<string, string> = {};
      project.layers.forEach((layer) => {
        if (layer.tag) {
          newTagInputs[layer.id] = layer.tag;
        }
      });
      setTagInputs(newTagInputs);
    } else {
      setTagInputs({});
    }
  }, [project?.layers]);

  useEffect(() => {
    colorPickCacheRef.current = null;
  }, [project?.base.imageData]);

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
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isInverting, setIsInverting] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [tagInputs, setTagInputs] = useState<Record<string, string>>({});

  // Segmentation state
  const [detectedMasks, setDetectedMasks] = useState<DetectedMask[]>([]);
  const [showDetections, setShowDetections] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const segmentationRef = useRef(getSegmentationInstance());

  // Detection parameters
  const [detectionConfidence, setDetectionConfidence] = useState(0.5);
  const [detectionPointCount, setDetectionPointCount] = useState(16);
  const [detectionMaskExpansion, setDetectionMaskExpansion] = useState(10);

  const [colorPickTolerance, setColorPickTolerance] = useState(0.08);
  const [colorPickPointCount, setColorPickPointCount] = useState(32);
  const [isColorPickMode, setIsColorPickMode] = useState(false);

  const tagUpdateTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  const previewGenerationRef = useRef<symbol | null>(null);
  const colorPickCacheRef = useRef<{
    imageDataUrl: string;
    imageData: ImageData;
  } | null>(null);

  useHistoryKeyboard(undo, redo, canUndo, canRedo);

  /**
   * Migrates legacy projects to include normalized scale values
   */
  const migrateProjectToNormalizedScale = useCallback(
    async (project: Project): Promise<Project> => {
      const migratedLayers = await Promise.all(
        project.layers.map(async (layer) => {
          // Skip if already has normalized scale values
          if (
            layer.transform.normalizedScaleX &&
            layer.transform.normalizedScaleY
          ) {
            return layer;
          }

          // Calculate normalized scale values for legacy layers
          if (layer.imageData) {
            try {
              const img = await new Promise<HTMLImageElement>(
                (resolve, reject) => {
                  const image = new Image();
                  image.onload = () => resolve(image);
                  image.onerror = reject;
                  image.src = layer.imageData!;
                }
              );

              const renderedWidth = img.width * layer.transform.scaleX;
              const renderedHeight = img.height * layer.transform.scaleY;

              const normalizedScaleX = renderedWidth / project.base.width;
              const normalizedScaleY = renderedHeight / project.base.height;

              return {
                ...layer,
                transform: {
                  ...layer.transform,
                  normalizedScaleX,
                  normalizedScaleY,
                },
              };
            } catch (error) {
              console.warn(`Failed to migrate layer ${layer.name}:`, error);
              return layer; // Return unchanged if migration fails
            }
          }

          return layer;
        })
      );

      return {
        ...project,
        layers: migratedLayers,
      };
    },
    []
  );

  const hydrateMaskEditorData = useCallback((project: Project): Project => {
    return {
      ...project,
      layers: project.layers.map((layer) => {
        if (!layer.mask) return layer;

        const hasEditorPath = Array.isArray(layer.mask.editorPath);
        const editorPath =
          hasEditorPath && (layer.mask.editorPath?.length ?? 0) >= 3
            ? layer.mask.editorPath!
            : layer.mask.path ?? [];

        const editorSmoothing =
          typeof layer.mask.editorSmoothing === "number"
            ? layer.mask.editorSmoothing
            : layer.mask.smoothing ?? 0;

        const editorOffset = layer.mask.editorOffset ??
          layer.mask.offset ?? { x: 0, y: 0 };

        return {
          ...layer,
          mask: {
            ...layer.mask,
            path: editorPath,
            editorPath,
            smoothing: editorSmoothing,
            editorSmoothing,
            offset: editorOffset,
            editorOffset,
          },
        };
      }),
    };
  }, []);

  /**
   * Updates project state and saves to history
   */
  const updateProject = useCallback(
    (
      updater: (prev: Project | null) => Project | null,
      description = "Update project"
    ) => {
      setLocalProject((prevLocalProject) => {
        const sourceProject = prevLocalProject ?? historyProjectRef.current;
        const nextProject = updater(sourceProject);

        if (nextProject !== sourceProject) {
          saveStateRef.current(nextProject, description);
        }

        return nextProject;
      });
    },
    []
  );

  const allMasksAtMaxSmoothing = useMemo(() => {
    if (!project || project.layers.length === 0) {
      return false;
    }

    return project.layers.every((layer) => {
      const smoothing =
        typeof layer.mask.smoothing === "number" ? layer.mask.smoothing : 0;
      const editorSmoothing =
        typeof layer.mask.editorSmoothing === "number"
          ? layer.mask.editorSmoothing
          : smoothing;

      return smoothing >= 0.999 && editorSmoothing >= 0.999;
    });
  }, [project]);

  const handleSetAllMaskSmoothing = useCallback(() => {
    updateProject((prev) => {
      if (!prev || prev.layers.length === 0) {
        return prev;
      }

      let changed = false;
      const nextLayers = prev.layers.map((layer) => {
        const smoothing =
          typeof layer.mask.smoothing === "number" ? layer.mask.smoothing : 0;
        const editorSmoothing =
          typeof layer.mask.editorSmoothing === "number"
            ? layer.mask.editorSmoothing
            : smoothing;

        if (smoothing >= 0.999 && editorSmoothing >= 0.999) {
          return layer;
        }

        changed = true;
        return {
          ...layer,
          mask: {
            ...layer.mask,
            smoothing: 1,
            editorSmoothing: 1,
          },
        };
      });

      if (!changed) {
        return prev;
      }

      const created =
        typeof prev.metadata?.created === "string" && prev.metadata.created
          ? prev.metadata.created
          : new Date().toISOString();

      return {
        ...prev,
        layers: nextLayers,
        metadata: {
          created,
          modified: new Date().toISOString(),
          author: prev.metadata?.author,
        },
      };
    }, "Set all mask smoothing to 100%");
  }, [updateProject]);

  const disableGlobalSmoothingButton =
    !project || project.layers.length === 0 || allMasksAtMaxSmoothing;

  /**
   * Debounced function to update layer tags without triggering canvas re-renders on every keystroke
   */
  const debouncedTagUpdate = useCallback(
    (layerId: string, tag: string | undefined) => {
      // Clear any existing timeout for this layer
      if (tagUpdateTimeouts.current[layerId]) {
        clearTimeout(tagUpdateTimeouts.current[layerId]);
      }

      // Set a new timeout
      tagUpdateTimeouts.current[layerId] = setTimeout(() => {
        updateProject((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            layers: prev.layers.map((l) =>
              l.id === layerId ? { ...l, tag } : l
            ),
            metadata: {
              ...prev.metadata!,
              modified: new Date().toISOString(),
            },
          };
        }, "Update tag");
      }, 500); // 500ms debounce
    },
    [updateProject]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceBaseInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fabricCanvasRef = useRef<FabricCanvasRef>(null);
  const objectURLsRef = useRef<Set<string>>(new Set());

  // Cleanup object URLs on unmount
  useEffect(() => {
    const objectURLs = objectURLsRef;
    const timeoutsRef = tagUpdateTimeouts;

    return () => {
      objectURLs.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectURLs.current.clear();

      // Clear any pending tag update timeouts
      Object.values(timeoutsRef.current).forEach((timeout) => {
        clearTimeout(timeout);
      });
      timeoutsRef.current = {};
    };
  }, []);

  // Update mask drawing state when tool changes or drawing starts/stops
  useEffect(() => {
    if (fabricCanvasRef.current && canvasState.tool === "mask") {
      const state = fabricCanvasRef.current.getMaskDrawingState();
      setMaskDrawingState(state);
    } else {
      // Reset mask drawing state when not in mask mode
      setMaskDrawingState({
        isDrawing: false,
        pointCount: 0,
      });
    }
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

  useEffect(() => {
    if (!canvasState.selectedLayerId) {
      setIsColorPickMode(false);
    }
  }, [canvasState.selectedLayerId]);

  /**
   * Updates layer properties and triggers canvas re-render
   */
  const handleLayerUpdate = useCallback(
    (layerId: string, updates: Partial<Layer>) => {
      updateProject((prev) => {
        if (!prev) return null;

        const targetLayer = prev.layers.find((layer) => layer.id === layerId);
        if (!targetLayer) {
          return prev;
        }

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
      }, `Update layer: ${layerId}`);
    },
    [updateProject]
  );

  /**
   * Handles base image upload and initializes a new project
   */
  const handleBaseImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      return;
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setError(
        "Image file is too large. Please select an image smaller than 50MB."
      );
      return;
    }

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
              author: undefined,
            },
          };

          setLocalProject(newProject);
          clearHistory(); // Clear previous history when loading a new project
          saveState(newProject, "Load base image");
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
   * Handles replacing the base image but keeps all layers and masks
   */
  const handleReplaceBaseImage = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !project) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      return;
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setError(
        "Image file is too large. Please select an image smaller than 50MB."
      );
      return;
    }

    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        try {
          // Update only the base image, keep all layers and masks
          const newBase: BaseImage = {
            name: file.name,
            width: img.width,
            height: img.height,
            imageData: e.target?.result as string,
            originalFile: file,
          };
          const updatedProject: Project = {
            ...project,
            base: newBase,
            metadata: {
              created:
                typeof project.metadata?.created === "string" &&
                project.metadata.created
                  ? project.metadata.created
                  : new Date().toISOString(),
              modified: new Date().toISOString(),
              author: project.metadata?.author,
            },
          };
          setLocalProject(updatedProject);
          saveState(updatedProject, "Replace base image");
          // Clear the input so the same file can be selected again
          if (replaceBaseInputRef.current) {
            replaceBaseInputRef.current.value = "";
          }
        } catch (error) {
          setError(
            `Failed to replace base image: ${
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
    // Clear the input so the same file can be selected again
    event.target.value = "";
  };

  /**
   * Handles overlay image uploads and adds them as new layers
   */
  const handleOverlayUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !project) return;

    // Convert FileList to array
    const filesArray = Array.from(files);

    // Validate file types and sizes
    const maxSize = 50 * 1024 * 1024;
    for (const file of filesArray) {
      if (!file.type.startsWith("image/")) {
        setError(`"${file.name}" is not a valid image file. Skipping.`);
        continue;
      }
      if (file.size > maxSize) {
        setError(`"${file.name}" is too large (max 50MB). Skipping.`);
        continue;
      }
    }

    // Clear any previous errors
    setError(null);

    // Generate unique name helper
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

    // Process all files
    const newLayers: Layer[] = [];
    let processedCount = 0;

    filesArray.forEach((file, index) => {
      // Skip invalid files
      if (!file.type.startsWith("image/") || file.size > maxSize) {
        processedCount++;
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        // Load the image to get its dimensions
        const img = new Image();
        img.onload = () => {
          const uniqueName = generateUniqueName(file.name, [
            ...project.layers,
            ...newLayers,
          ]);

          // Calculate normalized scale values
          // Start with a reasonable default size (25% of overlay image)
          const initialScaleX = 0.25;
          const initialScaleY = 0.25;

          // Use the same formula as the canvas update handler
          const maxDisplayWidth = CANVAS_MAX_WIDTH;
          const maxDisplayHeight = CANVAS_MAX_HEIGHT;
          const displayScale = Math.min(
            maxDisplayWidth / project.base.width,
            maxDisplayHeight / project.base.height,
            1
          );

          const normalizedScaleX =
            (img.width * initialScaleX) / (project.base.width * displayScale);
          const normalizedScaleY =
            (img.height * initialScaleY) / (project.base.height * displayScale);

          const newLayer: Layer = {
            id: uuidv4(),
            name: uniqueName,
            tag: undefined,
            transform: {
              left: 0.5,
              top: 0.5,
              scaleX: initialScaleX,
              scaleY: initialScaleY,
              angle: 0,
              normalizedScaleX,
              normalizedScaleY,
            },
            mask: {
              enabled: false,
              visible: true,
              path: [],
              feather: 0,
              smoothing: 0,
              offset: { x: 0, y: 0 },
            },
            opacity: 1,
            visible: true,
            locked: false,
            imageData: e.target?.result as string,
            originalFile: file,
          };

          newLayers.push(newLayer);
          processedCount++;

          // Once all files are processed, add all layers at once
          if (processedCount === filesArray.length) {
            updateProject(
              (prev) =>
                prev
                  ? {
                      ...prev,
                      layers: [...prev.layers, ...newLayers],
                      metadata: {
                        ...prev.metadata!,
                        modified: new Date().toISOString(),
                      },
                    }
                  : null,
              `Add ${newLayers.length} layer${
                newLayers.length !== 1 ? "s" : ""
              }`
            );

            // Switch to transform mode and select the last added layer
            if (newLayers.length > 0) {
              setCanvasState((prev) => ({
                ...prev,
                selectedLayerId: newLayers[newLayers.length - 1].id,
                tool: "select",
              }));
            }
          }
        };
        img.onerror = () => {
          setError(`Failed to load "${file.name}" for processing.`);
          processedCount++;
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = () => {
        setError(`Failed to read "${file.name}".`);
        processedCount++;
      };
      reader.readAsDataURL(file);
    });

    // Clear the input so the same file can be selected again
    event.target.value = "";
  };

  /**
   * Exports the current project as a ZIP file with all assets
   */
  const exportProjectZIP = async () => {
    if (!project || isExporting) return;

    setIsExporting(true);
    setError(null);

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
      setError(
        `Failed to export project: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setIsExporting(false);
    }
  };

  const loadProject = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    try {
      if (file.name.endsWith(".zip")) {
        // Handle ZIP file
        try {
          const zip = new JSZip();
          const zipContent = await zip.loadAsync(file);

          // Look for project.json
          const projectFile = zipContent.files["project.json"];
          if (!projectFile) {
            setError("Invalid project ZIP: project.json not found");
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

          // Migrate to normalized scale values
          const migratedProject = await migrateProjectToNormalizedScale(
            projectData
          );

          const hydratedProject = hydrateMaskEditorData(migratedProject);

          const loadedProject = {
            ...hydratedProject,
            metadata: {
              created:
                hydratedProject.metadata?.created || new Date().toISOString(),
              modified: new Date().toISOString(),
              author: hydratedProject.metadata?.author,
            },
          };
          clearHistory(); // Clear previous history when loading a new project
          setLocalProject(loadedProject);
          saveState(loadedProject, "Load ZIP project");

          // Reset canvas selection for newly loaded project
          setCanvasState((prev) => ({
            ...prev,
            selectedLayerId: undefined,
          }));
        } catch (zipError) {
          console.error("Error loading ZIP project:", zipError);
          setError(
            "Error loading ZIP project file. Please check the file format."
          );
        }
      } else {
        // Handle JSON file (existing logic)
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const projectData = JSON.parse(
              e.target?.result as string
            ) as Project;

            // Add backward compatibility for mask visibility
            projectData.layers.forEach((layer) => {
              if (layer.mask && typeof layer.mask.visible === "undefined") {
                layer.mask.visible = true; // Default to visible for existing projects
              }
            });

            // Migrate to normalized scale values
            const migratedProject = await migrateProjectToNormalizedScale(
              projectData
            );

            const hydratedProject = hydrateMaskEditorData(migratedProject);

            const loadedProject = {
              ...hydratedProject,
              metadata: {
                created:
                  hydratedProject.metadata?.created || new Date().toISOString(),
                modified: new Date().toISOString(),
                author: hydratedProject.metadata?.author,
              },
            };
            clearHistory(); // Clear previous history when loading a new project
            setLocalProject(loadedProject);
            saveState(loadedProject, "Load JSON project");

            // Reset canvas state for new project
            setCanvasState((prev) => ({
              ...prev,
              selectedLayerId: undefined,
            }));
          } catch (jsonError) {
            console.error("Error loading JSON project:", jsonError);
            setError(
              "Error loading project file. Please check the file format."
            );
          }
        };
        reader.onerror = () => {
          setError("Failed to read the project file. Please try again.");
        };
        reader.readAsText(file);
      }
    } catch (error) {
      console.error("Error loading project:", error);
      setError(
        `Failed to load project: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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

  const closePreview = useCallback(() => {
    previewGenerationRef.current = null;
    if (previewImageUrl) {
      URL.revokeObjectURL(previewImageUrl);
      objectURLsRef.current.delete(previewImageUrl);
    }
    setPreviewImageUrl(null);
    setIsGeneratingPreview(false);
    setIsPreviewOpen(false);
  }, [previewImageUrl]);

  /**
   * Detect nails in the base image using YOLO segmentation model
   */
  const detectNails = useCallback(async () => {
    if (!project?.base.imageData) {
      setError("No base image loaded. Please load a base image first.");
      return;
    }

    setIsDetecting(true);
    setError(null);

    try {
      const segmentation = segmentationRef.current;

      // Load model if not already loaded
      if (!segmentation.isModelLoaded()) {
        setIsLoadingModel(true);
        console.log("Loading segmentation model...");
        await segmentation.loadModel();
        setIsLoadingModel(false);
        console.log("Model loaded successfully");
      }

      // Load base image
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = project.base.imageData!;
      });

      console.log("Running nail detection...");
      const detections = await segmentation.detectNails(
        img,
        detectionConfidence,
        0.45,
        detectionPointCount,
        detectionMaskExpansion
      );

      console.log(`Detected ${detections.length} nails`);
      setDetectedMasks(detections);
      setShowDetections(true);

      if (detections.length === 0) {
        setError(
          "No nails detected. Try a different image or adjust the model."
        );
      }
    } catch (error) {
      console.error("Detection failed:", error);
      setError(
        `Failed to detect nails: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setIsDetecting(false);
      setIsLoadingModel(false);
    }
  }, [
    project,
    detectionConfidence,
    detectionPointCount,
    detectionMaskExpansion,
  ]);

  /**
   * Assign a detected mask to the selected layer
   */
  const assignMaskToLayer = useCallback(
    (maskId: string) => {
      if (!canvasState.selectedLayerId) {
        setError("Please select a layer first to assign the detected mask.");
        return;
      }

      const detectedMask = detectedMasks.find((m) => m.id === maskId);
      if (!detectedMask) return;

      updateProject((prev) => {
        if (!prev) return null;

        return {
          ...prev,
          layers: prev.layers.map((layer) =>
            layer.id === canvasState.selectedLayerId
              ? {
                  ...layer,
                  mask: {
                    enabled: true,
                    visible: true,
                    path: detectedMask.path,
                    feather: 0.5,
                    smoothing: 1.0,
                    offset: { x: 0, y: 0 },
                    editorPath: detectedMask.path,
                    editorSmoothing: 1.0,
                    editorOffset: { x: 0, y: 0 },
                  },
                }
              : layer
          ),
          metadata: {
            ...prev.metadata!,
            modified: new Date().toISOString(),
          },
        };
      }, `Assign detected mask to layer`);

      // Hide detections after assignment
      setShowDetections(false);
      setDetectedMasks([]);
    },
    [canvasState.selectedLayerId, detectedMasks, updateProject]
  );

  /**
   * Clear detected masks and hide overlay
   */
  const clearDetections = useCallback(() => {
    setDetectedMasks([]);
    setShowDetections(false);
  }, []);

  const getBaseImageData = useCallback(async () => {
    if (!project?.base.imageData) {
      throw new Error("No base image available for color selection");
    }

    const cached = colorPickCacheRef.current;
    if (cached && cached.imageDataUrl === project.base.imageData) {
      return cached.imageData;
    }

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = project.base.imageData!;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to read base image pixels");
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    colorPickCacheRef.current = {
      imageDataUrl: project.base.imageData,
      imageData,
    };

    return imageData;
  }, [project]);

  const handleColorPick = useCallback(
    async (point: { x: number; y: number }) => {
      if (!project || !canvasState.selectedLayerId) {
        setError("Select a layer before using Color Pick Mask.");
        return;
      }

      const layer = project.layers.find((item) => item.id === canvasState.selectedLayerId);
      if (!layer || layer.locked) {
        setError("Unlock and select a layer before applying a color-picked mask.");
        return;
      }

      setError(null);

      try {
        const imageData = await getBaseImageData();
        const result = createMaskFromColorSelection(imageData, point.x, point.y, {
          tolerance: colorPickTolerance,
          maxPoints: colorPickPointCount,
        });

        if (!result) {
          setError("No connected region found for that color. Try increasing tolerance.");
          return;
        }

        updateProject((prev) => {
          if (!prev) return null;

          return {
            ...prev,
            layers: prev.layers.map((currentLayer) =>
              currentLayer.id === canvasState.selectedLayerId
                ? {
                    ...currentLayer,
                    mask: {
                      enabled: true,
                      visible: true,
                      path: result.path,
                      feather: 0.5,
                      smoothing: 1,
                      offset: { x: 0, y: 0 },
                      editorPath: result.path,
                      editorSmoothing: 1,
                      editorOffset: { x: 0, y: 0 },
                    },
                  }
                : currentLayer
            ),
            metadata: {
              ...prev.metadata!,
              modified: new Date().toISOString(),
            },
          };
        }, "Apply color-picked mask");
      } catch (error) {
        setError(
          `Failed to create color mask: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
    [
      project,
      canvasState.selectedLayerId,
      colorPickTolerance,
      colorPickPointCount,
      getBaseImageData,
      updateProject,
    ]
  );

  const invertProjectHorizontally = useCallback(async () => {
    if (!project) {
      return;
    }

    if (!project.base.imageData) {
      setError("Base image is missing – cannot invert project.");
      return;
    }

    setIsInverting(true);
    setError(null);

    try {
      const mirroredBaseData = await mirrorDataURL(project.base.imageData);

      const mirroredLayers = project.layers.map((layer) => {
        const mirroredTransform = {
          ...layer.transform,
          left: Math.min(
            Math.max(mirrorNormalizedX(layer.transform.left ?? 0.5), 0),
            1
          ),
          angle: roundFraction(-(layer.transform.angle ?? 0)),
          skewX:
            typeof layer.transform.skewX === "number"
              ? roundFraction(-layer.transform.skewX)
              : layer.transform.skewX,
          skewY:
            typeof layer.transform.skewY === "number"
              ? roundFraction(-layer.transform.skewY)
              : layer.transform.skewY,
        };

        return {
          ...layer,
          transform: mirroredTransform,
          mask: mirrorMask(layer.mask),
          originalFile: undefined,
        };
      });

      const nextProject: Project = {
        ...project,
        base: {
          ...project.base,
          imageData: mirroredBaseData,
          originalFile: undefined,
        },
        layers: mirroredLayers,
        metadata: {
          created:
            typeof project.metadata?.created === "string" &&
            project.metadata.created
              ? project.metadata.created
              : new Date().toISOString(),
          modified: new Date().toISOString(),
          author: project.metadata?.author,
        },
      };

      closePreview();

      updateProject(() => nextProject, "Invert project horizontally");

      setCanvasState((prev) => ({
        ...prev,
        pan: {
          x: prev.pan ? roundFraction(-(prev.pan.x ?? 0), 2) : 0,
          y: prev.pan?.y ?? 0,
        },
      }));
    } catch (error) {
      console.error("Failed to invert project", error);
      setError(
        `Failed to invert project: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setIsInverting(false);
    }
  }, [project, closePreview, updateProject]);

  const openPreview = useCallback(async () => {
    if (!project || previewGenerationRef.current) return;

    setError(null);
    setIsPreviewOpen(true);

    const token = Symbol("preview-request");
    previewGenerationRef.current = token;
    setIsGeneratingPreview(true);

    if (previewImageUrl) {
      URL.revokeObjectURL(previewImageUrl);
      objectURLsRef.current.delete(previewImageUrl);
      setPreviewImageUrl(null);
    }

    try {
      const compositeBlob = await renderComposite(project, 1);
      const url = URL.createObjectURL(compositeBlob);

      if (previewGenerationRef.current !== token) {
        URL.revokeObjectURL(url);
        return;
      }

      objectURLsRef.current.add(url);
      setPreviewImageUrl(url);
    } catch (error) {
      console.error("Error generating preview:", error);
      if (previewGenerationRef.current === token) {
        setError(
          `Failed to generate preview: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        setIsPreviewOpen(false);
      }
    } finally {
      if (previewGenerationRef.current === token) {
        previewGenerationRef.current = null;
        setIsGeneratingPreview(false);
      }
    }
  }, [project, previewImageUrl]);

  const resetProject = () => {
    if (
      confirm(
        "Are you sure you want to start over? This will clear all your work."
      )
    ) {
      closePreview();
      setLocalProject(null);
      clearHistory();
      saveState(null, "Reset project");
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

  const handleZoomChange = useCallback((nextZoom: number) => {
    const clamped = Math.min(Math.max(nextZoom, ZOOM_MIN), ZOOM_MAX);
    setCanvasState((prev) => ({
      ...prev,
      zoom: Number(clamped.toFixed(4)),
    }));
  }, []);

  const handlePanChange = useCallback((pan: { x: number; y: number }) => {
    setCanvasState((prev) => ({
      ...prev,
      pan,
    }));
  }, []);

  const handleZoomReset = useCallback(() => {
    // Use the canvas ref's reset method which directly manipulates the canvas
    // and bypasses the state sync mechanism to avoid race conditions
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.resetZoomAndPan();
    }
  }, []);

  const handleMaskFinished = useCallback(() => {
    // Switch back to transform mode when mask drawing is finished
    setCanvasState((prev) => ({
      ...prev,
      tool: "select",
    }));
  }, []);

  const handleCanvasLayerSelected = useCallback((layerId: string) => {
    // When a layer is selected on canvas, update the layer selection and switch to transform mode
    setCanvasState((prev) => {
      if (prev.selectedLayerId === layerId && prev.tool === "select") {
        return prev;
      }

      return {
        ...prev,
        selectedLayerId: layerId,
        tool: "select",
      };
    });
  }, []);

  // Handle canvas zoom keyboard shortcuts (Cmd+/Cmd-)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle zoom if canvas area has focus (not in input fields)
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.tagName === "SELECT" ||
          activeElement.isContentEditable)
      ) {
        return;
      }

      // Check for Cmd+/Cmd- (Mac) or Ctrl+/Ctrl- (Windows/Linux)
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifierKey = isMac ? event.metaKey : event.ctrlKey;

      if (modifierKey && (event.key === "=" || event.key === "+")) {
        // Zoom in
        event.preventDefault();
        const nextZoom = Math.min(canvasState.zoom + ZOOM_STEP, ZOOM_MAX);
        handleZoomChange(nextZoom);
      } else if (modifierKey && (event.key === "-" || event.key === "_")) {
        // Zoom out
        event.preventDefault();
        const nextZoom = Math.max(canvasState.zoom - ZOOM_STEP, ZOOM_MIN);
        handleZoomChange(nextZoom);
      } else if (modifierKey && event.key === "0") {
        // Reset zoom to 100%
        event.preventDefault();
        handleZoomChange(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canvasState.zoom, handleZoomChange]);

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
                onClick={() => replaceBaseInputRef.current?.click()}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 rounded text-sm flex items-center gap-2"
                title="Swap base image and keep current layers"
              >
                <Square size={16} />
                Swap Base
              </button>
              <button
                onClick={openPreview}
                disabled={isGeneratingPreview}
                className={`px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors ${
                  isGeneratingPreview
                    ? "bg-indigo-400 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700"
                }`}
              >
                <Eye size={16} />
                {isGeneratingPreview ? "Generating..." : "Preview"}
              </button>
              <button
                onClick={invertProjectHorizontally}
                disabled={isInverting}
                className={`px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors ${
                  isInverting
                    ? "bg-blue-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                <FlipHorizontal size={16} />
                {isInverting ? "Inverting..." : "Invert"}
              </button>
              <button
                onClick={exportProjectZIP}
                disabled={isExporting}
                className={`px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors ${
                  isExporting
                    ? "bg-orange-400 cursor-not-allowed"
                    : "bg-orange-600 hover:bg-orange-700"
                }`}
              >
                <Archive size={16} />
                {isExporting ? "Exporting..." : "Export"}
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
          ref={replaceBaseInputRef}
          type="file"
          accept="image/*"
          onChange={handleReplaceBaseImage}
          className="hidden"
        />
        <input
          ref={overlayInputRef}
          type="file"
          accept="image/*"
          multiple
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
                <div className="flex items-center gap-2">
                  <div className="relative w-8 h-8 rounded border bg-gray-100 flex-shrink-0 overflow-hidden">
                    {project.base.imageData ? (
                      <NextImage
                        src={project.base.imageData}
                        alt={project.base.name}
                        fill
                        unoptimized
                        sizes="32px"
                        className="object-cover"
                      />
                    ) : (
                      <Square size={16} className="text-gray-400 m-auto" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-800 flex items-center gap-2">
                      <Square size={16} className="text-blue-600" />
                      Base Image
                      <button
                        type="button"
                        className="ml-2 px-2 py-0.5 text-xs bg-gray-200 hover:bg-blue-600 hover:text-white rounded transition-colors"
                        onClick={() => replaceBaseInputRef.current?.click()}
                        title="Replace base image"
                      >
                        Replace
                      </button>
                    </div>
                    <div className="text-sm text-gray-900">
                      {project.base.name}
                    </div>
                    <div className="text-xs text-gray-700">
                      {project.base.width} × {project.base.height}
                    </div>
                  </div>
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

              {/* Detection Dropdown */}
              <div className="mb-2">
                <details className="bg-gray-50 rounded-lg border border-gray-200">
                  <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
                    Detection
                  </summary>
                  <div className="px-3 py-3 space-y-3">
                    {/* Confidence Threshold */}
                    <div>
                      <label className="flex items-center justify-between text-xs text-gray-700 mb-1">
                        <span>
                          Confidence: {(detectionConfidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-gray-500">
                          Higher = fewer detections
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={detectionConfidence}
                        onChange={(e) =>
                          setDetectionConfidence(parseFloat(e.target.value))
                        }
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>

                    {/* Target point count */}
                    <div>
                      <label className="flex items-center justify-between text-xs text-gray-700 mb-1">
                        <span>Target Points: {detectionPointCount}</span>
                        <span className="text-gray-500">
                          Higher = more detailed outline
                        </span>
                      </label>
                      <input
                        type="range"
                        min="3"
                        max="50"
                        step="1"
                        value={detectionPointCount}
                        onChange={(e) =>
                          setDetectionPointCount(parseInt(e.target.value, 10))
                        }
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>3 pts</span>
                        <span>50 pts</span>
                      </div>
                    </div>

                    {/* Mask expansion */}
                    <div>
                      <label className="flex items-center justify-between text-xs text-gray-700 mb-1">
                        <span>Mask Scale: +{detectionMaskExpansion}%</span>
                        <span className="text-gray-500">
                          Higher = larger mask
                        </span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        step="1"
                        value={detectionMaskExpansion}
                        onChange={(e) =>
                          setDetectionMaskExpansion(
                            parseInt(e.target.value, 10)
                          )
                        }
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>+1%</span>
                        <span>+100%</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-200 space-y-2">
                      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Color Pick Mask
                      </div>
                      <label className="flex items-center justify-between text-xs text-gray-700 mb-1">
                        <span>Tolerance: {(colorPickTolerance * 100).toFixed(0)}%</span>
                        <span className="text-gray-500">Higher = wider selection</span>
                      </label>
                      <input
                        type="range"
                        min="0.01"
                        max="0.5"
                        step="0.01"
                        value={colorPickTolerance}
                        onChange={(e) =>
                          setColorPickTolerance(parseFloat(e.target.value))
                        }
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />

                      <label className="flex items-center justify-between text-xs text-gray-700 mb-1">
                        <span>Mask Points: {colorPickPointCount}</span>
                        <span className="text-gray-500">Higher = more detail</span>
                      </label>
                      <input
                        type="range"
                        min="8"
                        max="96"
                        step="2"
                        value={colorPickPointCount}
                        onChange={(e) =>
                          setColorPickPointCount(parseInt(e.target.value, 10))
                        }
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          if (!canvasState.selectedLayerId) {
                            setError("Select a layer before using Color Pick Mask.");
                            return;
                          }
                          setError(null);
                          setIsColorPickMode((prev) => !prev);
                        }}
                        className={`w-full px-3 py-2 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-colors ${
                          isColorPickMode
                            ? "bg-amber-100 border-amber-400 text-amber-800"
                            : "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                        }`}
                      >
                        <Pipette size={16} />
                        {isColorPickMode ? "Exit Color Pick" : "Enable Color Pick"}
                      </button>

                      {isColorPickMode && (
                        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                          Click the canvas to sample a connected color region and apply it to the selected layer mask.
                        </div>
                      )}
                    </div>
                    <button
                      onClick={detectNails}
                      disabled={isDetecting || isLoadingModel}
                      className={`w-full px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors shadow-sm ${
                        isDetecting || isLoadingModel
                          ? "bg-purple-400 cursor-not-allowed"
                          : "bg-purple-600 hover:bg-purple-700 text-white"
                      }`}
                      title="Use AI to detect nail masks automatically"
                    >
                      <Sparkles size={18} />
                      {isLoadingModel
                        ? "Loading Model..."
                        : isDetecting
                        ? "Detecting..."
                        : "🔍 Detect Nails"}
                    </button>
                    {showDetections && detectedMasks.length > 0 && (
                      <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-200">
                        <div className="text-xs text-purple-900 font-medium mb-2">
                          {detectedMasks.length} nail
                          {detectedMasks.length !== 1 ? "s" : ""} detected
                        </div>
                        <div className="text-xs text-purple-700 mb-2">
                          {canvasState.selectedLayerId
                            ? "Click a detection on canvas to assign"
                            : "Select a layer first"}
                        </div>
                        <button
                          onClick={clearDetections}
                          className="text-xs px-2 py-1 bg-white hover:bg-purple-100 text-purple-700 rounded border border-purple-300 w-full"
                        >
                          Clear Detections
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              </div>

              {/* Settings Accordion */}
              <div className="mb-2">
                <details className="bg-gray-50 rounded-lg border border-gray-200">
                  <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
                    Settings
                  </summary>
                  <div className="px-3 py-3">
                    <button
                      type="button"
                      onClick={handleSetAllMaskSmoothing}
                      disabled={disableGlobalSmoothingButton}
                      className={`w-full px-4 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                        disableGlobalSmoothingButton
                          ? "border-gray-200 text-gray-400 bg-gray-100 cursor-not-allowed"
                          : "border-blue-500 text-blue-700 hover:bg-blue-50"
                      }`}
                      title="Set every mask's smoothing value to 100%"
                    >
                      <Check size={16} />
                      Smooth all masks (100%)
                    </button>
                  </div>
                </details>
              </div>
            </div>

            {/* Scrollable Layers List */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="space-y-2">
                {project.layers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`p-3 bg-white rounded border cursor-pointer transition-colors ${
                      canvasState.selectedLayerId === layer.id
                        ? "border-blue-500 bg-blue-50"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setCanvasState((prev) => {
                        if (
                          prev.selectedLayerId === layer.id &&
                          prev.tool === "select"
                        ) {
                          return prev;
                        }

                        return {
                          ...prev,
                          selectedLayerId: layer.id,
                          tool: "select", // Switch to transform mode when selecting a layer
                        };
                      });
                    }}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex items-center gap-2">
                          {/* Image thumbnail preview */}
                          <div className="relative w-8 h-8 rounded border bg-gray-100 flex-shrink-0 overflow-hidden">
                            {layer.imageData ? (
                              <NextImage
                                src={layer.imageData}
                                alt={layer.name}
                                fill
                                unoptimized
                                sizes="32px"
                                className="object-cover"
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
                            updateProject((prev) => {
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
                            }, `Toggle visibility: ${layer.name}`);
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
                            updateProject((prev) => {
                              if (!prev) return null;

                              const targetLayer = prev.layers.find(
                                (l) => l.id === layer.id
                              );
                              if (!targetLayer) return prev;

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
                            }, `Toggle lock: ${layer.name}`);
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
                            updateProject(
                              (prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      layers: prev.layers.filter(
                                        (l) => l.id !== layer.id
                                      ),
                                    }
                                  : null,
                              `Delete layer: ${layer.name}`
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

                    {/* Tag input field */}
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Tag:
                      </label>
                      <input
                        type="text"
                        value={tagInputs[layer.id] ?? layer.tag ?? ""}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newValue = e.target.value;

                          // Update local state immediately for responsiveness
                          setTagInputs((prev) => ({
                            ...prev,
                            [layer.id]: newValue,
                          }));

                          // Debounce the actual project update
                          const trimmedValue = newValue.trim() || undefined;
                          debouncedTagUpdate(layer.id, trimmedValue);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 text-gray-900"
                        placeholder="optional"
                      />
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
                              updateProject((prev) => {
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
                              }, `Toggle mask enable: ${layer.name}`);
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
                              updateProject((prev) => {
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
                              }, `Toggle mask visibility: ${layer.name}`);
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
                          <div className="flex items-center justify-between">
                            <label className="block text-xs text-gray-700">
                              Feather: {layer.mask.feather.toFixed(1)}px
                            </label>
                            <div className="flex items-center gap-1">
                              <button
                                className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = Math.max(
                                    0,
                                    layer.mask.feather - 0.5
                                  );
                                  handleLayerUpdate(layer.id, {
                                    mask: { ...layer.mask, feather: next },
                                  });
                                }}
                              >
                                −
                              </button>
                              <button
                                className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = Math.min(
                                    10,
                                    layer.mask.feather + 0.5
                                  );
                                  handleLayerUpdate(layer.id, {
                                    mask: { ...layer.mask, feather: next },
                                  });
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
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
                          <div className="flex items-center justify-between mt-2">
                            <label className="block text-xs text-gray-700">
                              Smoothing:{" "}
                              {((layer.mask.smoothing ?? 0) * 100).toFixed(0)}%
                            </label>
                            <div className="flex items-center gap-1">
                              <button
                                className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const cur = layer.mask.smoothing ?? 0;
                                  const next = Math.max(
                                    0,
                                    +(cur - 0.05).toFixed(2)
                                  );
                                  handleLayerUpdate(layer.id, {
                                    mask: {
                                      ...layer.mask,
                                      smoothing: next,
                                      editorSmoothing: next,
                                    },
                                  });
                                }}
                              >
                                −
                              </button>
                              <button
                                className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const cur = layer.mask.smoothing ?? 0;
                                  const next = Math.min(
                                    1,
                                    +(cur + 0.05).toFixed(2)
                                  );
                                  handleLayerUpdate(layer.id, {
                                    mask: {
                                      ...layer.mask,
                                      smoothing: next,
                                      editorSmoothing: next,
                                    },
                                  });
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={layer.mask.smoothing ?? 0}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleLayerUpdate(layer.id, {
                                mask: {
                                  ...layer.mask,
                                  smoothing: parseFloat(e.target.value),
                                  editorSmoothing: parseFloat(e.target.value),
                                },
                              });
                            }}
                            className="w-full h-1"
                          />
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <div className="flex items-center justify-between">
                                <label className="block text-xs text-gray-700">
                                  Offset X:{" "}
                                  {Math.round(
                                    (layer.mask.offset?.x ?? 0) * 100
                                  )}
                                  %
                                </label>
                                <div className="flex items-center gap-1">
                                  <button
                                    className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const x = Math.max(
                                        -0.5,
                                        +(
                                          (layer.mask.offset?.x ?? 0) - 0.01
                                        ).toFixed(3)
                                      );
                                      const nextOffset = {
                                        x,
                                        y: layer.mask.offset?.y ?? 0,
                                      };
                                      handleLayerUpdate(layer.id, {
                                        mask: {
                                          ...layer.mask,
                                          offset: nextOffset,
                                          editorOffset: nextOffset,
                                        },
                                      });
                                    }}
                                  >
                                    −
                                  </button>
                                  <button
                                    className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const x = Math.min(
                                        0.5,
                                        +(
                                          (layer.mask.offset?.x ?? 0) + 0.01
                                        ).toFixed(3)
                                      );
                                      const nextOffset = {
                                        x,
                                        y: layer.mask.offset?.y ?? 0,
                                      };
                                      handleLayerUpdate(layer.id, {
                                        mask: {
                                          ...layer.mask,
                                          offset: nextOffset,
                                          editorOffset: nextOffset,
                                        },
                                      });
                                    }}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={-0.5}
                                max={0.5}
                                step={0.01}
                                value={layer.mask.offset?.x ?? 0}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const x = parseFloat(e.target.value);
                                  const nextOffset = {
                                    x,
                                    y: layer.mask.offset?.y ?? 0,
                                  };
                                  handleLayerUpdate(layer.id, {
                                    mask: {
                                      ...layer.mask,
                                      offset: nextOffset,
                                      editorOffset: nextOffset,
                                    },
                                  });
                                }}
                                className="w-full h-1"
                              />
                            </div>
                            <div>
                              <div className="flex items-center justify-between">
                                <label className="block text-xs text-gray-700">
                                  Offset Y:{" "}
                                  {Math.round(
                                    (layer.mask.offset?.y ?? 0) * 100
                                  )}
                                  %
                                </label>
                                <div className="flex items-center gap-1">
                                  <button
                                    className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const y = Math.max(
                                        -0.5,
                                        +(
                                          (layer.mask.offset?.y ?? 0) - 0.01
                                        ).toFixed(3)
                                      );
                                      const nextOffset = {
                                        x: layer.mask.offset?.x ?? 0,
                                        y,
                                      };
                                      handleLayerUpdate(layer.id, {
                                        mask: {
                                          ...layer.mask,
                                          offset: nextOffset,
                                          editorOffset: nextOffset,
                                        },
                                      });
                                    }}
                                  >
                                    −
                                  </button>
                                  <button
                                    className="px-2 py-0.5 text-xs bg-gray-200 text-gray-900 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const y = Math.min(
                                        0.5,
                                        +(
                                          (layer.mask.offset?.y ?? 0) + 0.01
                                        ).toFixed(3)
                                      );
                                      const nextOffset = {
                                        x: layer.mask.offset?.x ?? 0,
                                        y,
                                      };
                                      handleLayerUpdate(layer.id, {
                                        mask: {
                                          ...layer.mask,
                                          offset: nextOffset,
                                          editorOffset: nextOffset,
                                        },
                                      });
                                    }}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={-0.5}
                                max={0.5}
                                step={0.01}
                                value={layer.mask.offset?.y ?? 0}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const y = parseFloat(e.target.value);
                                  const nextOffset = {
                                    x: layer.mask.offset?.x ?? 0,
                                    y,
                                  };
                                  handleLayerUpdate(layer.id, {
                                    mask: {
                                      ...layer.mask,
                                      offset: nextOffset,
                                      editorOffset: nextOffset,
                                    },
                                  });
                                }}
                                className="w-full h-1"
                              />
                            </div>
                          </div>
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
        <div className="flex-1 bg-gray-50 relative">
          {project && (
            <FloatingToolbar
              tool={canvasState.tool}
              transformMode={canvasState.transformMode}
              onToolChange={(tool) => {
                if (tool === "mask" && canvasState.selectedLayerId && project) {
                  const layer = project.layers.find(
                    (l) => l.id === canvasState.selectedLayerId
                  );
                  if (layer) {
                    const currentSmoothing = layer.mask.smoothing ?? 0;
                    if (currentSmoothing !== 0) {
                      handleLayerUpdate(layer.id, {
                        mask: {
                          ...layer.mask,
                          smoothing: 0,
                          editorSmoothing: 0,
                        },
                      });
                    }
                  }
                }

                if (tool !== "select") {
                  setIsColorPickMode(false);
                }

                setCanvasState((prev) => ({ ...prev, tool }));
              }}
              onTransformModeChange={(transformMode) =>
                setCanvasState((prev) => ({ ...prev, transformMode }))
              }
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              zoom={canvasState.zoom}
              onZoomChange={handleZoomChange}
              onZoomReset={handleZoomReset}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              zoomStep={ZOOM_STEP}
            />
          )}
          {project ? (
            <div className="h-full w-full flex items-center justify-center">
              <FabricCanvas
                ref={fabricCanvasRef}
                project={project}
                onLayerUpdate={handleLayerUpdate}
                selectedLayerId={canvasState.selectedLayerId}
                transformMode={canvasState.transformMode}
                canvasState={canvasState}
                onMaskFinished={handleMaskFinished}
                onLayerSelected={handleCanvasLayerSelected}
                onMaskStateChange={setMaskDrawingState}
                onPanChange={handlePanChange}
                onZoomChange={handleZoomChange}
                minZoom={ZOOM_MIN}
                maxZoom={ZOOM_MAX}
                detectedMasks={detectedMasks}
                showDetections={showDetections}
                onDetectionClick={assignMaskToLayer}
                colorPickMode={isColorPickMode}
                onColorPick={handleColorPick}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 py-12 text-gray-600">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="relative">
                    <ImageIcon size={72} className="text-gray-300" />
                    <Layers
                      size={28}
                      className="text-blue-400 absolute -bottom-1 -right-1"
                    />
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">
                      Welcome to Image Placer
                    </h1>
                    <p className="mt-3 text-base leading-relaxed max-w-2xl">
                      Layer graphics, refine compositions, and export
                      ready-to-share visuals without leaving the browser.
                      Explore the tools in whatever order fits your workflow.
                    </p>
                  </div>
                </div>

                <div className="mt-10 grid gap-4 md:grid-cols-3">
                  {WELCOME_CALLOUTS.map((callout) => {
                    const Icon = callout.icon;
                    return (
                      <div
                        key={callout.title}
                        className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 ${callout.iconColor}`}
                          >
                            <Icon size={20} />
                          </span>
                          <h3 className="font-semibold text-gray-900">
                            {callout.title}
                          </h3>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed">
                          {callout.description}
                        </p>
                        {callout.bullets && (
                          <ul className="mt-3 space-y-1 text-sm text-gray-500">
                            {callout.bullets.map((bullet) => (
                              <li key={bullet} className="flex gap-2">
                                <span aria-hidden="true">•</span>
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-10 grid gap-6 md:grid-cols-2">
                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Lightbulb size={18} className="text-amber-500" />
                      Quick start checklist
                    </h3>
                    <ol className="mt-4 space-y-3 text-sm text-gray-600 list-decimal list-inside">
                      {QUICK_START_ITEMS.map((item) => (
                        <li key={item.title}>
                          <span className="font-medium text-gray-800">
                            {item.title}
                          </span>
                          <p className="mt-1 text-gray-600">
                            {item.description}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Keyboard size={18} className="text-blue-500" />
                      Keyboard shortcuts
                    </h3>
                    <ul className="mt-4 space-y-3 text-sm text-gray-600">
                      {KEYBOARD_SHORTCUTS.map((shortcut) => (
                        <li key={shortcut.title} className="flex flex-col">
                          <span className="font-medium text-gray-800">
                            {shortcut.title}
                          </span>
                          <span className="mt-0.5 text-gray-600">
                            {shortcut.description}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <LifeBuoy size={18} className="text-emerald-500" />
                    Tips for better results
                  </h3>
                  <ul className="mt-4 space-y-2 text-sm text-gray-600">
                    {SUPPORT_TIPS.map((tip) => (
                      <li key={tip} className="flex gap-2">
                        <span aria-hidden="true">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 flex flex-wrap justify-center gap-3 pb-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <Upload size={18} />
                    Start with Base Image
                  </button>
                  <button
                    onClick={() => projectInputRef.current?.click()}
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <FolderOpen size={18} />
                    Load Saved Project
                  </button>
                </div>
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
                      ? "Drag sides to skew the selected layer"
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
                }
              }}
            />
          </div>
        )}
      </div>

      {isPreviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closePreview}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-full flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Composite Preview
                </h2>
                {project && (
                  <p className="text-sm text-gray-500">
                    {project.base.width} × {project.base.height} PNG render
                  </p>
                )}
              </div>
              <button
                onClick={closePreview}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close preview"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 flex items-center justify-center bg-gray-100">
              {isGeneratingPreview ? (
                <div className="text-gray-600 text-sm">
                  Generating preview...
                </div>
              ) : previewImageUrl ? (
                <NextImage
                  src={previewImageUrl}
                  alt="Composite preview"
                  width={Math.max(1, project?.base.width ?? 1)}
                  height={Math.max(1, project?.base.height ?? 1)}
                  unoptimized
                  className="max-w-full max-h-[70vh] w-auto object-contain shadow-md border"
                />
              ) : (
                <div className="text-gray-600 text-sm">
                  Preview unavailable. Try again.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
