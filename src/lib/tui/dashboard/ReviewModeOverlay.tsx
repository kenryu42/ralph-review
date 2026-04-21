import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { DefaultReview } from "@/lib/types";

export type ReviewModeSelection = "uncommitted" | "base" | "commit";

type ReviewModeInputMode = Exclude<ReviewModeSelection, "uncommitted">;
type ReviewModeStep = "picker" | "branch-picker" | "commit-picker" | "options";
type OptionsFocusTarget = "max-iterations" | "custom-instructions";

interface ReviewModeOption {
  label: string;
  description: string;
  mode: ReviewModeSelection;
}

const DEFAULT_MAX_ITERATIONS = 5;
const MIN_MAX_ITERATIONS = 1;
const MAX_MAX_ITERATIONS = 999;
const CUSTOM_INSTRUCTIONS_PLACEHOLDER =
  "Focus on security boundaries, migrations, and error handling...";

interface ReviewModeOverlayProps {
  defaultReview?: DefaultReview;
  defaultMaxIterations?: number;
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
];

const LIST_PICKER_PADDING = 1;
const LIST_PICKER_VERTICAL_OVERHEAD = LIST_PICKER_PADDING * 2 + 6;
const MAX_LIST_PICKER_SELECT_HEIGHT = 10;

interface ReviewModeMeta {
  title: string;
  emptyError: string;
  singleLineError?: string;
  runFlag: "--base" | "--commit";
}

const REVIEW_MODE_META: Record<ReviewModeInputMode, ReviewModeMeta> = {
  base: {
    title: "Against Base Branch",
    emptyError: "Base branch is required.",
    singleLineError: "Base branch must be a single line.",
    runFlag: "--base",
  },
  commit: {
    title: "Target Commit",
    emptyError: "Target commit is required.",
    singleLineError: "Target commit must be a single line.",
    runFlag: "--commit",
  },
};

function getInitialReviewMode(defaultReview?: DefaultReview): ReviewModeSelection {
  if (defaultReview?.type === "base") {
    return "base";
  }
  return "uncommitted";
}

export function buildReviewRunArgs(mode: ReviewModeSelection, value?: string): string[] {
  if (mode === "uncommitted") {
    return ["--uncommitted"];
  }

  const metadata = REVIEW_MODE_META[mode];
  const rawValue = value ?? "";
  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0) {
    throw new Error(metadata.emptyError);
  }

  if (metadata.singleLineError && /[\r\n]/.test(trimmedValue)) {
    throw new Error(metadata.singleLineError);
  }

  return [metadata.runFlag, trimmedValue];
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

function clampMaxIterations(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_ITERATIONS;
  }
  return Math.min(MAX_MAX_ITERATIONS, Math.max(MIN_MAX_ITERATIONS, Math.trunc(value)));
}

