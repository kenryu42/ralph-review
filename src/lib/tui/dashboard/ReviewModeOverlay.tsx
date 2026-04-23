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
type OptionsFocusTarget = "max-iterations" | "execution-mode" | "custom-instructions";

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
const OPTIONS_WIDE_MIN_WIDTH = 96;
const OPTIONS_WIDE_MIN_HEIGHT = 28;
const OPTIONS_WIDE_OVERLAY_WIDTH = 118;
const OPTIONS_COMPACT_OVERLAY_WIDTH = 90;

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

function getReviewTargetSummary(pendingArgs: string[] | null): string {
  if (!pendingArgs || pendingArgs.length === 0) {
    return "Unknown";
  }

  const [flag, value] = pendingArgs;
  if (flag === "--uncommitted") {
    return "Uncommitted";
  }

  if (flag === "--base") {
    return `Base: ${value ?? "?"}`;
  }

  if (flag === "--commit") {
    return `Commit: ${value ?? "?"}`;
  }

  return "Unknown";
}

function getExecutionSummary(
  executionMode: ReviewExecutionMode,
  selectedPriorityList: string | null
): string {
  if (executionMode === "review-only") {
    return "Review only";
  }

  if (executionMode === "auto-all") {
    return "Auto-fix all";
  }

  return selectedPriorityList
    ? `Auto-fix priorities · ${selectedPriorityList}`
    : "Auto-fix priorities";
}

const PREVIEW_CUSTOM_INSTRUCTIONS_TOKEN = "<custom instructions>";

