import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { TUI_COLORS } from "@/lib/tui/colors";
import type { DefaultReview } from "@/lib/types";

export type ReviewModeSelection = "uncommitted" | "base" | "commit" | "custom";

type EditorReviewMode = Exclude<ReviewModeSelection, "uncommitted">;
type ReviewModeDrafts = Record<EditorReviewMode, string>;

interface ReviewModeOption {
  label: string;
  description: string;
  mode: ReviewModeSelection;
}

type ReviewTextareaKeyBinding = {
  name: string;
  action: "submit";
};

interface ReviewModeOverlayProps {
  defaultReview?: DefaultReview;
  onClose: () => void;
  onSubmit: (args: string[]) => void;
}

const REVIEW_MODE_OPTIONS: ReviewModeOption[] = [
  {
    label: "Uncommitted changes",
    description: "Review the current working tree changes.",
    mode: "uncommitted",
  },
  {
    label: "Against base branch",
    description: "Compare the current branch against a base branch or ref.",
    mode: "base",
  },
  {
    label: "Target commit",
    description: "Review a specific commit SHA or ref.",
    mode: "commit",
  },
  {
    label: "Custom",
    description: "Provide custom review instructions.",
    mode: "custom",
  },
];

const REVIEW_TEXTAREA_KEY_BINDINGS: ReviewTextareaKeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "linefeed", action: "submit" },
];

function getInitialReviewMode(defaultReview?: DefaultReview): ReviewModeSelection {
  if (defaultReview?.type === "base") {
    return "base";
  }
  return "uncommitted";
}

function createInitialDrafts(defaultReview?: DefaultReview): ReviewModeDrafts {
  return {
    base: defaultReview?.type === "base" ? defaultReview.branch : "",
    commit: "",
    custom: "",
  };
}

function getEditorTitle(mode: EditorReviewMode): string {
  switch (mode) {
    case "base":
      return "Against Base Branch";
    case "commit":
      return "Target Commit";
    case "custom":
      return "Custom Review";
  }
}

function getEditorPrompt(mode: EditorReviewMode): string {
  switch (mode) {
    case "base":
      return "Enter the base branch or ref to compare against.";
    case "commit":
      return "Enter the commit SHA or ref to review.";
    case "custom":
      return "Enter the custom review instructions.";
  }
}

function getEditorPlaceholder(mode: EditorReviewMode): string {
  switch (mode) {
    case "base":
      return "origin/main";
    case "commit":
      return "abc1234";
    case "custom":
      return "Focus on security boundaries, migrations, and error handling...";
  }
}

export function buildReviewRunArgs(mode: ReviewModeSelection, value?: string): string[] {
  if (mode === "uncommitted") {
    return ["--uncommitted"];
  }

  const rawValue = value ?? "";
  const trimmedValue = rawValue.trim();

  if (mode === "custom") {
    if (trimmedValue.length === 0) {
      throw new Error("Custom review instructions are required.");
    }
    return ["--custom", rawValue];
  }

  if (trimmedValue.length === 0) {
    throw new Error(mode === "base" ? "Base branch is required." : "Target commit is required.");
  }

  if (/[\r\n]/.test(trimmedValue)) {
    throw new Error(
      mode === "base"
        ? "Base branch must be a single line."
        : "Target commit must be a single line."
    );
  }

  return mode === "base" ? ["--base", trimmedValue] : ["--commit", trimmedValue];
}

