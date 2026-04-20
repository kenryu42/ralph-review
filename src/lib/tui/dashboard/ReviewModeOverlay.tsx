import type { TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { DefaultReview } from "@/lib/types";

export type ReviewModeSelection = "uncommitted" | "base" | "commit" | "custom";

type ReviewModeInputMode = Exclude<ReviewModeSelection, "uncommitted">;
type EditorReviewMode = Exclude<ReviewModeInputMode, "commit">;
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

type ReviewModeStep = "picker" | "branch-picker" | "commit-picker" | "editor";

interface ReviewModeOverlayProps {
  defaultReview?: DefaultReview;
  projectPath: string;
  onClose: () => void;
  onSubmit: (args: string[]) => void;
}

const REVIEW_MODE_OPTIONS: ReviewModeOption[] = [
  {
    label: "Review uncommitted changes",
    description: "Review the current working tree changes.",
    mode: "uncommitted",
  },
  {
    label: "Review against base branch",
    description: "Compare the current branch against a base branch or ref.",
    mode: "base",
  },
  {
    label: "Review a commit",
    description: "Review a specific commit SHA or ref.",
    mode: "commit",
  },
  {
    label: "Custom review instructions",
    description: "Provide custom review instructions.",
    mode: "custom",
  },
];

const REVIEW_TEXTAREA_KEY_BINDINGS: ReviewTextareaKeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "linefeed", action: "submit" },
];

const LIST_PICKER_PADDING = 1;
const LIST_PICKER_VERTICAL_OVERHEAD = LIST_PICKER_PADDING * 2 + 6;
const MAX_LIST_PICKER_SELECT_HEIGHT = 10;

interface ReviewModeEditorMeta {
  title: string;
  prompt: string;
  placeholder: string;
  emptyError: string;
  singleLineError?: string;
  runFlag: "--base" | "--commit" | "--custom";
}

