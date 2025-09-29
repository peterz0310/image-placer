import JSZip from "jszip";
import { Project } from "@/types";
import { CANVAS_MAX_WIDTH, CANVAS_MAX_HEIGHT } from "@/constants/canvas";
import { MaskRenderer } from "./mask";

export interface ExportOptions {
  includeOriginalAssets: boolean;
  renderScale: number;
  format: "png" | "jpeg";
  quality: number;
}

/**
 * Utility class for exporting and importing Image Placer projects
 * Handles ZIP packaging with assets and JSON project data
 */
export class ProjectExporter {
  static async exportJSON(project: Project): Promise<Blob> {
    const exportData = this.prepareProjectForExport(project);
    return new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
  }

  /**
   * Exports a project as a ZIP file containing the composite image, project JSON,
   * and optionally original assets with individual and combined masks
   *
   * @param project - The project to export
   * @param compositeBlob - The rendered composite image blob
   * @param options - Export options including asset inclusion and format settings
   * @returns Promise resolving to a ZIP file blob
   *
   * The ZIP file will contain:
   * - project.json: Project data without binary image data
   * - composite.{format}: The rendered composite image
   * - assets/ folder (if includeOriginalAssets is true):
   *   - Original base and layer image files
   *   - {layerName}_mask.png: Individual mask files for each masked layer
   *   - combined_mask.png: All masks combined into a single file
   */
  static async exportZIP(
    project: Project,
    compositeBlob: Blob,
    options: ExportOptions = {
      includeOriginalAssets: true,
      renderScale: 1,
      format: "png",
      quality: 1.0,
    }
  ): Promise<Blob> {
    const zip = new JSZip();

    // Add project JSON
    const projectData = this.prepareProjectForExport(project);
    zip.file("project.json", JSON.stringify(projectData, null, 2));

    // Add composite render
    zip.file(`composite.${options.format}`, compositeBlob);

    if (options.includeOriginalAssets) {
      // Create assets folder
      const assetsFolder = zip.folder("assets");

      // Add base image
      if (project.base.originalFile) {
        try {
          // Convert File to Blob using FileReader for better compatibility
          const baseBlob = await this.fileToBlob(project.base.originalFile);
          assetsFolder!.file(project.base.name, baseBlob);
        } catch (error) {
          console.warn(
            `Failed to process base image file: ${error}. Falling back to imageData.`
          );
          if (project.base.imageData) {
            const baseBlob = this.dataURLToBlob(project.base.imageData);
            assetsFolder!.file(project.base.name, baseBlob);
          }
        }
      } else if (project.base.imageData) {
        const baseBlob = this.dataURLToBlob(project.base.imageData);
        assetsFolder!.file(project.base.name, baseBlob);
      }

      // Add layer images and masks
      const maskCanvases: HTMLCanvasElement[] = [];

      for (const layer of project.layers) {
        if (layer.originalFile) {
          try {
            // Convert File to Blob using FileReader for better compatibility
            const layerBlob = await this.fileToBlob(layer.originalFile);
            assetsFolder!.file(layer.name, layerBlob);
          } catch (error) {
            console.warn(
              `Failed to process layer file ${layer.name}: ${error}. Falling back to imageData.`
            );
            if (layer.imageData) {
              const layerBlob = this.dataURLToBlob(layer.imageData);
              assetsFolder!.file(layer.name, layerBlob);
            }
          }
        } else if (layer.imageData) {
          const layerBlob = this.dataURLToBlob(layer.imageData);
          assetsFolder!.file(layer.name, layerBlob);
        }

        // Export mask if enabled
        if (layer.mask.enabled && layer.mask.path.length >= 3) {
          try {
            const maskCanvas = MaskRenderer.createMaskCanvas(
              layer.mask.path,
              project.base.width,
              project.base.height,
              layer.mask.feather,
              layer.mask.smoothing ?? 0,
              layer.mask.offset
            );

            // Store mask canvas for combined mask creation
            maskCanvases.push(maskCanvas);

            const maskBlob = await new Promise<Blob>((resolve, reject) => {
              maskCanvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Failed to create mask blob"));
              }, "image/png");
            });

            const maskFileName =
              layer.name.replace(/\.[^/.]+$/, "") + "_mask.png";
            assetsFolder!.file(maskFileName, maskBlob);
          } catch (error) {
            console.warn(
              `Failed to export mask for layer ${layer.name}:`,
              error
            );
          }
        }
      }

