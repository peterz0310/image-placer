# Image Placer (Placeit-style) — Web App (Next.js)

A lightweight, **generic** web tool to place, skew, (optionally warp), and mask overlay images onto a base image, then **export**:

- a **ZIP** containing:
  - the **original base** image (as provided),
  - all **original overlay** images,
  - a **rendered composite** (PNG),
  - a **project JSON** (precise placements, transforms, masks, blend, z-order, etc.).

Designed for product mockups like **nail designs on model hands**, but generic enough for packaging, apparel, screens, posters, etc.

---

## Table of Contents

1. [Goals & Non-Goals](#goals--non-goals)
2. [Tech Stack](#tech-stack)
3. [Core Concepts](#core-concepts)
4. [Data Model (Project JSON Schema)](#data-model-project-json-schema)
5. [App Architecture](#app-architecture)
6. [User Flows](#user-flows)
7. [Rendering & Algorithms](#rendering--algorithms)
8. [Export: ZIP Bundle](#export-zip-bundle)
9. [Implementation Plan (Step-by-Step)](#implementation-plan-step-by-step)
10. [UI/UX Details](#uiux-details)
11. [Performance & Quality](#performance--quality)

---

## Goals & Non-Goals

### Goals

- **Simple, focused editor**: a base image “stage” where users add multiple overlays and position/transform them.
- **Transforms**: translate, scale, rotate, skew (with numeric controls). Optional **perspective warp** via 4-corner quad.
- **Masking**: per-overlay vector polygon masks (with feather radius); invert toggle.
- **Blending**: per-overlay opacity and blend modes (Normal, Multiply, Screen, Overlay, etc. where supported).
- **Guides**: snapping, rulers, and safe margins.
- **Export**: ZIP with (1) original base, (2) original overlay assets, (3) composite PNG render, (4) **Project JSON**.
- **Repeatable**: all transforms normalized to the base image intrinsic size → renders are exact and reproducible anywhere.
- **All-client**: works offline as a PWA (no server needed) and keeps assets in memory/IndexedDB.

### Non-Goals

- Full Photoshop replacement. Keep the scope tight: placement, basic warps, masks, and a great export story.
- Multi-page layouts (v1 is single canvas per project).
- Text layers (optional later).

---

## Tech Stack

- **Framework**: Next.js 14+ (App Router, Client Components for the editor).
- **Canvas Layer**: **Fabric.js** (robust 2D transforms + JSON), plus a **WebGL Warp** mode (optional) using **Three.js** with a textured Plane for true 4-corner perspective warps.
  - Rationale: Fabric for fast iteration/handles/selection; Three.js plane for perspective when toggled.
- **Mask Rasterization**: OffscreenCanvas via **Web Worker** for feathered polygon masks (fast, non-blocking).
- **Blend Modes**: Canvas2D globalCompositeOperation fallback; where not exact, approximate in the final renderer using custom shader in WebGL composite.
- **State Storage**: Zustand (or Redux-lite with Zustand) + IndexedDB for autosave drafts.
- **Export ZIP**: **JSZip** (client side).
- **Image Encoding**: Canvas `.toDataURL()` / `.toBlob()`; WebGL readPixels for composite if needed.
- **TypeScript** everywhere.

---

## Core Concepts

- **Base image**: the “photo” or “mockup background” (e.g., model hand). Defines the **intrinsic coordinate system** (width x height).
- **Layer**: an overlay image with transforms, optional **quad** warp, optional **mask polygon**, blend, opacity, z-order.
- **Normalized Units**: positions/vertices stored as 0..1 relative to base width/height → resolution independent.
- **Render Target**: on export, choose output resolution (default = base intrinsic) to ensure 1:1 fidelity.

---

## Data Model (Project JSON Schema)

Versioned, human-readable, resolution-independent.

```jsonc
{
  "version": 1,
  "projectId": "uuid-v4",
  "title": "My Mockup",
  "createdAt": "2025-09-22T05:00:00.000Z",
  "updatedAt": "2025-09-22T05:00:00.000Z",
  "base": {
    "name": "model-hand.png",
    "src": "blob:or/dataurl/or/relative/path",
    "width": 1200,        // intrinsic pixels of the base image
    "height": 1600
  },
  "canvas": {
    "background": "#00000000",
    "dpi": 72,             // metadata only; render uses pixel dimensions
    "safeMargin": { "top": 0, "right": 0, "bottom": 0, "left": 0 } // normalized 0..1
  },
  "layers": [
    {
      "id": "uuid-v4",
      "name": "overlay-1.png",
      "src": "blob:/dataurl/or/relative/path",
      "originalSize": { "w": 800, "h": 1200 }, // intrinsic of overlay
      "visible": true,
      "locked": false,
      "opacity": 1.0,
      "blendMode": "normal", // normal|multiply|screen|overlay|darken|lighten|(fallback to normal if unsupported)
      "zIndex": 0,

      // Transform in normalized space (no warp)
      "transform": {
        "left": 0.50,    // normalized 0..1 stage space (center after rotation)
        "top": 0.50,     // normalized
        "scaleX": 0.25,  // relative to overlay intrinsic width
        "scaleY": 0.25,
        "angle": 0.0,    // degrees
        "skewX": 0.0,    // degrees
        "skewY": 0.0     // degrees
      },

      // Optional perspective quad warp (replaces transform for final render if enabled)
      // 4 points in normalized stage space, clockwise TL, TR, BR, BL
      "quad": {
        "enabled": false,
        "points": [
          { "x": 0.40, "y": 0.40 },
          { "x": 0.60, "y": 0.40 },
          { "x": 0.58, "y": 0.55 },
          { "x": 0.42, "y": 0.56 }
        ],
        // when enabled, the overlay image maps so [0,0],[1,0],[1,1],[0,1] → TL,TR,BR,BL
        "keepAspect": true // if true, maintain overlay aspect while mapping
      },

      // Optional vector mask (normalized polygon)
      "mask": {
        "enabled": false,
        "invert": false,
        "feather": 2.0,              // px at render time (absolute in output pixels)
        "path": [
          { "x": 0.48, "y": 0.35 },
          { "x": 0.62, "y": 0.36 },
          { "x": 0.63, "y": 0.46 },
          { "x": 0.47, "y": 0.45 }
        ]
      },

      // Optional per-layer color adjustments (applied before blend)
      "adjust": {
        "enabled": false,
        "exposure": 0.0,  // -2..+2 stops
        "contrast": 0.0,  // -100..+100
        "saturation": 0.0 // -100..+100
      },

      // Arbitrary metadata (e.g., tags/finger IDs)
      "meta": { "finger": "index", "variant": "glossy" }
    }
  ],
  "meta": {
    "notes": "Freeform notes for operators",
    "tags": ["mockup", "v1"]
  }
}
Notes

If quad.enabled = true, the quad mapping is the source of truth for shape; transform is still stored for UI handles but final render uses the quad.

mask.feather is in output pixels for predictable softness regardless of stage size.

App Architecture
pgsql
Copy code
/app
  /editor
    page.tsx            // Editor route
    /components
      Stage.tsx         // Fabric canvas + overlay of handles
      OverlayItem.tsx   // Wrapper to connect Fabric objects ↔ Layer state
      WarpOverlay.tsx   // Quad handles & Three.js plane preview
      MaskEditor.tsx    // Polygon drawing, feather preview
      Toolbar.tsx       // Add image, zoom, snapping, blend, opacity controls
      LayerList.tsx     // Reorder, visibility/lock, rename
      ExportPanel.tsx   // Composite settings and Export ZIP
    /lib
      fabricHelpers.ts  // Fabric init, object creation, snapping, keyboard
      warpMath.ts       // quad<->triangulation, UV mapping, barycentric helpers
      maskWorker.ts     // worker wrapper (compile polygon to 8-bit alpha mask)
      composite.ts      // final composite pipeline (2D or WebGL)
      zip.ts            // JSZip helpers (gather assets + JSON + composite)
      schema.ts         // JSON schema, migrations
  layout.tsx
  page.tsx              // Landing page (Create/Open Project)
State Management: Zustand store holding project, selection, ui (zoom, snap, rulers), history (+ undo/redo stack).

Canvas: Fabric canvas for selection/transform handles. When Warp Mode is toggled for a layer, Fabric object is ghosted; a Quad Handle Overlay controls four corner points; preview is a Three.js plane textured with the overlay image.

Mask Editor: polygon tool (click to add, backspace to delete, close path to finish). Feather preview via shader blur or fast separable Gaussian in worker.

User Flows
New Project

Upload base image (drag/drop or file picker).

Stage resizes to base intrinsic dimensions (fit to viewport with zoom).

Project JSON initialized.

Add Overlay

Upload PNG/JPG.

Layer appears centered; Fabric handles for move/scale/rotate/skew.

Name defaults to file name; can rename in Layer List.

Adjust Layer

Transform Mode: use Fabric controls; numeric inputs show/read: X, Y (normalized), angle, skewX/Y, scale.

Warp Mode (toggle): show 4 corner handles; drag to shape; Three.js plane renders perspective warp preview.

Mask Mode: draw polygon; toggle invert; set feather.

Styling

Opacity slider; Blend Mode dropdown.

Optional basic adjustments (exposure/contrast/saturation).

Guides & Snapping

Toggle rulers; drag guides; snapping to guides/edges/centers; show safe margins.

Save/Load

Export Project JSON (download).

Import a Project JSON (re-linking assets if embedded as data URLs, or prompt to locate missing files).

Autosave drafts in IndexedDB (optional).

Export ZIP

Choose output pixel size (default = base intrinsic).

Render final composite (2D or WebGL pipeline based on warps/blends).

Package ZIP:

/project.json – full state (with normalized transforms).

/render.png – composite at selected resolution.

/assets/base/<original name> – unmodified base.

/assets/layers/<id>-<original name> – unmodified overlays.

Download ZIP.

Rendering & Algorithms
A) Non-Warp (Fabric)
Fabric applies transform matrix (translation/rotation/scale/skew).

For blend modes not supported in Fabric’s live preview, emulate in composite step.

B) Perspective Warp (Three.js Plane)
When layer.quad.enabled, build a textured plane subdivided into a small grid (e.g., 32×32).

Map the overlay image UVs to the quad corners; the plane deforms to match projected quad.

For final composite:

Render each layer in order to an offscreen WebGL framebuffer with alpha.

Apply blend/opacity in shader.

Apply mask: rasterize polygon to an alpha texture (via worker), then multiply alpha in shader.

Result combined into the main framebuffer.

C) Masking (Polygon → Alpha)
In a Web Worker:

Create an OffscreenCanvas at output size.

Draw polygon filled white on black background.

Apply Gaussian blur with sigma = feather / 2.0 to get soft edge.

Return ImageBitmap/ArrayBuffer as an 8-bit alpha texture.

In 2D pipeline, clip via globalCompositeOperation or use the alpha image as source-in/destination-in.

D) Normalization
Store all positions as 0..1 of base dimensions.

Render: multiply normalized coords by render width/height to get pixel coords. Masks recomputed at output resolution for correct feather.

Export: ZIP Bundle
Structure

sql
Copy code
my-project-YYYYMMDD-HHMM.zip
├─ project.json
├─ render.png
└─ assets/
   ├─ base/
   │  └─ model-hand.png
   └─ layers/
      ├─ 8a1f..-overlay-1.png
      ├─ 7c39..-overlay-2.png
      └─ ...
project.json

Contains relative paths to assets inside ZIP (assets/...) and all normalized transforms.

Optional embedded: true per asset if including data URIs (default: store raw files).

ZIP Creation (JSZip)

Collect blobs: base, each overlay, rendered PNG, project.json stringified.

zip.generateAsync({ type: "blob" }) → download via a link.

Implementation Plan (Step-by-Step)
0) Scaffold
pnpm dlx create-next-app@latest image-placer --ts --eslint --src-dir --app --tailwind

Install deps:

pnpm add fabric three zustand jszip

Optional: pnpm add zod (schema), pnpm add idb-keyval (IndexedDB helper)

1) Project Store (Zustand)
useProjectStore with:

project (matches schema),

actions: setBase, addLayer, updateLayer(id, patch), reorder, removeLayer,

selection state (selectedId), undo/redo stacks.

2) Base Loader
Component to pick base file; read as blob URL; read intrinsic Image width/height → set project base.

3) Canvas (Fabric) for Transform Mode
Initialize Fabric canvas at base intrinsic size.

On window resize, scale viewport (CSS scale) + maintain zoom/pan.

For each layer with quad.enabled=false, create fabric.Image with:

left, top (pixel coords = normalized * base size),

angle, skewX, skewY, scaleX, scaleY.

Sync Fabric ↔ store on changes (object:modified, selection:created, etc.).

Keyboard shortcuts: Delete, ⌘G for group (later), arrows to nudge, Shift for proportional.

4) Warp Mode (Quad Handles + Three.js preview)
Overlay 4 draggable corner handles positioned by normalized quad points.

Convert quad to a subdivided grid plane in Three.js; texture with overlay image.

Updating a corner recomputes geometry; draw over Fabric canvas for live preview.

If user disables Warp Mode → compute best-fit affine/skew back to Fabric transforms (optional), else keep warp only.

5) Mask Editor
Polygon pen tool: click to add points, hover preview segment, close to commit.

Store normalized polygon; show live feather preview (draw to temp OffscreenCanvas and composite alpha).

Toggle invert; numeric feather input.

6) Blending & Adjustments
UI panel for opacity, blend mode, exposure/contrast/saturation.

For live preview, use:

Fabric blend fallback (limited), or

a “Preview Composite” button that renders a quick WebGL pass.

7) Guides & Snapping
Rulers (top/left), draggable guides; snapping to guides and object bounds/centers.

Safe margins (normalized) visualized.

8) Export Composite
Choose output size (default = base intrinsic; allow custom like 2×/4×).

If any layer has warp enabled or unsupported blend:

Use WebGL composite pipeline:

For each layer in sorted z:

Apply color adjustments in shader.

If mask.enabled, sample alpha texture.

Blend with current framebuffer.

Else: can use 2D canvas with Fabric’s toCanvasElement() plus manual blend passes.

Get PNG blob.

9) Export ZIP
Build project.json with:

normalized transforms, quads, masks, blend, adjust, z-order.

asset relative paths inside ZIP.

Add:

assets/base/<name> (original blob),

assets/layers/<id>-<name> for each overlay,

render.png,

project.json.

Generate + download.

10) Import Project
Load project.json; prompt user to supply missing assets if not included (or embedded).

Reconstruct layers on canvas.

11) Persistence (Optional)
Autosave to IndexedDB on debounce (1s).

“Restore draft?” toast on landing if draft exists.

UI/UX Details
Top Toolbar: Open Base, Add Overlay, Transform / Warp / Mask toggles, Zoom, Undo/Redo, Export.

Right Panel:

Layer List with eye/lock, drag-to-reorder, rename.

Selected Layer props:

Position/Size (normalized + pixel readout), Angle, Skew, Scale lock.

Warp: coordinates of 4 corners (editable text).

Mask: feather (px), invert toggle, edit button.

Styling: opacity, blend mode, exposure/contrast/sat.

Bottom Bar: Zoom %, pixel cursor readout, snap indicator, “Safe margin” toggles.

Accessibility:

Keyboard focus, ARIA labels, tooltips, visible focus ring.

Numeric fields with fine/coarse step via Shift/Alt.

Performance & Quality
Large Images: Cap preview canvas to ~4096 px max dimension; use downscaled preview in editor, but export at full resolution.

Workers: Mask rasterization & blur in a Web Worker with OffscreenCanvas.

Memory: Revoke object URLs for images on layer removal.

Precision: Store normalized values in JSON; computations use base intrinsic converted to output pixels at render time.

Color: Assume sRGB; avoid device color management surprises by sticking to standard 8-bit PNGs.
```
