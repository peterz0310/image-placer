"use client";

import {
  MousePointer2,
  Hand,
  Move3D,
  Scissors,
  Undo2,
  Redo2,
  Scan,
  Minus,
  Plus,
} from "lucide-react";

interface FloatingToolbarProps {
  tool: "select" | "pan" | "mask";
  transformMode: "normal" | "skew";
  onToolChange: (tool: "select" | "pan" | "mask") => void;
  onTransformModeChange: (mode: "normal" | "skew") => void;
  // History props
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  // Zoom controls
  zoom: number;
  onZoomChange: (nextZoom: number) => void;
  onZoomReset?: () => void;
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
}

export default function FloatingToolbar({
  tool,
  transformMode,
  onToolChange,
  onTransformModeChange,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  zoom,
  onZoomChange,
  onZoomReset,
  minZoom = 0.25,
  maxZoom = 4,
  zoomStep = 0.1,
}: FloatingToolbarProps) {
  const clampedZoom = Math.min(Math.max(zoom, minZoom), maxZoom);
  const canZoomOut = clampedZoom > minZoom + 1e-6;
  const canZoomIn = clampedZoom < maxZoom - 1e-6;

  const handleZoomAdjust = (delta: number) => {
    const nextZoom = Math.min(Math.max(clampedZoom + delta, minZoom), maxZoom);
    onZoomChange(Number(nextZoom.toFixed(2)));
  };

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white shadow-lg rounded-lg border p-2 flex gap-2">
      {/* History Controls */}
      {(onUndo || onRedo) && (
        <>
          <div className="flex gap-1">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className={`p-2 rounded transition-colors ${
                canUndo
                  ? "text-blue-600 hover:bg-blue-50"
                  : "text-gray-400 cursor-not-allowed"
              }`}
              title={canUndo ? "Undo (Cmd+Z)" : "Nothing to undo"}
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className={`p-2 rounded transition-colors ${
                canRedo
                  ? "text-green-600 hover:bg-green-50"
                  : "text-gray-400 cursor-not-allowed"
              }`}
              title={canRedo ? "Redo (Cmd+Shift+Z)" : "Nothing to redo"}
            >
              <Redo2 size={16} />
            </button>
          </div>

          {/* Separator */}
          <div className="w-px bg-gray-300"></div>
        </>
      )}

      {/* Zoom Controls */}
      <div className="flex items-center bg-gray-100 rounded">
        <button
          onClick={() => handleZoomAdjust(-zoomStep)}
          disabled={!canZoomOut}
          className={`px-2 py-2 text-sm rounded-l transition-colors flex items-center justify-center ${
            canZoomOut
              ? "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
              : "text-gray-400 cursor-not-allowed"
          }`}
          title={canZoomOut ? "Zoom out" : "Min zoom reached"}
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => {
            if (onZoomReset) {
              onZoomReset();
            } else {
              onZoomChange(1);
            }
          }}
          className="px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-200 transition-colors"
          title="Reset zoom and center"
        >
          {`${Math.round(clampedZoom * 100)}%`}
        </button>
        <button
          onClick={() => handleZoomAdjust(zoomStep)}
          disabled={!canZoomIn}
          className={`px-2 py-2 text-sm rounded-r transition-colors flex items-center justify-center ${
            canZoomIn
              ? "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
              : "text-gray-400 cursor-not-allowed"
          }`}
          title={canZoomIn ? "Zoom in" : "Max zoom reached"}
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Separator */}
      <div className="w-px bg-gray-300"></div>

      {/* Tool Selection */}
      <div className="flex bg-gray-100 rounded">
        <button
          onClick={() => onToolChange("select")}
          className={`px-3 py-2 text-sm rounded-l transition-colors flex items-center gap-2 ${
            tool === "select"
              ? "bg-blue-600 text-white"
              : "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
          }`}
          title="Select Tool (hold Space or use middle mouse to pan)"
        >
          <MousePointer2 size={16} />
          Select
        </button>
        <button
          onClick={() => onToolChange("pan")}
          className={`px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
            tool === "pan"
              ? "bg-blue-600 text-white"
              : "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
          }`}
          title="Pan Tool (or hold Space/use middle mouse in Select mode)"
        >
          <Hand size={16} />
          Pan
        </button>
        <button
          onClick={() => onToolChange("mask")}
          className={`px-3 py-2 text-sm rounded-r transition-colors flex items-center gap-2 ${
            tool === "mask"
              ? "bg-blue-600 text-white"
              : "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
          }`}
          title="Mask Tool"
        >
          <Scissors size={16} />
          Mask
        </button>
      </div>

      {/* Separator */}
      <div className="w-px bg-gray-300"></div>

      {/* Transform Mode */}
      <div className="flex bg-gray-100 rounded">
        <button
          onClick={() => onTransformModeChange("normal")}
          className={`px-3 py-2 text-sm rounded-l transition-colors flex items-center gap-2 ${
            transformMode === "normal"
              ? "bg-green-600 text-white"
              : "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
          }`}
          title="Transform Mode"
        >
          <Move3D size={16} />
          Transform
        </button>
        <button
          onClick={() => onTransformModeChange("skew")}
          className={`px-3 py-2 text-sm rounded-r transition-colors flex items-center gap-2 ${
            transformMode === "skew"
              ? "bg-green-600 text-white"
              : "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
          }`}
          title="Skew Mode"
        >
          <Scan size={16} />
          Skew
        </button>
      </div>
    </div>
  );
}