      // Create combined mask if there are any masks
      if (maskCanvases.length > 0) {
        try {
          const combinedMaskBlob = await this.createCombinedMask(
            maskCanvases,
            project.base.width,
            project.base.height
          );
          assetsFolder!.file("combined_mask.png", combinedMaskBlob);
        } catch (error) {
          console.warn("Failed to create combined mask:", error);
        }
      }
    }

    return await zip.generateAsync({ type: "blob" });
  }

  private static prepareProjectForExport(project: Project): Project {
    return {
      ...project,
      base: {
        ...project.base,
        imageData: undefined,
        originalFile: undefined,
      },
      layers: project.layers.map((layer) => {
        // Bake smoothing + offset into path for JSON export if mask present
        const editorPath =
          layer.mask.editorPath && layer.mask.editorPath.length >= 3
            ? layer.mask.editorPath
            : layer.mask.path;
        const editorSmoothing =
          layer.mask.editorSmoothing ?? layer.mask.smoothing ?? 0;
        const editorOffset = layer.mask.editorOffset ??
          layer.mask.offset ?? { x: 0, y: 0 };

        let bakedPath = layer.mask.path;
        if (layer.mask.enabled && editorPath.length >= 3) {
          bakedPath = MaskRenderer.bakeSmoothedPath(
            editorPath,
            editorSmoothing,
            editorOffset
          );
        }

        return {
          ...layer,
          imageData: undefined,
          originalFile: undefined,
          mask: {
            ...layer.mask,
            // Replace path with baked version
            path: bakedPath,
            editorPath,
            editorSmoothing,
            editorOffset,
            // Smoothing/offset have been applied to the baked path; zero them to avoid double application on re-import
            smoothing: 0,
            offset: { x: 0, y: 0 },
          },
        };
      }),
    };
  }

  private static dataURLToBlob(dataURL: string): Blob {
    const arr = dataURL.split(",");
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new Blob([u8arr], { type: mime });
  }

  /**
   * Converts a File object to a Blob using FileReader for better compatibility
   * @param file - File object to convert
   * @returns Promise resolving to a Blob
   */
  private static fileToBlob(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      // Check if the file is actually a File/Blob object
      if (!file) {
        reject(new Error("File is null or undefined"));
        return;
      }

      // Type check for File/Blob
      const isFile =
        typeof file === "object" && "type" in file && "size" in file;
      if (!isFile) {
        reject(new Error("Invalid file object - not a File or Blob"));
        return;
      }

      // If it's already a proper Blob (but not File), just return it
      if (file instanceof Blob && !(file instanceof File)) {
        resolve(file);
        return;
      }

      const reader = new FileReader();

      reader.onload = (event) => {
        if (event.target?.result instanceof ArrayBuffer) {
          const blob = new Blob([event.target.result], { type: file.type });
          resolve(blob);
        } else {
          reject(new Error("Failed to read file as ArrayBuffer"));
        }
      };

      reader.onerror = () => {
        reject(new Error("FileReader error"));
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Creates a combined mask from multiple mask canvases
   * @param maskCanvases - Array of mask canvases to combine
   * @param width - Width of the combined mask
   * @param height - Height of the combined mask
   * @returns Promise resolving to a Blob containing the combined mask
   */
  private static async createCombinedMask(
    maskCanvases: HTMLCanvasElement[],
    width: number,
    height: number
  ): Promise<Blob> {
    const combinedCanvas = document.createElement("canvas");
    const ctx = combinedCanvas.getContext("2d")!;

    combinedCanvas.width = width;
    combinedCanvas.height = height;

    // Start with black background (no mask)
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    // Use additive blending to combine masks
    ctx.globalCompositeOperation = "screen"; // White + White = White, Black + White = White

    for (const maskCanvas of maskCanvases) {
      ctx.drawImage(maskCanvas, 0, 0, width, height);
    }

    return new Promise<Blob>((resolve, reject) => {
      combinedCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create combined mask blob"));
        }
      }, "image/png");
    });
  }

  static downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**
 * Renders a composite image from the project data
 * @param project - Project data with layers and transforms
 * @param scale - Scale factor for export resolution (1.0 = base resolution)
 * @returns Promise resolving to a Blob containing the composite PNG
 */
