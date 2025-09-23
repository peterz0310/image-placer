"use client";

import { MousePointer2, Maximize, Circle, Scissors } from "lucide-react";

interface FloatingToolbarProps {
  tool: "select" | "mask";
  transformMode: "normal" | "skew";
  onToolChange: (tool: "select" | "mask") => void;
  onTransformModeChange: (mode: "normal" | "skew") => void;
}

export default function FloatingToolbar({
  tool,
  transformMode,
  onToolChange,
  onTransformModeChange,
}: FloatingToolbarProps) {
  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white shadow-lg rounded-lg border p-2 flex gap-2">
      {/* Tool Selection */}
      <div className="flex bg-gray-100 rounded">
        <button
          onClick={() => onToolChange("select")}
          className={`px-3 py-2 text-sm rounded-l transition-colors flex items-center gap-2 ${
            tool === "select"
              ? "bg-blue-600 text-white"
              : "text-gray-700 hover:text-gray-900 hover:bg-gray-200"
          }`}
          title="Select Tool"
        >
          <MousePointer2 size={16} />
          Select
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
          <Circle size={16} />
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
          <Maximize size={16} />
          Skew
        </button>
      </div>
    </div>
  );
}
