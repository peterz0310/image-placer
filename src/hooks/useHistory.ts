import { useState, useCallback, useRef, useEffect } from "react";
import { Project } from "@/types";

interface HistoryState {
  project: Project | null;
  timestamp: number;
  description: string;
}

interface UseHistoryReturn {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  saveState: (project: Project | null, description?: string) => void;
  clearHistory: () => void;
  getHistoryInfo: () => {
    currentIndex: number;
    totalStates: number;
    undoDescription: string | null;
    redoDescription: string | null;
  };
}

const MAX_HISTORY_SIZE = 50;

export function useHistory(): UseHistoryReturn {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const lastSaveTimeRef = useRef(0);

  // Debounce saves to avoid excessive history entries during rapid changes
  const DEBOUNCE_MS = 500;

  const saveState = useCallback(
    (project: Project | null, description = "Change") => {
      const now = Date.now();

      // Debounce rapid saves (except for specific actions like adding/removing layers)
      if (
        now - lastSaveTimeRef.current < DEBOUNCE_MS &&
        !description.includes("Add") &&
        !description.includes("Remove") &&
        !description.includes("Delete")
      ) {
        return;
      }

      lastSaveTimeRef.current = now;

      setHistory((prev) => {
        // Create deep copy of project to ensure immutability
        const projectCopy = project
          ? JSON.parse(JSON.stringify(project))
          : null;

        const newState: HistoryState = {
          project: projectCopy,
          timestamp: now,
          description,
        };

        // Remove any states after current index (if we're not at the end)
        const newHistory = prev.slice(0, currentIndex + 1);

        // Add new state
        newHistory.push(newState);

        // Limit history size
        if (newHistory.length > MAX_HISTORY_SIZE) {
          newHistory.shift();
          setCurrentIndex((prev) => Math.max(0, prev));
          return newHistory;
        }

        setCurrentIndex(newHistory.length - 1);
        return newHistory;
      });
    },
    [currentIndex]
  );

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const redo = useCallback(() => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, history.length]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
    lastSaveTimeRef.current = 0;
  }, []);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const getHistoryInfo = useCallback(() => {
    const undoState = canUndo ? history[currentIndex - 1] : null;
    const redoState = canRedo ? history[currentIndex + 1] : null;

    return {
      currentIndex,
      totalStates: history.length,
      undoDescription: undoState ? undoState.description : null,
      redoDescription: redoState ? redoState.description : null,
    };
  }, [currentIndex, history, canUndo, canRedo]);

  // Return current project state from history
  const getCurrentProject = useCallback((): Project | null => {
    if (currentIndex >= 0 && currentIndex < history.length) {
      return history[currentIndex].project;
    }
    return null;
  }, [currentIndex, history]);

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    saveState,
    clearHistory,
    getHistoryInfo,
    getCurrentProject: getCurrentProject as () => Project | null,
  } as UseHistoryReturn & { getCurrentProject: () => Project | null };
}

// Hook for keyboard shortcuts
export function useHistoryKeyboard(
  undo: () => void,
  redo: () => void,
  canUndo: boolean,
  canRedo: boolean
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      const isUndo =
        (event.metaKey || event.ctrlKey) &&
        event.key === "z" &&
        !event.shiftKey;
      // Check for Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (Windows/Linux) or Ctrl+Y
      const isRedo =
        ((event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key === "z") ||
        ((event.metaKey || event.ctrlKey) && event.key === "y");

      if (isUndo && canUndo) {
        event.preventDefault();
        undo();
      } else if (isRedo && canRedo) {
        event.preventDefault();
        redo();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, canUndo, canRedo]);
}