export async function renderComposite(
  project: Project,
  scale: number = 1
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      canvas.width = project.base.width * scale;
      canvas.height = project.base.height * scale;

      // Calculate the display scale factor used in FabricCanvas
      // This is needed to correctly interpret the stored transform values
      const maxDisplayWidth = CANVAS_MAX_WIDTH;
      const maxDisplayHeight = CANVAS_MAX_HEIGHT;
      const displayScale = Math.min(
        maxDisplayWidth / project.base.width,
        maxDisplayHeight / project.base.height,
        1
      );

      // Load and draw base image
      if (project.base.imageData) {
        const baseImg = await loadImage(project.base.imageData);
        ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
      }

      // Draw layers
      for (const layer of project.layers) {
        if (!layer.visible || !layer.imageData) continue;

        const img = await loadImage(layer.imageData);

        ctx.save();
        ctx.globalAlpha = layer.opacity;

        const centerX = layer.transform.left * canvas.width;
        const centerY = layer.transform.top * canvas.height;

        ctx.translate(centerX, centerY);
        ctx.rotate((layer.transform.angle * Math.PI) / 180);

        if (layer.transform.skewX || layer.transform.skewY) {
          ctx.transform(
            1,
            Math.tan(((layer.transform.skewY || 0) * Math.PI) / 180),
            Math.tan(((layer.transform.skewX || 0) * Math.PI) / 180),
            1,
            0,
            0
          );
        }

        // Use normalized scale values if available, otherwise fall back to legacy method
        let scaledWidth: number;
        let scaledHeight: number;

        if (
          layer.transform.normalizedScaleX &&
          layer.transform.normalizedScaleY
        ) {
          // NEW: Use normalized scale values (base image relative)
          scaledWidth = canvas.width * layer.transform.normalizedScaleX;
          scaledHeight = canvas.height * layer.transform.normalizedScaleY;
        } else {
          // LEGACY: Fall back to old method for backward compatibility
          const scaleAdjustment = scale / displayScale;
          scaledWidth = img.width * layer.transform.scaleX * scaleAdjustment;
          scaledHeight = img.height * layer.transform.scaleY * scaleAdjustment;
        }

        // Handle masking
        if (layer.mask.enabled && layer.mask.path.length >= 3) {
          // Create a temporary canvas to isolate the masking operation
          const tempCanvas = document.createElement("canvas");
          const tempCtx = tempCanvas.getContext("2d")!;
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;

          // Apply the same transformations to the temp canvas
          tempCtx.translate(centerX, centerY);
          tempCtx.rotate((layer.transform.angle * Math.PI) / 180);

          if (layer.transform.skewX || layer.transform.skewY) {
            tempCtx.transform(
              1,
              Math.tan(((layer.transform.skewY || 0) * Math.PI) / 180),
              Math.tan(((layer.transform.skewX || 0) * Math.PI) / 180),
              1,
              0,
              0
            );
          }

          // Draw the layer image with transformations to temp canvas
          tempCtx.drawImage(
            img,
            -scaledWidth / 2,
            -scaledHeight / 2,
            scaledWidth,
            scaledHeight
          );

          // Create the mask canvas in base image coordinates
          const maskCanvas = MaskRenderer.createMaskCanvas(
            layer.mask.path,
            canvas.width,
            canvas.height,
            layer.mask.feather * scale,
            layer.mask.smoothing ?? 0,
            layer.mask.offset
          );

          // Apply mask to the temp canvas content
          tempCtx.globalCompositeOperation = "destination-in";
          // Reset transformations to apply mask in base image coordinate space
          tempCtx.setTransform(1, 0, 0, 1, 0, 0);
          tempCtx.drawImage(maskCanvas, 0, 0);

          // Draw the masked result to main canvas (without transformations)
          ctx.restore(); // Remove transformations
          ctx.save();
          ctx.globalAlpha = layer.opacity;
          ctx.drawImage(tempCanvas, 0, 0);
        } else {
          // Draw without mask (with current transformations applied)
          ctx.drawImage(
            img,
            -scaledWidth / 2,
            -scaledHeight / 2,
            scaledWidth,
            scaledHeight
          );
        }

        ctx.restore();
      }

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create composite blob"));
        }
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Loads an image from a data URL with validation
 * @param src - Data URL string for the image
 * @returns Promise resolving to HTMLImageElement
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // Validate data URL format
    if (!src || typeof src !== "string") {
      reject(new Error("Invalid image src: not a string"));
      return;
    }

    if (!src.startsWith("data:image/")) {
      reject(new Error("Invalid data URL: not an image data URL"));
      return;
    }

    const img = new Image();

    img.onload = () => {
      resolve(img);
    };

    img.onerror = (error) => {
      reject(new Error(`Failed to load image: ${error}`));
    };

    img.src = src;
  });
}
