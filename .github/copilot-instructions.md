# Image Placer - AI Coding Agent Instructions

## Project Overview

Next.js 15 + React 19 + Fabric.js 6.7 canvas editor for composing layered product visuals, nail art mockups, and marketing assets. Uses normalized coordinates (0-1) for resolution independence, enabling templates to work across different image sizes.

## Architecture & Data Flow

### Core Component Hierarchy

- `ImagePlacer.tsx` (2876 lines) - Main state container, handles project lifecycle, history, imports/exports
- `FabricCanvas.tsx` (3329 lines) - Fabric.js canvas wrapper with imperative ref interface, manages all canvas interactions
- UI components: `FloatingToolbar`, `LayerProperties`, `HistoryToolbar` - control panels

### State Management Pattern

Single source of truth: `Project` object with `base` image + array of `Layer` objects. No Redux/Zustand - state lifted to `ImagePlacer`, passed down with callbacks. History managed via `useHistory` hook (50-state undo/redo buffer with 500ms debounce).

### Critical Coordinate Systems

1. **Normalized (0-1)**: Storage format in `Layer.transform` - `{left, top, scaleX, scaleY, angle, skewX, skewY}`
2. **Canvas pixels**: Display format (max 960×720 via `CANVAS_MAX_WIDTH/HEIGHT`)
3. **Export pixels**: Scaled to base image dimensions with `normalizedScaleX/Y` for resolution independence

Example: `transform.left: 0.5` → canvas renders at `960 * 0.5 = 480px`, exports at `baseWidth * 0.5`.

### Mask System Architecture

- Masks stored as **normalized polygon paths**: `[number, number][]` in 0-1 space
- Rendering: `MaskRenderer.createMaskCanvas()` converts to absolute pixels, applies Catmull-Rom smoothing, optional feathering
- Editor state separation: `mask.editorPath/editorSmoothing/editorOffset` preserves original control points for re-editing
- Transform box (Rect) + handle circles (Circle) overlay system for point manipulation in mask mode

## Development Workflows

### Running the app

```bash
npm run dev        # Next.js dev server with Turbopack
npm run build      # Production build (also uses Turbopack)
npx tsc --noEmit   # Type checking (no build script configured)
npm run lint       # ESLint check
```

### Testing mask edits

1. Switch to mask mode (`tool: "mask"`)
2. Click canvas to add polygon points, double-click to finish
3. Select layer → handles appear on each point (green → orange when selected)
4. Delete key removes selected handle, Escape deselects
5. Double-click near edge inserts point at closest position (threshold: 25px)

### Working with FabricCanvas

Exposes imperative methods via `FabricCanvasRef`:

- `updateLayer(layer)` - sync layer changes to canvas
- `exportCanvas(scale)` - render composite at scale
- `finishMaskDrawing()` / `cancelMaskDrawing()` - control mask editor
- **Never call Fabric methods directly** - use ref methods or `onLayerUpdate` callback

Space bar enables panning in both select & mask modes (implemented in pan handling effect around line 1745-1900).

## Critical Conventions

### Fabric.js Object Tracking

- `objectLayerMapRef: Map<FabricObject, string>` maps canvas objects to layer IDs
- Custom properties on Fabric objects: `_isMaskHandle`, `_isMaskOverlay`, `_isMaskTransformBox`, `_maskLayerId`, `_maskPointIndex`
- **Must use `(obj as any)._propertyName`** - Fabric types don't include custom props

### Transform Mode System

Two modes: `"normal"` (scale/rotate) and `"skew"` (perspective distortion)

- `applyTransformModeToObject()` dynamically overrides control handlers
- Skew mode: replaces scale handlers with custom skew logic, stores original handlers in `_originalHandlers`
- Locked layers: all controls disabled, visual opacity changes on drag

### Zoom/Pan State Synchronization

Complex 3-way sync between refs, canvasState prop, and parent callbacks:

- `canvasZoomRef/canvasPanRef` - immediate local state
- `skipCanvasStateSyncRef` - prevents infinite loops when pushing state to parent
- `normalizePan()` rounds to 2 decimals, `pansAreClose()` uses 0.1 epsilon
- Wheel events debounced 50ms before notifying parent

### History Patterns

```typescript
// Debounced auto-save (500ms, skipped for Add/Remove/Delete)
saveState(project, "Layer position");

// Force immediate save for structural changes
saveState(project, "Add overlay layer");
```

### Export System (`utils/export.ts`)

ZIP contains:

- `project.json` - serialized without base64 imageData (only metadata)
- `composite.{png|jpg}` - flattened render
- `assets/` - original files + `{layerName}_mask.png` + `combined_mask.png`

`ProjectExporter.importZIP()` rehydrates with mask → canvas mapping.

## AI/ML Integration

### YOLO Segmentation (`utils/segmentation.ts`)

- TensorFlow.js WebGL backend loads model from `/public/model_web/model.json`
- `NailSegmentation.detectObjects()` returns `DetectedMask[]` with polygon paths
- Model warm-up on first load (dummy inference prevents cold start)
- See `examples/yolo.ts` for output processing logic (marching squares for contours)

**When extending detection**: maintain normalized coordinates, use `extractPolygonFromMask()` for boundary conversion.

## Common Pitfalls

1. **Mask offset mutations**: Always clone offset objects - `{...layer.mask.offset}` not `layer.mask.offset`
2. **Canvas state sync loops**: Increment `skipCanvasStateSyncRef.current` when calling parent callbacks from canvas effects
3. **Fabric object disposal**: Remove event listeners (`obj.off()`) before `canvas.remove(obj)` to prevent memory leaks
4. **Scale calculations**: Use `normalizedScaleX/Y` for exports, not raw `scaleX/Y` which is display-relative
5. **Mask handle selection**: Use `selectMaskHandle()` helper, never set `selectedMaskHandleRef` directly

## File Locations

- Types: `src/types/index.ts` - all interfaces (Project, Layer, Transform, Mask, CanvasState)
- Constants: `src/constants/canvas.ts` - display size limits
- Hooks: `src/hooks/useHistory.ts` - undo/redo with keyboard shortcuts
- Utils: `src/utils/{export,mask,segmentation}.ts` - I/O, rendering, ML
