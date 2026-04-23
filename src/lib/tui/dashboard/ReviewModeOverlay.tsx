import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPriorityList } from "@/lib/priority-list";
import { PriorityText } from "@/lib/tui/sessions/priority-text";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import type { DefaultReview, Priority } from "@/lib/types";
import { VALID_PRIORITIES as PRIORITIES } from "@/lib/types/domain";

export type ReviewModeSelection = "uncommitted" | "base" | "commit";

type ReviewModeInputMode = Exclude<ReviewModeSelection, "uncommitted">;
type ReviewModeStep = "picker" | "branch-picker" | "commit-picker" | "options";
type ReviewExecutionMode = "review-only" | "auto-all" | "auto-priority";
type OptionsFocusTarget =
  | "max-iterations"
  | "execution-mode"
  | "priority-list"
  | "custom-instructions";

interface ReviewModeOption {
  label: string;
  description: string;
  mode: ReviewModeSelection;
}

interface ReviewExecutionOption {
  label: string;
  description: string;
  mode: ReviewExecutionMode;
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

const REVIEW_EXECUTION_OPTIONS: ReviewExecutionOption[] = [
  {
    label: "Review only",
    description: "Persist findings for later selection and remediation.",
    mode: "review-only",
  },
  {
    label: "Auto-fix all",
    description: "Run remediation immediately for every persisted finding.",
    mode: "auto-all",
  },
  {
    label: "Auto-fix priorities",
    description: "Run remediation immediately for a CSV priority filter.",
    mode: "auto-priority",
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

function sortSelectedPriorities(selectedPriorities: Priority[]): Priority[] {
  return PRIORITIES.filter((priority) => selectedPriorities.includes(priority));
}

function clampPriorityCursorIndex(index: number): number {
  return Math.min(PRIORITIES.length - 1, Math.max(0, index));
}

function renderPrioritySelectionRow(priority: Priority, isSelected: boolean) {
  return (
    <>
      <span fg={isSelected ? TUI_COLORS.status.success : TUI_COLORS.text.dim}>
        {isSelected ? "◈" : "◇"}{" "}
      </span>
      <PriorityText priority={priority} />
    </>
  );
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

function cycleExecutionMode(current: ReviewExecutionMode, direction: 1 | -1): ReviewExecutionMode {
  const currentIndex = REVIEW_EXECUTION_OPTIONS.findIndex((option) => option.mode === current);
  const nextIndex = Math.min(
    REVIEW_EXECUTION_OPTIONS.length - 1,
    Math.max(0, currentIndex + direction)
  );

  return REVIEW_EXECUTION_OPTIONS[nextIndex]?.mode ?? current;
}

function getOptionsFocusOrder(
  executionMode: ReviewExecutionMode,
  showCustomInstructions: boolean
): OptionsFocusTarget[] {
  const focusOrder: OptionsFocusTarget[] = ["max-iterations", "execution-mode"];

  if (executionMode === "auto-priority") {
    focusOrder.push("priority-list");
  }

  if (showCustomInstructions) {
    focusOrder.push("custom-instructions");
  }

  return focusOrder;
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
  const [executionMode, setExecutionMode] = useState<ReviewExecutionMode>("review-only");
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [priorityCursorIndex, setPriorityCursorIndex] = useState(0);
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState("");
  const [showCustomInstructions, setShowCustomInstructions] = useState(false);
  const [optionsFocus, setOptionsFocus] = useState<OptionsFocusTarget>("max-iterations");
  const selectedPrioritiesRef = useRef<Priority[]>([]);
  const priorityCursorIndexRef = useRef(0);
  const customInstructionsRef = useRef<TextareaRenderable>(null);
  const maxIterationsInputRef = useRef<InputRenderable>(null);

  useEffect(() => {
    selectedPrioritiesRef.current = selectedPriorities;
  }, [selectedPriorities]);

  useEffect(() => {
    priorityCursorIndexRef.current = priorityCursorIndex;
  }, [priorityCursorIndex]);

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

    if (executionMode === "auto-priority" && optionsFocus === "priority-list") {
      return;
    }

    if (optionsFocus === "execution-mode") {
      return;
    }

    const input = maxIterationsInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.selectAll();
  }, [executionMode, optionsFocus, showCustomInstructions, step]);

  useEffect(() => {
    if (step !== "options") {
      return;
    }

    const focusOrder = getOptionsFocusOrder(executionMode, showCustomInstructions);
    if (!focusOrder.includes(optionsFocus)) {
      setOptionsFocus("execution-mode");
    }
  }, [executionMode, optionsFocus, showCustomInstructions, step]);

  useKeyboard((key) => {
    if (step === "options") {
      if (key.name === "tab") {
        const focusOrder = getOptionsFocusOrder(executionMode, showCustomInstructions);
        const currentIndex = focusOrder.indexOf(optionsFocus);
        const direction = key.shift ? -1 : 1;
        const nextIndex = (currentIndex + direction + focusOrder.length) % focusOrder.length;
        const nextFocus = focusOrder[nextIndex];
        if (nextFocus) {
          setOptionsFocus(nextFocus);
          setError(null);
        }
        return;
      }

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

      if (optionsFocus === "max-iterations") {
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
      }

      if (optionsFocus === "execution-mode") {
        if (key.name === "up") {
          setExecutionMode((current) => cycleExecutionMode(current, -1));
          setError(null);
          return;
        }

        if (key.name === "down") {
          setExecutionMode((current) => cycleExecutionMode(current, 1));
          setError(null);
          return;
        }
      }

      if (optionsFocus === "priority-list") {
        if (key.name === "up" || key.name === "k") {
          setPriorityCursorIndex((current) => {
            const next = clampPriorityCursorIndex(current - 1);
            priorityCursorIndexRef.current = next;
            return next;
          });
          setError(null);
          return;
        }

        if (key.name === "down" || key.name === "j") {
          setPriorityCursorIndex((current) => {
            const next = clampPriorityCursorIndex(current + 1);
            priorityCursorIndexRef.current = next;
            return next;
          });
          setError(null);
          return;
        }

        if (key.name === "space") {
          const priority = PRIORITIES[priorityCursorIndexRef.current] ?? PRIORITIES[0];
          if (!priority) {
            return;
          }

          setSelectedPriorities((current) => {
            const next = sortSelectedPriorities(
              current.includes(priority)
                ? current.filter((value) => value !== priority)
                : [...current, priority]
            );
            selectedPrioritiesRef.current = next;
            return next;
          });
          setError(null);
          return;
        }
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
    setExecutionMode("review-only");
    setSelectedPriorities([]);
    selectedPrioritiesRef.current = [];
    setPriorityCursorIndex(0);
    priorityCursorIndexRef.current = 0;
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

    let priorityList: string | undefined;
    if (executionMode === "auto-priority") {
      const currentSelectedPriorityList = formatPriorityList(
        sortSelectedPriorities(selectedPrioritiesRef.current)
      );

      if (currentSelectedPriorityList.length === 0) {
        setError("Select at least one priority for auto-fix priorities.");
        return;
      }

      priorityList = currentSelectedPriorityList;
    }

    const customInstructions = syncCustomInstructionsDraft();
    const nextArgs =
      customInstructions.trim().length > 0
        ? [...pendingArgs, customInstructions, "--max", String(parsed)]
        : [...pendingArgs, "--max", String(parsed)];

    if (executionMode !== "review-only") {
      nextArgs.push("--auto");
    }

    if (priorityList) {
      nextArgs.push("--priority", priorityList);
    }

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

  function renderExecutionModeOptions() {
    return (
      <box flexDirection="column" gap={1}>
        <text fg={TUI_COLORS.text.muted}>What should happen after review?</text>
        <box flexDirection="column">
          {REVIEW_EXECUTION_OPTIONS.map((option) => {
            const isSelected = option.mode === executionMode;
            const isFocused = optionsFocus === "execution-mode" && isSelected;

            return (
              <box key={option.mode} flexDirection="column">
                <box flexDirection="row">
                  <text fg={isFocused ? TUI_COLORS.accent.key : TUI_COLORS.text.dim}>
                    {isFocused ? "▶" : " "}
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
        {renderExecutionModeOptions()}
        {executionMode === "auto-priority" && (
          <box flexDirection="column">
            <text fg={TUI_COLORS.text.muted}>Priority filter (Space toggles):</text>
            <box flexDirection="column">
              {PRIORITIES.map((priority, index) => {
                const isSelected = selectedPriorities.includes(priority);
                const isHighlighted =
                  optionsFocus === "priority-list" && priorityCursorIndex === index;

                return (
                  <box key={priority} paddingLeft={1}>
                    <text fg={isHighlighted ? TUI_COLORS.text.primary : TUI_COLORS.text.secondary}>
                      <span fg={isHighlighted ? TUI_COLORS.accent.key : TUI_COLORS.text.dim}>
                        {isHighlighted ? "▶ " : "  "}
                      </span>
                      {renderPrioritySelectionRow(priority, isSelected)}
                    </text>
                  </box>
                );
              })}
            </box>
            <text fg={TUI_COLORS.text.muted}>Space toggles.</text>
          </box>
        )}
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
            <span fg={TUI_COLORS.accent.key}>[Tab]</span>
            <span fg={TUI_COLORS.text.muted}> Next field </span>
            <span fg={TUI_COLORS.text.dim}> </span>
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
