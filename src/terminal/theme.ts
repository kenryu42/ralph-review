import { RALPH_REVIEW_PALETTE } from "./palette";

// ANSI escape codes
const ESC = "\x1B[";
const RESET = `${ESC}0m`;

// Style codes
const STYLES = {
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  inverse: 7,
  hidden: 8,
  strikethrough: 9,
} as const;

type StyleName = keyof typeof STYLES;

// Color level detection
export type ColorLevel = 0 | 1 | 2 | 3;

/**
 * Detect the color support level for a stream
 * Level 0: No color
 * Level 1: 16 colors (basic ANSI)
 * Level 2: 256 colors
 * Level 3: 16 million colors (truecolor/24-bit)
 */
function detectColorLevel(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean | undefined = process.stdout?.isTTY,
  platform: NodeJS.Platform = process.platform
): ColorLevel {
  // Check for explicit NO_COLOR (disabled unless FORCE_COLOR overrides)
  const noColor = env.NO_COLOR;
  const forceColor = env.FORCE_COLOR;

  // FORCE_COLOR takes precedence over NO_COLOR
  if (forceColor !== undefined && forceColor !== "") {
    const level = Number.parseInt(forceColor, 10);
    if (!Number.isNaN(level)) {
      return Math.min(3, Math.max(0, level)) as ColorLevel;
    }
    // FORCE_COLOR set but not a number = enable colors
    return 3;
  }

  // NO_COLOR disables colors
  if (noColor !== undefined && noColor !== "") {
    return 0;
  }

  // Not a TTY and no explicit force = no color
  if (!isTTY) {
    // But check for CI environments that support colors
    const ci = env.CI;
    const ciName =
      env.GITHUB_ACTIONS ||
      env.GITLAB_CI ||
      env.CIRCLECI ||
      env.TRAVIS ||
      env.DRONE ||
      env.BUILDKITE ||
      env.APPVEYOR;

    if (!ci && !ciName) {
      return 0;
    }
  }

  // Check for dumb terminal
  const term = env.TERM;
  if (term === "dumb") {
    return 0;
  }

  // Windows detection - modern Windows terminals support truecolor
  const isWindows = platform === "win32";
  if (isWindows) {
    // Windows Terminal, VS Code, and modern consoles support truecolor
    const wtSession = env.WT_SESSION;
    const termProgram = env.TERM_PROGRAM;

    if (wtSession || termProgram === "vscode" || env.COLORTERM === "truecolor") {
      return 3;
    }

    // Check Windows version for ConPTY support (Windows 10 1809+)
    // If we have TERM set on Windows, it's likely a modern terminal
    if (term) {
      return 3;
    }

    // Older Windows - limited color support
    return 1;
  }

  // Check COLORTERM for truecolor support
  const colorTerm = env.COLORTERM;
  if (colorTerm === "truecolor" || colorTerm === "24bit") {
    return 3;
  }

  // Check TERM for color support
  if (term) {
    if (term.includes("256color")) {
      return 2;
    }
    if (term.includes("color") || term.includes("ansi") || term.includes("xterm")) {
      return 1;
    }
  }

  // Default for TTY: assume basic color support
  return isTTY ? 1 : 0;
}

/**
 * Convert hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # prefix if present
  const cleanHex = hex.startsWith("#") ? hex.slice(1) : hex;

  // Validate hex format
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    return null;
  }

  return {
    r: Number.parseInt(cleanHex.slice(0, 2), 16),
    g: Number.parseInt(cleanHex.slice(2, 4), 16),
    b: Number.parseInt(cleanHex.slice(4, 6), 16),
  };
}

/**
 * Convert RGB to ANSI 256 color approximation
 * Uses xterm color cube for better accuracy
 */
function rgbToAnsi256(r: number, g: number, b: number): number {
  // Grayscale check
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }

  // Color cube (6x6x6)
  const rIndex = Math.round((r / 255) * 5);
  const gIndex = Math.round((g / 255) * 5);
  const bIndex = Math.round((b / 255) * 5);

  return 16 + 36 * rIndex + 6 * gIndex + bIndex;
}

/**
 * Create a color function for a specific hex color
 */
