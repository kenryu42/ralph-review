import { describe, expect, test } from "bun:test";
import {
  bold,
  colorize,
  dim,
  getColorLevel,
  hex,
  isRich,
  stripAnsi,
  theme,
} from "@/terminal/theme";

describe("terminal/theme", () => {
  describe("color support detection", () => {
    test("getColorLevel returns a valid level (0-3)", () => {
      const level = getColorLevel();
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(3);
    });

    test("isRich returns boolean", () => {
      const rich = isRich();
      expect(typeof rich).toBe("boolean");
    });
  });

  describe("color functions", () => {
    test("hex creates a color function", () => {
      const red = hex("#FF0000");
      expect(typeof red).toBe("function");
    });

    test("hex color function applies ANSI codes in rich mode", () => {
      const color = hex("#FF5A2D");
      const result = color("test");

      if (isRich()) {
        expect(result).toContain("\x1B[");
        expect(result).toContain("m");
      } else {
        expect(result).toBe("test");
      }
    });

    test("theme.accent applies color to text", () => {
      const result = theme.accent("accent text");

      if (isRich()) {
        expect(result).toContain("\x1B[");
        expect(stripAnsi(result)).toBe("accent text");
      } else {
        expect(result).toBe("accent text");
      }
    });

    test("theme.success applies color to text", () => {
      const result = theme.success("success text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("success text");
      } else {
        expect(result).toBe("success text");
      }
    });

    test("theme.error applies color to text", () => {
      const result = theme.error("error text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("error text");
      } else {
        expect(result).toBe("error text");
      }
    });

    test("theme.warn applies color to text", () => {
      const result = theme.warn("warning text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("warning text");
      } else {
        expect(result).toBe("warning text");
      }
    });

    test("theme.info applies color to text", () => {
      const result = theme.info("info text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("info text");
      } else {
        expect(result).toBe("info text");
      }
    });

    test("theme.muted applies color to text", () => {
      const result = theme.muted("muted text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("muted text");
      } else {
        expect(result).toBe("muted text");
      }
    });

    test("theme.command applies color to text", () => {
      const result = theme.command("command text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("command text");
      } else {
        expect(result).toBe("command text");
      }
    });

    test("theme.option applies color to text", () => {
      const result = theme.option("option text");

      if (isRich()) {
        expect(stripAnsi(result)).toBe("option text");
      } else {
        expect(result).toBe("option text");
      }
    });

    test("theme.heading applies bold and color", () => {
      const result = theme.heading("heading text");

      if (getColorLevel() > 0) {
        expect(stripAnsi(result)).toBe("heading text");
      } else {
        expect(result).toBe("heading text");
      }
    });
  });

  describe("style functions", () => {
    test("bold applies bold style", () => {
      const result = bold("bold text");

      if (getColorLevel() > 0) {
        expect(stripAnsi(result)).toBe("bold text");
        expect(result).toContain("\x1B[");
      } else {
        expect(result).toBe("bold text");
      }
    });

    test("dim applies dim style", () => {
      const result = dim("dim text");

      if (getColorLevel() > 0) {
        expect(stripAnsi(result)).toBe("dim text");
      } else {
        expect(result).toBe("dim text");
      }
    });
  });

  describe("colorize", () => {
    test("colorize applies color when rich is true", () => {
      const colored = (text: string) => `\x1B[31m${text}\x1B[0m`;
      const result = colorize(true, colored, "test");

      if (isRich()) {
        expect(result).toContain("\x1B[");
      }
      expect(stripAnsi(result)).toBe("test");
    });

    test("colorize returns plain text when rich is false", () => {
      const colored = (text: string) => `\x1B[31m${text}\x1B[0m`;
      const result = colorize(false, colored, "test");
      expect(result).toBe("test");
    });
  });

  describe("stripAnsi", () => {
    test("stripAnsi removes ANSI codes", () => {
      const colored = "\x1B[31mred\x1B[0m \x1B[32mgreen\x1B[0m";
      expect(stripAnsi(colored)).toBe("red green");
    });

    test("stripAnsi returns plain text unchanged", () => {
      const plain = "no colors here";
      expect(stripAnsi(plain)).toBe(plain);
    });

    test("stripAnsi handles empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    test("stripAnsi handles complex ANSI sequences", () => {
      const complex = "\x1B[1;38;2;255;90;45mbold colored\x1B[0m";
      expect(stripAnsi(complex)).toBe("bold colored");
    });
  });

  describe("edge cases", () => {
    test("hex handles invalid hex gracefully", () => {
      const invalid = hex("not-a-hex");
      expect(invalid("test")).toBe("test");
    });

    test("hex handles hex without hash prefix", () => {
      const color = hex("FF0000");
      const result = color("test");
      // Should work the same as with hash
      expect(stripAnsi(result)).toBe("test");
    });

    test("theme preserves text content", () => {
      const text = "  spaced text  ";
      const result = theme.accent(text);
      expect(stripAnsi(result)).toBe(text);
    });

    test("theme handles special characters", () => {
      const text = "hello\nworld\ttab";
      const result = theme.accent(text);
      expect(stripAnsi(result)).toBe(text);
    });
  });
});