export function ReviewModeOverlay({
  defaultReview,
  defaultMaxIterations,
  projectPath,
  onClose,
  onSubmit,
}: ReviewModeOverlayProps) {
  const { height: terminalHeight } = useTerminalDimensions();
  const initialMaxIterations = clampMaxIterations(defaultMaxIterations ?? DEFAULT_MAX_ITERATIONS);
  const [selectedMode, setSelectedMode] = useState<ReviewModeSelection>(
    getInitialReviewMode(defaultReview)
  );
  const [step, setStep] = useState<ReviewModeStep>("picker");
  const [error, setError] = useState<string | null>(null);
  const [pendingArgs, setPendingArgs] = useState<string[] | null>(null);
  const [previousStep, setPreviousStep] = useState<ReviewModeStep>("picker");
  const [maxIterationsDraft, setMaxIterationsDraft] = useState<string>(
    String(initialMaxIterations)
  );
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState("");
  const [showCustomInstructions, setShowCustomInstructions] = useState(false);
  const [optionsFocus, setOptionsFocus] = useState<OptionsFocusTarget>("max-iterations");
  const customInstructionsRef = useRef<TextareaRenderable>(null);
  const maxIterationsInputRef = useRef<InputRenderable>(null);

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

  useEffect(() => {
    if (step !== "options") {
      return;
    }

    if (showCustomInstructions && optionsFocus === "custom-instructions") {
      customInstructionsRef.current?.focus();
      return;
    }

    const input = maxIterationsInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.selectAll();
  }, [optionsFocus, showCustomInstructions, step]);

  useKeyboard((key) => {
    if (step === "options") {
      if (showCustomInstructions && optionsFocus === "custom-instructions") {
        if (key.name === "escape") {
          hideCustomInstructions();
        }
        return;
      }

      if (key.name === "c") {
        openCustomInstructions();
        return;
      }

      if (key.name === "escape") {
        setError(null);
        setPendingArgs(null);
        setStep(previousStep);
        return;
      }

      if (key.name === "up") {
        const current = parseInt(maxIterationsDraft, 10);
        const base = Number.isFinite(current) ? current : initialMaxIterations - 1;
        setMaxIterationsDraft(String(clampMaxIterations(base + 1)));
        setError(null);
        return;
      }

      if (key.name === "down") {
        const current = parseInt(maxIterationsDraft, 10);
        const base = Number.isFinite(current) ? current : initialMaxIterations + 1;
        setMaxIterationsDraft(String(clampMaxIterations(base - 1)));
        setError(null);
        return;
      }

      if (key.name === "enter" || key.name === "return") {
        submitWithOptions();
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

      openCommitPicker();
    }
  });

  function syncCustomInstructionsDraft(): string {
    const nextValue = customInstructionsRef.current?.plainText ?? customInstructionsDraft;
    setCustomInstructionsDraft(nextValue);
    return nextValue;
  }

  function submitSelectedMode(mode: ReviewModeSelection, value?: string) {
    try {
      setError(null);
      const args = buildReviewRunArgs(mode, value);
      goToOptions(args);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  }

  function goToOptions(args: string[]) {
    setPendingArgs(args);
    setPreviousStep(step);
    setMaxIterationsDraft(String(initialMaxIterations));
    setShowCustomInstructions(false);
    setOptionsFocus("max-iterations");
    setError(null);
    setStep("options");
  }

  function submitWithOptions() {
    const raw = maxIterationsDraft;
    const parsed = parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < MIN_MAX_ITERATIONS) {
      setError(`Max iterations must be an integer greater than or equal to ${MIN_MAX_ITERATIONS}.`);
      return;
    }
    if (parsed > MAX_MAX_ITERATIONS) {
      setError(`Max iterations must be ${MAX_MAX_ITERATIONS} or fewer.`);
      return;
    }
    if (!pendingArgs) {
      setError("Review mode is missing.");
      return;
    }

    const customInstructions = syncCustomInstructionsDraft();
    const nextArgs =
      customInstructions.trim().length > 0
        ? [...pendingArgs, customInstructions, "--max", String(parsed)]
        : [...pendingArgs, "--max", String(parsed)];

    setError(null);
    onSubmit(nextArgs);
  }

  function openCustomInstructions() {
    setShowCustomInstructions(true);
    setOptionsFocus("custom-instructions");
    setError(null);
  }

  function hideCustomInstructions() {
    syncCustomInstructionsDraft();
    setShowCustomInstructions(false);
    setOptionsFocus("max-iterations");
    setError(null);
  }

  function openBranchPicker() {
    setError(null);
    setStep("branch-picker");
  }

  function openCommitPicker() {
    setError(null);
    setStep("commit-picker");
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

  function renderCustomInstructionsHelper() {
    if (showCustomInstructions) {
      return (
        <text>
          <span fg={TUI_COLORS.accent.key}>[Esc]</span>
          <span fg={TUI_COLORS.text.muted}> Hide custom instructions</span>
        </text>
      );
    }

    if (customInstructionsDraft.trim().length > 0) {
      return (
        <text fg={TUI_COLORS.text.muted}>
          Custom instruction set. <span fg={TUI_COLORS.accent.key}>[c]</span>
          <span fg={TUI_COLORS.text.muted}> Edit</span>
        </text>
      );
    }

    return (
      <text>
        <span fg={TUI_COLORS.accent.key}>[c]</span>
        <span fg={TUI_COLORS.text.muted}> Custom Instruction</span>
      </text>
    );
  }

  function renderOptions() {
    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>
          How many review iterations at most? (default {initialMaxIterations})
        </text>
        <input
          ref={maxIterationsInputRef}
          focused={optionsFocus === "max-iterations"}
          value={maxIterationsDraft}
          placeholder={String(initialMaxIterations)}
          width={12}
          backgroundColor="#101425"
          focusedBackgroundColor="#101425"
          onInput={(next) => {
            if (next === "" || /^\d+$/.test(next)) {
              setMaxIterationsDraft(next);
              setError(null);
              return;
            }
            const input = maxIterationsInputRef.current;
            if (input) {
              input.value = maxIterationsDraft;
            }
          }}
        />
        {showCustomInstructions && (
          <>
            <text fg={TUI_COLORS.text.muted}>Custom review instructions (optional).</text>
            <textarea
              ref={customInstructionsRef}
              focused={optionsFocus === "custom-instructions"}
              initialValue={customInstructionsDraft}
              placeholder={CUSTOM_INSTRUCTIONS_PLACEHOLDER}
              width={68}
              height={7}
              wrapMode="word"
              backgroundColor="#101425"
              focusedBackgroundColor="#101425"
              onContentChange={() => {
                syncCustomInstructionsDraft();
              }}
            />
          </>
        )}
        {error && <text fg={TUI_COLORS.status.error}>{error}</text>}
        {renderCustomInstructionsHelper()}
        {!showCustomInstructions && (
          <text>
            <span fg={TUI_COLORS.accent.key}>[Enter]</span>
            <span fg={TUI_COLORS.text.muted}> Start review </span>
          </text>
        )}
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
          step === "options"
            ? "Options"
            : step === "branch-picker"
              ? REVIEW_MODE_META.base.title
              : step === "commit-picker"
                ? REVIEW_MODE_META.commit.title
                : "Review Mode"
        }
        titleAlignment="left"
        padding={isPickerStep ? LIST_PICKER_PADDING : 2}
        width={overlayWidth}
        height={isPickerStep ? pickerOverlayHeight : "auto"}
        backgroundColor="#1a1a2e"
        flexDirection="column"
      >
        {step === "options"
          ? renderOptions()
          : step === "branch-picker"
            ? renderBranchPicker()
            : step === "commit-picker"
              ? renderCommitPicker()
              : renderPicker()}
      </box>
    </box>
  );
}