function createHexColor(hex: string): (text: string) => string {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    // Invalid hex, return plain text
    return (text: string) => text;
  }

  return (text: string) => {
    const level = getColorLevel();
    if (level === 0) return text;

    if (level >= 3) {
      // Truecolor: 24-bit RGB
      return `${ESC}38;2;${rgb.r};${rgb.g};${rgb.b}m${text}${RESET}`;
    }

    if (level >= 2) {
      // 256 colors
      const code = rgbToAnsi256(rgb.r, rgb.g, rgb.b);
      return `${ESC}38;5;${code}m${text}${RESET}`;
    }

    // Basic 16 colors - map to closest basic color
    // For simplicity, just use the ANSI reset (no color)
    // In a full implementation, we'd map to the closest of the 16 basic colors
    return text;
  };
}

/**
 * Create a styler function that applies multiple styles
 */
function createStyler(colorHex?: string, styles: StyleName[] = []): (text: string) => string {
  return (text: string) => {
    const level = getColorLevel();
    if (level === 0) return text;

    const codes: number[] = [];

    // Add style codes
    for (const style of styles) {
      codes.push(STYLES[style]);
    }

    // Add color code
    if (colorHex && level >= 3) {
      const rgb = hexToRgb(colorHex);
      if (rgb) {
        // For combined styles + truecolor, we need to handle this differently
        const stylePrefix = codes.length > 0 ? `${ESC}${codes.join(";")}m` : "";
        const colorPrefix = `${ESC}38;2;${rgb.r};${rgb.g};${rgb.b}m`;
        return `${stylePrefix}${colorPrefix}${text}${RESET}`;
      }
    } else if (colorHex && level >= 2) {
      const rgb = hexToRgb(colorHex);
      if (rgb) {
        const code = rgbToAnsi256(rgb.r, rgb.g, rgb.b);
        codes.push(38, 5, code);
      }
    }

    if (codes.length === 0) return text;

    return `${ESC}${codes.join(";")}m${text}${RESET}`;
  };
}

// Theme object matching the original chalk-based API
export const theme = {
  accent: createHexColor(RALPH_REVIEW_PALETTE.accent),
  accentBright: createHexColor(RALPH_REVIEW_PALETTE.accentBright),
  accentDim: createHexColor(RALPH_REVIEW_PALETTE.accentDim),
  info: createHexColor(RALPH_REVIEW_PALETTE.info),
  success: createHexColor(RALPH_REVIEW_PALETTE.success),
  warn: createHexColor(RALPH_REVIEW_PALETTE.warn),
  error: createHexColor(RALPH_REVIEW_PALETTE.error),
  muted: createHexColor(RALPH_REVIEW_PALETTE.muted),
  heading: (text: string) => createStyler(RALPH_REVIEW_PALETTE.accent, ["bold"])(text),
  command: createHexColor(RALPH_REVIEW_PALETTE.accentBright),
  option: createHexColor(RALPH_REVIEW_PALETTE.warn),
} as const;

/**
 * Check if rich colors are supported
 */
export function isRich(): boolean {
  return getColorLevel() >= 2;
}

/**
 * Get the current color level
 */
export function getColorLevel(): ColorLevel {
  return detectColorLevel();
}

/**
 * Conditionally colorize text based on rich flag
 */
export function colorize(rich: boolean, color: (text: string) => string, value: string): string {
  return rich ? color(value) : value;
}

/**
 * Create a custom color from hex
 */
export function hex(value: string): (text: string) => string {
  return createHexColor(value);
}

/**
 * Apply bold style
 */
export function bold(text: string): string {
  if (getColorLevel() === 0) return text;
  return `${ESC}${STYLES.bold}m${text}${RESET}`;
}

/**
 * Apply dim style
 */
export function dim(text: string): string {
  if (getColorLevel() === 0) return text;
  return `${ESC}${STYLES.dim}m${text}${RESET}`;
}

/**
 * Strip ANSI codes from text (useful for testing or length calculations)
 * Matches most common ANSI escape sequences
 */
export function stripAnsi(text: string): string {
  // Build regex from string to avoid biome lint error with control character
  const esc = "\u001B"; // Unicode escape for ESC character
  const pattern = new RegExp(
    `${esc}\\[[()#;?]*([0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
    "gu"
  );
  return text.replace(pattern, "");
}