function buildReviewCommandPreview(options: {
  pendingArgs: string[] | null;
  maxIterationsDraft: string;
  executionMode: ReviewExecutionMode;
  selectedPriorityList: string | null;
  customInstructionsDraft: string;
}): string {
  const parts = ["rr", "run"];
  if (options.pendingArgs) {
    parts.push(...options.pendingArgs);
  }

  if (options.customInstructionsDraft.trim().length > 0) {
    parts.push(PREVIEW_CUSTOM_INSTRUCTIONS_TOKEN);
  }

  const maxIterations =
    options.maxIterationsDraft.trim().length > 0 ? options.maxIterationsDraft.trim() : "<max>";
  parts.push("--max", maxIterations);

  if (options.executionMode !== "review-only") {
    parts.push("--auto");
  }

  if (options.executionMode === "auto-priority") {
    parts.push("--priority", options.selectedPriorityList ?? "<priorities>");
  }

  return parts.join(" ");
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

function getOptionsFocusOrder(showCustomInstructions: boolean): OptionsFocusTarget[] {
  const focusOrder: OptionsFocusTarget[] = ["max-iterations", "execution-mode"];

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
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
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

  const orderedSelectedPriorities = useMemo(
    () => sortSelectedPriorities(selectedPriorities),
    [selectedPriorities]
  );
  const selectedPriorityList =
    orderedSelectedPriorities.length > 0 ? formatPriorityList(orderedSelectedPriorities) : null;
  const commandPreview = buildReviewCommandPreview({
    pendingArgs,
    maxIterationsDraft,
    executionMode,
    selectedPriorityList,
    customInstructionsDraft,
  });

  const isWideOptionsLayout =
    step === "options" &&
    terminalWidth >= OPTIONS_WIDE_MIN_WIDTH &&
    terminalHeight >= OPTIONS_WIDE_MIN_HEIGHT;
  const targetSummary = getReviewTargetSummary(pendingArgs);
  const executionSummary = getExecutionSummary(executionMode, selectedPriorityList);
  const customInstructionsStatus = customInstructionsDraft.trim().length > 0 ? "Set" : "Not set";
  const isCustomInstructionsFocused =
    showCustomInstructions && optionsFocus === "custom-instructions";
  const optionsStatusColor = error ? TUI_COLORS.status.error : TUI_COLORS.text.muted;
  const optionsOverlayWidth = isWideOptionsLayout
    ? Math.min(OPTIONS_WIDE_OVERLAY_WIDTH, Math.max(96, terminalWidth - 4))
    : Math.min(OPTIONS_COMPACT_OVERLAY_WIDTH, Math.max(78, terminalWidth - 4));
  const configurationPaneWidth = isWideOptionsLayout
    ? Math.min(50, Math.max(46, Math.floor((optionsOverlayWidth - 8) * 0.45)))
    : undefined;
  const configurationContentWidth = Math.max(
    28,
    (configurationPaneWidth ?? optionsOverlayWidth) - 8
  );
  const previewPaneWidth = isWideOptionsLayout
    ? Math.max(48, optionsOverlayWidth - (configurationPaneWidth ?? 0) - 8)
    : undefined;
  const textareaWidth = Math.max(
    30,
    Math.min(68, configurationContentWidth - (showCustomInstructions ? 2 : 0))
  );

  useEffect(() => {
    if (step !== "options") {
      return;
    }

    if (isCustomInstructionsFocused) {
      customInstructionsRef.current?.focus();
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
  }, [isCustomInstructionsFocused, optionsFocus, step]);

  useEffect(() => {
    if (step !== "options") {
      return;
    }

    const focusOrder = getOptionsFocusOrder(showCustomInstructions);
    if (!focusOrder.includes(optionsFocus)) {
      setOptionsFocus("execution-mode");
    }
  }, [optionsFocus, showCustomInstructions, step]);

  useEffect(() => {
    if (step !== "options" || !showCustomInstructions || optionsFocus === "custom-instructions") {
      return;
    }

    const nextValue = customInstructionsRef.current?.plainText ?? customInstructionsDraft;
    const normalizedValue = nextValue.trim().length === 0 ? "" : nextValue;
    if (normalizedValue !== customInstructionsDraft) {
      setCustomInstructionsDraft(normalizedValue);
    }
    if (normalizedValue.length === 0) {
      setShowCustomInstructions(false);
    }
  }, [customInstructionsDraft, optionsFocus, showCustomInstructions, step]);

  function movePriorityCursor(direction: 1 | -1) {
    setPriorityCursorIndex((current) => {
      const next = clampPriorityCursorIndex(current + direction);
      priorityCursorIndexRef.current = next;
      return next;
    });
    setError(null);
  }

  function toggleSelectedPriority() {
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
  }

  useKeyboard((key) => {
    if (step === "options") {
      if (key.name === "tab") {
        const focusOrder = getOptionsFocusOrder(showCustomInstructions);
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

      if (isCustomInstructionsFocused) {
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

        if (executionMode === "auto-priority" && key.name === "left") {
          movePriorityCursor(-1);
          return;
        }

        if (executionMode === "auto-priority" && key.name === "right") {
          movePriorityCursor(1);
          return;
        }

        if (executionMode === "auto-priority" && key.name === "space") {
          toggleSelectedPriority();
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

  function handleMaxIterationsInput(next: string) {
    if (next === "" || /^\d+$/.test(next)) {
      setMaxIterationsDraft(next);
      setError(null);
      return;
    }
    const input = maxIterationsInputRef.current;
    if (input) {
      input.value = maxIterationsDraft;
    }
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

  function renderExecutionModeOptions() {
    return (
      <box flexDirection="column" gap={0}>
        <box flexDirection="column">
          {REVIEW_EXECUTION_OPTIONS.map((option) => {
            const isSelected = option.mode === executionMode;
            const isFocused = optionsFocus === "execution-mode" && isSelected;
            const showFocusMarker = isFocused && option.mode !== "auto-priority";

            return (
              <box key={option.mode} flexDirection="column" paddingX={1} paddingY={0}>
                <box flexDirection="row">
                  <text fg={showFocusMarker ? TUI_COLORS.accent.key : TUI_COLORS.text.dim}>
                    {showFocusMarker ? "▶ " : "  "}
                  </text>
                  <text fg={isSelected ? TUI_COLORS.status.success : TUI_COLORS.text.dim}>
                    {isSelected ? "◉" : "◎"}
                  </text>
                  <text fg={isSelected ? TUI_COLORS.text.primary : TUI_COLORS.text.secondary}>
                    {" "}
                    {option.label}
                  </text>
                </box>
              </box>
            );
          })}
        </box>
      </box>
    );
  }

  function renderPreviewField(
    label: string,
    value: string,
    color: string = TUI_COLORS.text.secondary
  ) {
    return (
      <text fg={color} wrapMode="none">
        <span fg={TUI_COLORS.text.dim}>
          <strong>{label}:</strong>
        </span>{" "}
        {value}
      </text>
    );
  }

  function renderConfigurationPane() {
    return (
      <box
        border
        title="Configuration"
        titleAlignment="left"
        borderColor={TUI_COLORS.ui.border}
        padding={0}
        flexDirection="column"
        gap={0}
        width={configurationPaneWidth}
        flexGrow={isWideOptionsLayout ? 0 : 1}
      >
        <box paddingX={1} paddingY={0} flexDirection="column" gap={0}>
          <text fg={TUI_COLORS.text.dim}>
            <strong>Iterations</strong>
          </text>
          <input
            ref={maxIterationsInputRef}
            focused={optionsFocus === "max-iterations"}
            value={maxIterationsDraft}
            placeholder={String(initialMaxIterations)}
            width={12}
            onChange={handleMaxIterationsInput}
            onInput={handleMaxIterationsInput}
          />
        </box>

        <box marginTop={1} paddingX={1} paddingY={0} flexDirection="column" gap={0}>
          <text fg={TUI_COLORS.text.dim}>
            <strong>Execution</strong>
          </text>
          {renderExecutionModeOptions()}
        </box>

        {executionMode === "auto-priority" && (
          <box paddingX={1} paddingY={0} flexDirection="column" gap={0}>
            <box flexDirection="row" paddingLeft={2}>
              {PRIORITIES.map((priority, index) => {
                const isSelected = selectedPriorities.includes(priority);
                const isHighlighted =
                  optionsFocus === "execution-mode" &&
                  executionMode === "auto-priority" &&
                  priorityCursorIndex === index;

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
          </box>
        )}

        <box marginTop={1} paddingX={1} paddingY={0} flexDirection="column" gap={0}>
          <text fg={TUI_COLORS.text.dim}>
            <strong>Custom instructions</strong>
            <span fg={TUI_COLORS.accent.key}> [C]</span>
          </text>
          {showCustomInstructions && (
            <textarea
              ref={customInstructionsRef}
              focused={optionsFocus === "custom-instructions"}
              initialValue={customInstructionsDraft}
              placeholder={CUSTOM_INSTRUCTIONS_PLACEHOLDER}
              width={textareaWidth}
              height={isWideOptionsLayout ? 5 : 4}
              wrapMode="word"
              keyBindings={[{ name: "return", shift: true, action: "submit" }]}
              onSubmit={() => {
                submitWithOptions();
              }}
              onContentChange={() => {
                syncCustomInstructionsDraft();
              }}
            />
          )}
        </box>
      </box>
    );
  }

  function renderPreviewPane() {
    return (
      <box
        border
        title="Run Preview"
        titleAlignment="left"
        borderColor={TUI_COLORS.ui.border}
        padding={0}
        flexDirection="column"
        gap={0}
        width={previewPaneWidth}
        flexGrow={1}
      >
        {renderPreviewField("Target", targetSummary)}
        {renderPreviewField("Execution", executionSummary)}
        {executionMode === "auto-priority" &&
          renderPreviewField(
            "Priority filter",
            selectedPriorityList ?? "Required",
            selectedPriorityList ? TUI_COLORS.text.secondary : TUI_COLORS.status.warning
          )}
        {renderPreviewField("Max iterations", maxIterationsDraft.trim() || "Required")}
        {renderPreviewField(
          "Custom instructions",
          customInstructionsStatus,
          customInstructionsStatus === "Set" ? TUI_COLORS.status.success : TUI_COLORS.text.muted
        )}
        <text fg={TUI_COLORS.text.dim}>
          <strong>Command preview</strong>
        </text>
        <box
          border
          borderColor={TUI_COLORS.ui.border}
          paddingX={1}
          paddingY={0}
          backgroundColor="#0d1220"
        >
          <text fg={TUI_COLORS.text.primary} wrapMode="none">
            {commandPreview}
          </text>
        </box>
      </box>
    );
  }

  function renderOptions() {
    const isInlinePriorityControlActive =
      optionsFocus === "execution-mode" && executionMode === "auto-priority";
    const reviewStartKeyLabel = isCustomInstructionsFocused ? "[Shift+Enter]" : "[Enter]";

    return (
      <box flexDirection="column" gap={0}>
        <box flexDirection={isWideOptionsLayout ? "row" : "column"} gap={0} alignItems="stretch">
          {renderConfigurationPane()}
          {renderPreviewPane()}
        </box>
        <text fg={optionsStatusColor}>
          {error ?? (
            <>
              <span fg={TUI_COLORS.accent.key}>[Tab]</span>
              <span fg={TUI_COLORS.text.muted}> moves focus </span>
              {isInlinePriorityControlActive && (
                <>
                  <span fg={TUI_COLORS.accent.key}>[Space]</span>
                  <span fg={TUI_COLORS.text.muted}> to select </span>
                </>
              )}
              <span fg={TUI_COLORS.accent.key}>{reviewStartKeyLabel}</span>
              <span fg={TUI_COLORS.text.muted}> starts review</span>
            </>
          )}
        </text>
      </box>
    );
  }

  const isPickerStep = step === "branch-picker" || step === "commit-picker";
  const overlayWidth =
    step === "options" ? optionsOverlayWidth : step === "commit-picker" ? 90 : 74;

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
            ? "Review Run"
            : step === "branch-picker"
              ? REVIEW_MODE_META.base.title
              : step === "commit-picker"
                ? REVIEW_MODE_META.commit.title
                : "Review Mode"
        }
        titleAlignment="left"
        padding={isPickerStep ? LIST_PICKER_PADDING : step === "options" ? 0 : 2}
        paddingX={step === "options" ? 1 : undefined}
        paddingY={step === "options" ? 0 : undefined}
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