export function ReviewModeOverlay({ defaultReview, onClose, onSubmit }: ReviewModeOverlayProps) {
  const [selectedMode, setSelectedMode] = useState<ReviewModeSelection>(
    getInitialReviewMode(defaultReview)
  );
  const [drafts, setDrafts] = useState<ReviewModeDrafts>(() => createInitialDrafts(defaultReview));
  const [step, setStep] = useState<"picker" | "editor">("picker");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<TextareaRenderable>(null);

  const editorMode = step === "editor" && selectedMode !== "uncommitted" ? selectedMode : null;

  useKeyboard((key) => {
    if (step === "editor" && editorMode) {
      if (key.name === "escape") {
        returnToPicker();
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        const nextValue = syncEditorDraft(editorMode);
        submitSelectedMode(editorMode, nextValue);
      }
      return;
    }

    if (step !== "picker") {
      return;
    }

    if (key.name === "escape" || key.name === "q") {
      onClose();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      const currentIndex = REVIEW_MODE_OPTIONS.findIndex((option) => option.mode === selectedMode);
      const nextMode = REVIEW_MODE_OPTIONS[Math.max(0, currentIndex - 1)]?.mode;
      if (nextMode) {
        setSelectedMode(nextMode);
        setError(null);
      }
      return;
    }

    if (key.name === "down" || key.name === "j") {
      const currentIndex = REVIEW_MODE_OPTIONS.findIndex((option) => option.mode === selectedMode);
      const nextMode =
        REVIEW_MODE_OPTIONS[Math.min(REVIEW_MODE_OPTIONS.length - 1, currentIndex + 1)]?.mode;
      if (nextMode) {
        setSelectedMode(nextMode);
        setError(null);
      }
      return;
    }

    if (key.name === "enter" || key.name === "return") {
      if (selectedMode === "uncommitted") {
        submitSelectedMode(selectedMode);
        return;
      }

      openEditor(selectedMode);
    }
  });

  function updateDraft(mode: EditorReviewMode, nextValue: string) {
    setDrafts((current) => ({
      ...current,
      [mode]: nextValue,
    }));
  }

  function syncEditorDraft(mode: EditorReviewMode): string {
    const nextValue = textareaRef.current?.plainText ?? drafts[mode];
    updateDraft(mode, nextValue);
    return nextValue;
  }

  function submitSelectedMode(mode: ReviewModeSelection, value?: string) {
    try {
      setError(null);
      onSubmit(buildReviewRunArgs(mode, value));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  }

  function openEditor(mode: EditorReviewMode) {
    setSelectedMode(mode);
    setError(null);
    setStep("editor");
  }

  function returnToPicker() {
    if (!editorMode) {
      return;
    }
    syncEditorDraft(editorMode);
    setError(null);
    setStep("picker");
  }

  function renderPicker() {
    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>Choose the review mode for the next run.</text>
        <box flexDirection="column">
          {REVIEW_MODE_OPTIONS.map((option) => {
            const isSelected = option.mode === selectedMode;

            return (
              <box key={option.mode} flexDirection="column">
                <box flexDirection="row">
                  <text fg={isSelected ? TUI_COLORS.accent.key : TUI_COLORS.text.dim}>
                    {isSelected ? "▶" : " "}
                  </text>
                  <text fg={isSelected ? TUI_COLORS.text.primary : TUI_COLORS.text.secondary}>
                    {" "}
                    {option.label}
                  </text>
                </box>
                <text fg={TUI_COLORS.text.dim} paddingLeft={2}>
                  {option.description}
                </text>
              </box>
            );
          })}
        </box>
      </box>
    );
  }

  function renderEditor(mode: EditorReviewMode) {
    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>{getEditorPrompt(mode)}</text>
        <textarea
          ref={textareaRef}
          focused
          key={mode}
          initialValue={drafts[mode]}
          placeholder={getEditorPlaceholder(mode)}
          keyBindings={REVIEW_TEXTAREA_KEY_BINDINGS}
          width={68}
          height={7}
          wrapMode="word"
          backgroundColor="#101425"
          focusedBackgroundColor="#101425"
          onContentChange={() => {
            if (!editorMode) {
              return;
            }
            updateDraft(editorMode, textareaRef.current?.plainText ?? drafts[editorMode]);
          }}
        />
        {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
        <text>
          <span fg={TUI_COLORS.accent.key}>[Enter]</span>
          <span fg={TUI_COLORS.text.muted}> Confirm</span>
        </text>
      </box>
    );
  }

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderStyle="double"
        title={editorMode ? getEditorTitle(editorMode) : "Review Mode"}
        titleAlignment="left"
        padding={2}
        width={74}
        backgroundColor="#1a1a2e"
      >
        {editorMode ? renderEditor(editorMode) : renderPicker()}
      </box>
    </box>
  );
}
