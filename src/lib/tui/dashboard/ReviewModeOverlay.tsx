import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
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

interface ReviewModeEditorMeta {
  title: string;
  prompt: string;
  placeholder: string;
  emptyError: string;
  singleLineError?: string;
  runFlag: "--base" | "--commit" | "--custom";
}

const REVIEW_MODE_EDITOR_META: Record<EditorReviewMode, ReviewModeEditorMeta> = {
  base: {
    title: "Against Base Branch",
    prompt: "Enter the base branch or ref to compare against.",
    placeholder: "origin/main",
    emptyError: "Base branch is required.",
    singleLineError: "Base branch must be a single line.",
    runFlag: "--base",
  },
  commit: {
    title: "Target Commit",
    prompt: "Enter the commit SHA or ref to review.",
    placeholder: "abc1234",
    emptyError: "Target commit is required.",
    singleLineError: "Target commit must be a single line.",
    runFlag: "--commit",
  },
  custom: {
    title: "Custom Review",
    prompt: "Enter the custom review instructions.",
    placeholder: "Focus on security boundaries, migrations, and error handling...",
    emptyError: "Custom review instructions are required.",
    runFlag: "--custom",
  },
};

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

export function buildReviewRunArgs(mode: ReviewModeSelection, value?: string): string[] {
  if (mode === "uncommitted") {
    return ["--uncommitted"];
  }

  const metadata = REVIEW_MODE_EDITOR_META[mode];
  const rawValue = value ?? "";
  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0) {
    throw new Error(metadata.emptyError);
  }

  if (metadata.singleLineError && /[\r\n]/.test(trimmedValue)) {
    throw new Error(metadata.singleLineError);
  }

  return metadata.runFlag === "--custom"
    ? [metadata.runFlag, rawValue]
    : [metadata.runFlag, trimmedValue];
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
        <text fg={TUI_COLORS.text.muted}>Choose the review mode.</text>
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
    const metadata = REVIEW_MODE_EDITOR_META[mode];
    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>{metadata.prompt}</text>
        <textarea
          ref={textareaRef}
          focused
          key={mode}
          initialValue={drafts[mode]}
          placeholder={metadata.placeholder}
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
        title={editorMode ? REVIEW_MODE_EDITOR_META[editorMode].title : "Review Mode"}
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