const REVIEW_MODE_EDITOR_META: Record<ReviewModeInputMode, ReviewModeEditorMeta> = {
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

interface GitBranchData {
  currentBranch: string | null;
  branches: string[];
}

interface GitCommit {
  shortSha: string;
  subject: string;
}

function getGitBranches(projectPath: string): GitBranchData {
  try {
    const currentResult = Bun.spawnSync(["git", "branch", "--show-current"], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const currentBranch =
      currentResult.exitCode === 0 ? currentResult.stdout.toString().trim() : "";

    const branchesResult = Bun.spawnSync(["git", "branch", "--format=%(refname:short)"], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (branchesResult.exitCode !== 0) {
      return {
        currentBranch: currentBranch || null,
        branches: [],
      };
    }

    return {
      currentBranch: currentBranch || null,
      branches: branchesResult.stdout
        .toString()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== currentBranch)
        .sort((a, b) => a.localeCompare(b)),
    };
  } catch {
    return {
      currentBranch: null,
      branches: [],
    };
  }
}

function getGitCommits(projectPath: string): GitCommit[] {
  try {
    const commitsResult = Bun.spawnSync(
      ["git", "log", "--no-color", "--pretty=format:%h%x09%s", "HEAD"],
      {
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    if (commitsResult.exitCode !== 0) {
      return [];
    }

    return commitsResult.stdout
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const separatorIndex = line.indexOf("\t");
        if (separatorIndex <= 0) {
          return [];
        }

        const shortSha = line.slice(0, separatorIndex).trim();
        const subject = line.slice(separatorIndex + 1).trim();
        if (shortSha.length === 0) {
          return [];
        }

        return [
          {
            shortSha,
            subject,
          },
        ];
      });
  } catch {
    return [];
  }
}

export function ReviewModeOverlay({
  defaultReview,
  projectPath,
  onClose,
  onSubmit,
}: ReviewModeOverlayProps) {
  const { height: terminalHeight } = useTerminalDimensions();
  const [selectedMode, setSelectedMode] = useState<ReviewModeSelection>(
    getInitialReviewMode(defaultReview)
  );
  const [drafts, setDrafts] = useState<ReviewModeDrafts>(() => createInitialDrafts(defaultReview));
  const [step, setStep] = useState<ReviewModeStep>("picker");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<TextareaRenderable>(null);

  const editorMode =
    step === "editor" && selectedMode !== "uncommitted" && selectedMode !== "commit"
      ? selectedMode
      : null;

  const branchPickerData = useMemo(() => {
    const branchData = getGitBranches(projectPath);
    const description = branchData.currentBranch
      ? `Current: ${branchData.currentBranch}`
      : "Current repo branch";

    return {
      ...branchData,
      options: branchData.branches.map((name) => ({
        name,
        description,
        value: name,
      })),
    };
  }, [projectPath]);
  const branchOptions = branchPickerData.options;

  const commitOptions = useMemo(
    () =>
      getGitCommits(projectPath).map((commit) => ({
        name: commit.subject || commit.shortSha,
        description: commit.shortSha,
        value: commit.shortSha,
      })),
    [projectPath]
  );

  const pickerSelectHeight = Math.max(
    1,
    Math.min(MAX_LIST_PICKER_SELECT_HEIGHT, terminalHeight - LIST_PICKER_VERTICAL_OVERHEAD)
  );
  const pickerOverlayHeight = pickerSelectHeight + LIST_PICKER_VERTICAL_OVERHEAD;

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

    if (step === "branch-picker" || step === "commit-picker") {
      if (key.name === "escape") {
        setError(null);
        setStep("picker");
        return;
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

      if (selectedMode === "base") {
        openBranchPicker();
        return;
      }

      if (selectedMode === "commit") {
        openCommitPicker();
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

  function openBranchPicker() {
    setError(null);
    setStep("branch-picker");
  }

  function openCommitPicker() {
    setError(null);
    setStep("commit-picker");
  }

  function returnToPicker() {
    if (editorMode) {
      syncEditorDraft(editorMode);
    }
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

  function renderBranchPicker() {
    if (branchOptions.length === 0) {
      return (
        <box flexDirection="column" gap={1}>
          <text fg={TUI_COLORS.text.muted}>No alternate branches available.</text>
          <text fg={TUI_COLORS.text.dim}>
            {branchPickerData.currentBranch
              ? `Current repo branch: ${branchPickerData.currentBranch}`
              : "Current repo branch could not be determined."}
          </text>
          {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
          <text>
            <span fg={TUI_COLORS.accent.key}>[Esc]</span>
            <span fg={TUI_COLORS.text.muted}> Back</span>
          </text>
        </box>
      );
    }

    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>Select a base branch to compare against.</text>
        <select
          focused
          options={branchOptions}
          height={pickerSelectHeight}
          showScrollIndicator
          onSelect={(_index, option) => {
            if (!option) {
              return;
            }
            submitSelectedMode("base", option.value as string);
          }}
        />
        {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
        <text>
          <span fg={TUI_COLORS.accent.key}>[Enter]</span>
          <span fg={TUI_COLORS.text.muted}> Select</span>
          <span fg={TUI_COLORS.text.dim}> </span>
          <span fg={TUI_COLORS.accent.key}>[Esc]</span>
          <span fg={TUI_COLORS.text.muted}> Back</span>
        </text>
      </box>
    );
  }

  function renderCommitPicker() {
    if (commitOptions.length === 0) {
      return (
        <box flexDirection="column" gap={1}>
          <text fg={TUI_COLORS.text.muted}>No commits available.</text>
          <text fg={TUI_COLORS.text.dim}>Commit history could not be determined.</text>
          {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
          <text>
            <span fg={TUI_COLORS.accent.key}>[Esc]</span>
            <span fg={TUI_COLORS.text.muted}> Back</span>
          </text>
        </box>
      );
    }

    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>Select a commit to review.</text>
        <select
          focused
          options={commitOptions}
          height={pickerSelectHeight}
          showScrollIndicator
          onSelect={(_index, option) => {
            if (!option) {
              return;
            }
            submitSelectedMode("commit", option.value as string);
          }}
        />
        {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
        <text>
          <span fg={TUI_COLORS.accent.key}>[Enter]</span>
          <span fg={TUI_COLORS.text.muted}> Select</span>
          <span fg={TUI_COLORS.text.dim}> </span>
          <span fg={TUI_COLORS.accent.key}>[Esc]</span>
          <span fg={TUI_COLORS.text.muted}> Back</span>
        </text>
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

  const isPickerStep = step === "branch-picker" || step === "commit-picker";
  const overlayWidth = step === "commit-picker" ? 90 : 74;

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
        title={
          editorMode
            ? REVIEW_MODE_EDITOR_META[editorMode].title
            : step === "branch-picker"
              ? REVIEW_MODE_EDITOR_META.base.title
              : step === "commit-picker"
                ? "Target Commit"
                : "Review Mode"
        }
        titleAlignment="left"
        padding={isPickerStep ? LIST_PICKER_PADDING : 2}
        width={overlayWidth}
        height={isPickerStep ? pickerOverlayHeight : "auto"}
        backgroundColor="#1a1a2e"
        flexDirection="column"
      >
        {editorMode
          ? renderEditor(editorMode)
          : step === "branch-picker"
            ? renderBranchPicker()
            : step === "commit-picker"
              ? renderCommitPicker()
              : renderPicker()}
      </box>
    </box>
  );
}
