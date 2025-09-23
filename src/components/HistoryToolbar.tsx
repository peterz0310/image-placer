"use client";

import { Undo2, Redo2, History } from "lucide-react";

interface HistoryToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  historyInfo: {
    currentIndex: number;
    totalStates: number;
    undoDescription: string | null;
    redoDescription: string | null;
  };
}

export default function HistoryToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  historyInfo,
}: HistoryToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg border border-gray-700">
      {/* History indicator */}
      <div className="flex items-center gap-2 text-gray-300">
        <History size={16} />
        <span className="text-xs">
          {historyInfo.currentIndex + 1}/{historyInfo.totalStates}
        </span>
      </div>

      <div className="w-px h-6 bg-gray-600"></div>

      {/* Undo button */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors ${
          canUndo
            ? "bg-blue-600 hover:bg-blue-700 text-white"
            : "bg-gray-700 text-gray-500 cursor-not-allowed"
        }`}
        title={
          canUndo ? `Undo: ${historyInfo.undoDescription}` : "Nothing to undo"
        }
      >
        <Undo2 size={14} />
        <span className="hidden sm:inline">Undo</span>
        <span className="text-xs text-gray-300 ml-1">
          {navigator.userAgent.includes("Mac") ? "⌘Z" : "Ctrl+Z"}
        </span>
      </button>

      {/* Redo button */}
      <button
        onClick={onRedo}
        disabled={!canRedo}
        className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors ${
          canRedo
            ? "bg-green-600 hover:bg-green-700 text-white"
            : "bg-gray-700 text-gray-500 cursor-not-allowed"
        }`}
        title={
          canRedo ? `Redo: ${historyInfo.redoDescription}` : "Nothing to redo"
        }
      >
        <Redo2 size={14} />
        <span className="hidden sm:inline">Redo</span>
        <span className="text-xs text-gray-300 ml-1">
          {navigator.userAgent.includes("Mac") ? "⌘⇧Z" : "Ctrl+Y"}
        </span>
      </button>
    </div>
  );
}
