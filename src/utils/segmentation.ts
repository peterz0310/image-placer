import * as tf from "@tensorflow/tfjs";

export interface DetectedMask {
  id: string;
  path: [number, number][];
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  color: string;
}

interface PreprocessResult {
  tensor: tf.Tensor;
  scale: number;
  offsetX: number;
  offsetY: number;
  originalWidth: number;
  originalHeight: number;
}

export class NailSegmentation {
  private model: tf.GraphModel | null = null;
  private isLoading = false;
  private modelPath = "/model_web/model.json";
  private readonly targetSize = 640;

  /**
   * Load the YOLO segmentation model
   */
  async loadModel(): Promise<void> {
    if (this.model || this.isLoading) return;

    this.isLoading = true;
    try {
      console.log("Loading YOLO segmentation model...");

      // Set TensorFlow.js backend (WebGL is fastest for inference)
      await tf.setBackend("webgl");
      await tf.ready();

      this.model = await tf.loadGraphModel(this.modelPath);
      console.log("Model loaded successfully");

      // Warm up the model with a dummy inference
      // Use NHWC format: [batch, height, width, channels]
      const dummyInput = tf.zeros([1, this.targetSize, this.targetSize, 3]);
      const warmupResult = await this.model.executeAsync(dummyInput);
      tf.dispose([dummyInput, warmupResult]);

      console.log("Model warmed up and ready");
    } catch (error) {
      console.error("Failed to load model:", error);
      throw new Error(`Model loading failed: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(): boolean {
    return this.model !== null;
  }

  /**
   * Preprocess image for YOLO: letterbox resize to 640x640
   */
  private async preprocessImage(
    image: HTMLImageElement
  ): Promise<PreprocessResult> {
    const originalWidth = image.width;
    const originalHeight = image.height;

    // Calculate scale to fit image in 640x640 while maintaining aspect ratio
    const scale = Math.min(
      this.targetSize / originalWidth,
      this.targetSize / originalHeight
    );

    const scaledWidth = Math.round(originalWidth * scale);
    const scaledHeight = Math.round(originalHeight * scale);

    // Calculate padding to center the image
    const offsetX = Math.round((this.targetSize - scaledWidth) / 2);
    const offsetY = Math.round((this.targetSize - scaledHeight) / 2);

    // Create canvas for letterboxing
    const canvas = document.createElement("canvas");
    canvas.width = this.targetSize;
    canvas.height = this.targetSize;
    const ctx = canvas.getContext("2d")!;

    // Fill with black (letterbox)
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.targetSize, this.targetSize);

    // Draw scaled image centered
    ctx.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);

    // Convert to tensor [1, 640, 640, 3] in RGB format, normalized 0-1
    // Keep in NHWC format (batch, height, width, channels) as expected by the model
    const imageTensor = tf.browser
      .fromPixels(canvas)
      .toFloat()
      .div(255.0) // Normalize to 0-1
      .expandDims(0); // Add batch dimension -> [1, 640, 640, 3]

    return {
      tensor: imageTensor,
      scale,
      offsetX,
      offsetY,
      originalWidth,
      originalHeight,
    };
  }

  /**
   * Extract contours from a binary mask using marching squares algorithm
   */
  private extractContour(
    maskData: Float32Array,
    width: number,
    height: number,
    threshold = 0.5
  ): [number, number][] {
    const points: [number, number][] = [];

    // Simple contour extraction: find boundary pixels
    const visited = new Set<string>();

    // Find first boundary pixel
    let startX = -1,
      startY = -1;
    outer: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (maskData[idx] > threshold) {
          startX = x;
          startY = y;
          break outer;
        }
      }
    }

    if (startX === -1) return points;

    // Trace boundary using 8-connectivity
    const dirs = [
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ];

    let x = startX,
      y = startY;
    let dirIdx = 0;
    const maxIters = width * height; // Safety limit
    let iters = 0;

    do {
      const key = `${x},${y}`;
      if (!visited.has(key)) {
        points.push([x, y]);
        visited.add(key);
      }

      // Look for next boundary pixel
      let found = false;
      for (let i = 0; i < 8; i++) {
        const nextDirIdx = (dirIdx + i) % 8;
        const [dx, dy] = dirs[nextDirIdx];
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const idx = ny * width + nx;
          if (maskData[idx] > threshold) {
            x = nx;
            y = ny;
            dirIdx = nextDirIdx;
            found = true;
            break;
          }
        }
      }

      if (!found) break;
      iters++;
    } while ((x !== startX || y !== startY) && iters < maxIters);

    // Simplify contour using Douglas-Peucker algorithm
    return this.simplifyPolygon(points, 2.0);
  }

  /**
   * Simplify polygon using Douglas-Peucker algorithm
   */
  private simplifyPolygon(
    points: [number, number][],
    epsilon: number
  ): [number, number][] {
    if (points.length <= 2) return points;

    // Find point with maximum distance
    let maxDist = 0;
    let maxIndex = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const dist = this.perpendicularDistance(points[i], start, end);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    // If max distance is greater than epsilon, recursively simplify
    if (maxDist > epsilon) {
      const left = this.simplifyPolygon(points.slice(0, maxIndex + 1), epsilon);
      const right = this.simplifyPolygon(points.slice(maxIndex), epsilon);
      return [...left.slice(0, -1), ...right];
    } else {
      return [start, end];
    }
  }

  /**
   * Calculate perpendicular distance from point to line
   */
  private perpendicularDistance(
    point: [number, number],
    lineStart: [number, number],
    lineEnd: [number, number]
  ): number {
    const [x, y] = point;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    if (lenSq === 0) {
      return Math.sqrt(A * A + B * B);
    }

    const param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Detect nails in an image and return segmentation masks
   */
  async detectNails(
    image: HTMLImageElement,
    confidenceThreshold = 0.25,
    nmsThreshold = 0.45,
    targetPointCount = 25,
    maskExpansionPercent = 10
  ): Promise<DetectedMask[]> {
    if (!this.model) {
      throw new Error("Model not loaded. Call loadModel() first.");
    }

    console.log("Running inference...");
    const startTime = performance.now();

    // Preprocess image
    const preprocessed = await this.preprocessImage(image);
    const { tensor, scale, offsetX, offsetY, originalWidth, originalHeight } =
      preprocessed;

    try {
      // Run inference
      const output = (await this.model.executeAsync(tensor)) as
        | tf.Tensor
        | tf.Tensor[];

      // Convert to array if single tensor
      const outputArray = Array.isArray(output) ? output : [output];

      console.log(
        "Inference output shapes:",
        outputArray.map((t) => t.shape)
      );

      // YOLOv8 segmentation output format varies by export
      // Common formats:
      // - Single output: [1, 8400, 116] or [1, 116, 8400]
      // - Multiple outputs: boxes + masks

      let predictions: tf.Tensor;
      let maskCoeffs: tf.Tensor | null = null;

      if (outputArray.length === 1) {
        // Single output tensor - need to determine format
        const shape = outputArray[0].shape;
        if (shape[1] === 116 || shape[2] === 116) {
          predictions = outputArray[0];
        } else {
          predictions = outputArray[0];
        }
      } else {
        // Multiple outputs
        predictions = outputArray[0];
        maskCoeffs = outputArray.length > 1 ? outputArray[1] : null;
      }

      // Process predictions
      const detections = await this.processYOLOOutput(
        predictions,
        maskCoeffs,
        confidenceThreshold,
        nmsThreshold,
        scale,
        offsetX,
        offsetY,
        originalWidth,
        originalHeight,
        targetPointCount,
        maskExpansionPercent
      );

      console.log(
        `Inference completed in ${(performance.now() - startTime).toFixed(0)}ms`
      );
      console.log(`Found ${detections.length} nails`);

      // Cleanup tensors
      tf.dispose([tensor, ...outputArray]);

      return detections;
    } catch (error) {
      tf.dispose(tensor);
      throw error;
    }
  }

  /**
   * Process YOLO output to extract bounding boxes and masks
   */
  private async processYOLOOutput(
    predictions: tf.Tensor,
    maskCoeffs: tf.Tensor | null,
    confidenceThreshold: number,
    nmsThreshold: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    originalWidth: number,
    originalHeight: number,
    targetPointCount: number,
    maskExpansionPercent: number
  ): Promise<DetectedMask[]> {
    // Get predictions shape and data
    const shape = predictions.shape;
    console.log("Processing predictions with shape:", shape);

    let numBoxes: number;
    let numFeatures: number;
    let needsTranspose = false;

    if (shape.length === 3) {
      // Check if shape is [1, 8400, features] or [1, features, 8400]
      if (shape[1] > shape[2]) {
        // [1, 8400, features] format
        numBoxes = shape[1];
        numFeatures = shape[2];
        needsTranspose = false;
      } else {
        // [1, features, 8400] format - needs transpose
        numBoxes = shape[2];
        numFeatures = shape[1];
        needsTranspose = true;
      }
    } else {
      console.error("Unexpected predictions shape:", shape);
      return [];
    }

    console.log(`Processing ${numBoxes} boxes with ${numFeatures} features`);

    // Transpose if needed
    let processedPredictions = predictions;
    if (needsTranspose) {
      processedPredictions = predictions.transpose([0, 2, 1]);
      console.log("Transposed to shape:", processedPredictions.shape);
    }

    const predData = await processedPredictions.data();

    // Collect all valid detections first
    const validDetections: Array<{
      bbox: [number, number, number, number];
      confidence: number;
      maskCoeffs: number[];
    }> = [];

    const hasMaskCoeffs = numFeatures > 5;
    const numMaskCoeffs = hasMaskCoeffs ? numFeatures - 5 : 0;

    // Process each box
    for (let i = 0; i < numBoxes; i++) {
      const baseIdx = i * numFeatures;

      // Extract box coordinates (YOLO format: center_x, center_y, width, height, confidence, ...)
      const centerX = predData[baseIdx];
      const centerY = predData[baseIdx + 1];
      const boxWidth = predData[baseIdx + 2];
      const boxHeight = predData[baseIdx + 3];
      const confidence = predData[baseIdx + 4];

      if (confidence < confidenceThreshold) continue;

      // Extract mask coefficients
      const coeffs: number[] = [];
      if (hasMaskCoeffs) {
        for (let j = 0; j < numMaskCoeffs; j++) {
          coeffs.push(predData[baseIdx + 5 + j]);
        }
      }

      // Convert from model space (640x640) to original image space
      const x1 = (centerX - boxWidth / 2 - offsetX) / scale;
      const y1 = (centerY - boxHeight / 2 - offsetY) / scale;
      const x2 = (centerX + boxWidth / 2 - offsetX) / scale;
      const y2 = (centerY + boxHeight / 2 - offsetY) / scale;

      // Clamp to image bounds
      const bboxX = Math.max(0, Math.min(x1, originalWidth));
      const bboxY = Math.max(0, Math.min(y1, originalHeight));
      const bboxW = Math.min(x2, originalWidth) - bboxX;
      const bboxH = Math.min(y2, originalHeight) - bboxY;

      if (bboxW > 0 && bboxH > 0) {
        validDetections.push({
          bbox: [bboxX, bboxY, bboxW, bboxH],
          confidence,
          maskCoeffs: coeffs,
        });
      }
    }

    console.log(
      `Found ${validDetections.length} valid detections above threshold ${confidenceThreshold}`
    );

    // Apply NMS to remove overlapping detections
    const nmsDetections = this.applyNMS(validDetections, nmsThreshold);
    console.log(`After NMS: ${nmsDetections.length} detections`);

    // Process masks
    const colors = [
      "#3b82f6",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#8b5cf6",
      "#ec4899",
      "#14b8a6",
      "#f97316",
      "#06b6d4",
      "#84cc16",
    ];

    const clampedPointCount = this.clampTargetPointCount(targetPointCount);
    const clampedExpansion = Math.max(0, Math.min(100, maskExpansionPercent));

    const finalDetections: DetectedMask[] = [];

    for (let i = 0; i < nmsDetections.length; i++) {
      const det = nmsDetections[i];

      // Generate mask polygon
      let path: [number, number][];

      if (maskCoeffs && det.maskCoeffs.length > 0) {
        // Use actual segmentation mask
        path = await this.generateMaskFromCoeffs(
          det.maskCoeffs,
          maskCoeffs,
          det.bbox,
          originalWidth,
          originalHeight,
          scale,
          offsetX,
          offsetY,
          clampedPointCount
        );
      } else {
        // Fallback to bounding box
        path = this.buildBBoxPath(
          det.bbox,
          originalWidth,
          originalHeight,
          clampedPointCount
        );
      }

      if (clampedExpansion > 0) {
        path = this.expandNormalizedPolygon(path, clampedExpansion);
      }

      finalDetections.push({
        id: `detection-${i}`,
        path,
        confidence: det.confidence,
        bbox: {
          x: det.bbox[0] / originalWidth,
          y: det.bbox[1] / originalHeight,
          w: det.bbox[2] / originalWidth,
          h: det.bbox[3] / originalHeight,
        },
        color: colors[i % colors.length],
      });
    }

    // Cleanup
    if (needsTranspose && processedPredictions !== predictions) {
      tf.dispose(processedPredictions);
    }

    return finalDetections;
  }

  /**
   * Apply Non-Maximum Suppression
   */
  private applyNMS(
    detections: Array<{
      bbox: [number, number, number, number];
      confidence: number;
      maskCoeffs: number[];
    }>,
    iouThreshold: number
  ): Array<{
    bbox: [number, number, number, number];
    confidence: number;
    maskCoeffs: number[];
  }> {
    if (detections.length === 0) return [];

    // Sort by confidence (descending)
    detections.sort((a, b) => b.confidence - a.confidence);

    const keep: typeof detections = [];
    const suppress = new Set<number>();

    for (let i = 0; i < detections.length; i++) {
      if (suppress.has(i)) continue;

      keep.push(detections[i]);

      for (let j = i + 1; j < detections.length; j++) {
        if (suppress.has(j)) continue;

        const iou = this.calculateIoU(detections[i].bbox, detections[j].bbox);
        if (iou > iouThreshold) {
          suppress.add(j);
        }
      }
    }

    return keep;
  }

  /**
   * Calculate Intersection over Union
   */
  private calculateIoU(
    box1: [number, number, number, number],
    box2: [number, number, number, number]
  ): number {
    const [x1, y1, w1, h1] = box1;
    const [x2, y2, w2, h2] = box2;

    const x1_max = x1 + w1;
    const y1_max = y1 + h1;
    const x2_max = x2 + w2;
    const y2_max = y2 + h2;

    const ix1 = Math.max(x1, x2);
    const iy1 = Math.max(y1, y2);
    const ix2 = Math.min(x1_max, x2_max);
    const iy2 = Math.min(y1_max, y2_max);

    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const intersectionArea = iw * ih;

    const box1Area = w1 * h1;
    const box2Area = w2 * h2;
    const unionArea = box1Area + box2Area - intersectionArea;

    return unionArea > 0 ? intersectionArea / unionArea : 0;
  }

  /**
   * Generate mask polygon from coefficients and prototypes
   */
  private async generateMaskFromCoeffs(
    coeffs: number[],
    prototypes: tf.Tensor,
    bbox: [number, number, number, number],
    originalWidth: number,
    originalHeight: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    targetPointCount: number
  ): Promise<[number, number][]> {
    try {
      if (!prototypes || coeffs.length === 0) {
        // Fallback to bbox
        return this.buildBBoxPath(
          bbox,
          originalWidth,
          originalHeight,
          targetPointCount
        );
      }

      const [bboxX, bboxY, bboxWidth, bboxHeight] = bbox;

      console.log(
        "Prototypes shape:",
        prototypes.shape,
        "Coeffs length:",
        coeffs.length
      );

      // Determine the shape format and extract dimensions
      let prototypesReshaped: tf.Tensor;
      let maskHeight: number;
      let maskWidth: number;
      let numPrototypes: number;

      // Remove batch dimension if present
      const squeezed =
        prototypes.shape[0] === 1 ? prototypes.squeeze([0]) : prototypes;
      const shape = squeezed.shape;

      if (shape.length === 3) {
        // Could be [C, H, W] or [H, W, C]
        if (shape[2] < shape[0] && shape[2] < shape[1]) {
          // [H, W, C] format - need to transpose to [C, H, W]
          console.log("Transposing prototypes from HWC to CHW");
          prototypesReshaped = squeezed.transpose([2, 0, 1]);
          maskHeight = shape[0];
          maskWidth = shape[1];
          numPrototypes = shape[2];
        } else {
          // [C, H, W] format - already correct
          prototypesReshaped = squeezed;
          numPrototypes = shape[0];
          maskHeight = shape[1];
          maskWidth = shape[2];
        }
      } else {
        throw new Error(`Unexpected prototypes shape: ${shape}`);
      }

      console.log(
        `Using ${numPrototypes} prototypes for ${maskWidth}x${maskHeight} mask`
      );

      // Create coefficients tensor - limit to available prototypes
      const coeffsTensor = tf.tensor1d(coeffs.slice(0, numPrototypes));

      // Generate mask: einsum('c,chw->hw', coeffs, prototypes)
      const maskTensor = tf.einsum(
        "c,chw->hw",
        coeffsTensor,
        prototypesReshaped
      );
      const sigmoidMask = tf.sigmoid(maskTensor);
      const maskData = await sigmoidMask.data();

      // Convert bbox from original image coords to model input coords (640x640)
      const modelBboxX = bboxX * scale + offsetX;
      const modelBboxY = bboxY * scale + offsetY;
      const modelBboxW = bboxWidth * scale;
      const modelBboxH = bboxHeight * scale;

      // Scale bbox to mask coordinates (160x160 is 1/4 of 640x640)
      const maskScale = maskWidth / 640; // Should be 160/640 = 0.25
      const maskBboxX = Math.floor(modelBboxX * maskScale);
      const maskBboxY = Math.floor(modelBboxY * maskScale);
      const maskBboxW = Math.ceil(modelBboxW * maskScale);
      const maskBboxH = Math.ceil(modelBboxH * maskScale);

      console.log(
        `BBox in mask coords: [${maskBboxX}, ${maskBboxY}, ${maskBboxW}, ${maskBboxH}]`
      );

      // Extract polygon from the cropped mask region
      const polygon = this.extractPolygonFromMask(
        maskData,
        maskWidth,
        maskHeight,
        maskBboxX,
        maskBboxY,
        maskBboxW,
        maskBboxH,
        bboxX,
        bboxY,
        bboxWidth,
        bboxHeight,
        originalWidth,
        originalHeight,
        targetPointCount
      );

      // Cleanup
      tf.dispose([coeffsTensor, prototypesReshaped, maskTensor, sigmoidMask]);
      if (squeezed !== prototypes) {
        tf.dispose(squeezed);
      }

      return polygon;
    } catch (error) {
      console.error("Error generating mask:", error);
      // Fallback to bbox
      return this.buildBBoxPath(
        bbox,
        originalWidth,
        originalHeight,
        targetPointCount
      );
    }
  }

  /**
   * Extract polygon from mask using contour detection
   */
  private extractPolygonFromMask(
    maskData: Float32Array | Int32Array | Uint8Array,
    maskWidth: number,
    maskHeight: number,
    maskBboxX: number,
    maskBboxY: number,
    maskBboxW: number,
    maskBboxH: number,
    imageBboxX: number,
    imageBboxY: number,
    imageBboxW: number,
    imageBboxH: number,
    originalWidth: number,
    originalHeight: number,
    targetPointCount: number,
    threshold = 0.5
  ): [number, number][] {
    console.log(
      `Extracting polygon from mask region [${maskBboxX}, ${maskBboxY}, ${maskBboxW}, ${maskBboxH}]`
    );

    const fallbackPolygon = () =>
      this.buildBBoxPath(
        [imageBboxX, imageBboxY, imageBboxW, imageBboxH],
        originalWidth,
        originalHeight,
        targetPointCount
      );

    // Create a 2D array for easier access - crop to bbox region
    const mask2D: number[][] = [];
    for (
      let y = maskBboxY;
      y < Math.min(maskBboxY + maskBboxH, maskHeight);
      y++
    ) {
      const row: number[] = [];
      for (
        let x = maskBboxX;
        x < Math.min(maskBboxX + maskBboxW, maskWidth);
        x++
      ) {
        row.push(maskData[y * maskWidth + x]);
      }
      mask2D.push(row);
    }

    const croppedHeight = mask2D.length;
    const croppedWidth = mask2D[0]?.length || 0;
    console.log(`Cropped mask to ${croppedWidth}x${croppedHeight}`);

    if (croppedWidth < 2 || croppedHeight < 2) {
      console.log("Cropped mask too small, using bounding box");
      return fallbackPolygon();
    }

    // Find boundary pixels using a simple edge check
    const edgePoints: [number, number][] = [];
    for (let y = 1; y < croppedHeight - 1; y++) {
      for (let x = 1; x < croppedWidth - 1; x++) {
        if (mask2D[y][x] > threshold) {
          const isEdge =
            mask2D[y - 1][x] <= threshold ||
            mask2D[y + 1][x] <= threshold ||
            mask2D[y][x - 1] <= threshold ||
            mask2D[y][x + 1] <= threshold;
          if (isEdge) {
            edgePoints.push([x, y]);
          }
        }
      }
    }

    for (let y = 0; y < croppedHeight; y++) {
      if (mask2D[y][0] > threshold) edgePoints.push([0, y]);
      if (mask2D[y][croppedWidth - 1] > threshold)
        edgePoints.push([croppedWidth - 1, y]);
    }
    for (let x = 0; x < croppedWidth; x++) {
      if (mask2D[0][x] > threshold) edgePoints.push([x, 0]);
      if (mask2D[croppedHeight - 1][x] > threshold)
        edgePoints.push([x, croppedHeight - 1]);
    }

    console.log(`Found ${edgePoints.length} edge points`);

    if (edgePoints.length < 3) {
      console.log("Too few edge points, using bounding box");
      return fallbackPolygon();
    }

    // Map edge points into image coordinate space
    const imagePoints: [number, number][] = edgePoints.map(([x, y]) => {
      const imageX = imageBboxX + (x / croppedWidth) * imageBboxW;
      const imageY = imageBboxY + (y / croppedHeight) * imageBboxH;
      return [imageX, imageY];
    });

    const centroidX =
      imagePoints.reduce((sum, point) => sum + point[0], 0) /
      imagePoints.length;
    const centroidY =
      imagePoints.reduce((sum, point) => sum + point[1], 0) /
      imagePoints.length;

    const orderedPoints = [...imagePoints].sort((a, b) => {
      const angleA = Math.atan2(a[1] - centroidY, a[0] - centroidX);
      const angleB = Math.atan2(b[1] - centroidY, b[0] - centroidX);
      return angleA - angleB;
    });

    const dedupedPoints = this.removeSequentialDuplicates(orderedPoints, 0.5);
    if (dedupedPoints.length < 3) {
      console.log("Deduplication removed too many points, using bounding box");
      return fallbackPolygon();
    }

    const clampedCount = this.clampTargetPointCount(targetPointCount);
    const initialSmoothPasses = dedupedPoints.length > clampedCount ? 2 : 1;
    const smoothed = this.smoothPolygon(dedupedPoints, initialSmoothPasses);
    const resampled = this.resamplePolygon(smoothed, clampedCount);
    const finalPoints = this.removeSequentialDuplicates(
      this.smoothPolygon(resampled, 1),
      0.1
    );

    if (finalPoints.length < 3) {
      console.log("Resampling resulted in too few points, using bounding box");
      return fallbackPolygon();
    }

    return finalPoints.map(
      ([x, y]: [number, number]) =>
        [x / originalWidth, y / originalHeight] as [number, number]
    );
  }

  /**
   * Smooth polygon by averaging each point with its neighbors while preserving point count
   */
  private smoothPolygon(
    points: [number, number][],
    iterations: number = 1
  ): [number, number][] {
    if (points.length < 3 || iterations <= 0) {
      return [...points];
    }

    let current = [...points];

    for (let iter = 0; iter < iterations; iter++) {
      const source = [...current];
      const smoothed: [number, number][] = [];

      for (let i = 0; i < source.length; i++) {
        const prev = source[(i - 1 + source.length) % source.length];
        const point = source[i];
        const next = source[(i + 1) % source.length];

        smoothed.push([
          (prev[0] + 2 * point[0] + next[0]) / 4,
          (prev[1] + 2 * point[1] + next[1]) / 4,
        ]);
      }

      current = smoothed;
    }

    return current;
  }

  private removeSequentialDuplicates(
    points: [number, number][],
    minDistance: number
  ): [number, number][] {
    if (points.length === 0) return [];

    const result: [number, number][] = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (result.length === 0) {
        result.push(point);
        continue;
      }

      const prev = result[result.length - 1];
      const dx = point[0] - prev[0];
      const dy = point[1] - prev[1];
      if (Math.hypot(dx, dy) >= minDistance) {
        result.push(point);
      }
    }

    // Ensure the last point isn't effectively the same as the first
    if (result.length > 1) {
      const first = result[0];
      const last = result[result.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) < minDistance) {
        result.pop();
      }
    }

    return result;
  }

  private clampTargetPointCount(count: number): number {
    return Math.max(3, Math.min(50, Math.round(count)));
  }

  private expandNormalizedPolygon(
    points: [number, number][],
    expansionPercent: number
  ): [number, number][] {
    if (!points.length) {
      return [];
    }

    const factor = 1 + expansionPercent / 100;
    if (
      !Number.isFinite(factor) ||
      factor <= 0 ||
      Math.abs(factor - 1) < 1e-6
    ) {
      return [...points];
    }

    let centroidX = 0;
    let centroidY = 0;
    for (const [x, y] of points) {
      centroidX += x;
      centroidY += y;
    }
    centroidX /= points.length;
    centroidY /= points.length;

    return points.map(([x, y]) => {
      const nx = centroidX + (x - centroidX) * factor;
      const ny = centroidY + (y - centroidY) * factor;
      return [Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny))] as [
        number,
        number
      ];
    });
  }

  private resamplePolygon(
    points: [number, number][],
    targetCount: number
  ): [number, number][] {
    const clampedCount = this.clampTargetPointCount(targetCount);
    const n = points.length;

    if (n === 0) return [];
    if (n === 1) {
      const [x, y] = points[0];
      return Array.from(
        { length: clampedCount },
        () => [x, y] as [number, number]
      );
    }

    const distances: number[] = new Array(n);
    const cumulative: number[] = new Array(n + 1);
    cumulative[0] = 0;

    for (let i = 0; i < n; i++) {
      const nextIndex = (i + 1) % n;
      const dx = points[nextIndex][0] - points[i][0];
      const dy = points[nextIndex][1] - points[i][1];
      const distance = Math.hypot(dx, dy);
      distances[i] = distance;
      cumulative[i + 1] = cumulative[i] + distance;
    }

    const totalLength = cumulative[n];
    if (totalLength < 1e-6) {
      const [x, y] = points[0];
      return Array.from(
        { length: clampedCount },
        () => [x, y] as [number, number]
      );
    }

    const step = totalLength / clampedCount;
    const resampled: [number, number][] = [];
    let segmentIndex = 0;

    for (let i = 0; i < clampedCount; i++) {
      const targetDistance = Math.min(i * step, totalLength - 1e-6);

      while (
        segmentIndex < n - 1 &&
        cumulative[segmentIndex + 1] <= targetDistance
      ) {
        segmentIndex++;
      }

      let segmentStart = cumulative[segmentIndex];
      let segmentLength = distances[segmentIndex];

      if (segmentLength < 1e-6) {
        let lookAhead = 1;
        while (lookAhead < n) {
          const candidateIndex = segmentIndex + lookAhead;
          if (candidateIndex >= n) {
            break;
          }
          segmentLength = distances[candidateIndex];
          if (segmentLength >= 1e-6) {
            segmentIndex = candidateIndex;
            segmentStart = cumulative[segmentIndex];
            break;
          }
          lookAhead++;
        }
      }

      const nextIndex = (segmentIndex + 1) % n;
      const numerator = targetDistance - segmentStart;
      const clampedNumerator = Math.min(segmentLength, Math.max(0, numerator));
      const localT =
        segmentLength < 1e-6 ? 0 : clampedNumerator / segmentLength;

      const fromPoint = points[segmentIndex];
      const toPoint = points[nextIndex];
      resampled.push([
        fromPoint[0] + localT * (toPoint[0] - fromPoint[0]),
        fromPoint[1] + localT * (toPoint[1] - fromPoint[1]),
      ]);
    }

    return resampled;
  }

  private buildBBoxPath(
    bbox: [number, number, number, number],
    originalWidth: number,
    originalHeight: number,
    targetPointCount: number
  ): [number, number][] {
    const [x, y, w, h] = bbox;
    const raw: [number, number][] = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    const sampled = this.resamplePolygon(raw, targetPointCount);
    return sampled.map(
      ([px, py]: [number, number]) =>
        [px / originalWidth, py / originalHeight] as [number, number]
    );
  }

  /**
   * Dispose of the model and free up memory
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }
}

// Singleton instance
let segmentationInstance: NailSegmentation | null = null;

export function getSegmentationInstance(): NailSegmentation {
  if (!segmentationInstance) {
    segmentationInstance = new NailSegmentation();
  }
  return segmentationInstance;
}
