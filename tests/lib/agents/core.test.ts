import { describe, expect, test } from "bun:test";
import {
  createLineFormatter,
  defaultBuildEnv,
  parseJsonlEvent,
  stripSystemReminders,
} from "@/lib/agents/core";

describe("core", () => {
  describe("parseJsonlEvent", () => {
    test("parses valid JSON with type field", () => {
      const line = JSON.stringify({ type: "message", content: "hello" });
      const event = parseJsonlEvent<{ type: string; content: string }>(line);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("message");
      expect(event?.content).toBe("hello");
    });

    test("returns null for empty string", () => {
      const event = parseJsonlEvent("");
      expect(event).toBeNull();
    });

    test("returns null for whitespace-only string", () => {
      const event = parseJsonlEvent("   \n\t  ");
      expect(event).toBeNull();
    });

    test("returns null for invalid JSON", () => {
      const event = parseJsonlEvent("{invalid json}");
      expect(event).toBeNull();
    });

    test("returns null for non-object JSON", () => {
      const event = parseJsonlEvent('"just a string"');
      expect(event).toBeNull();
    });

    test("returns null for null JSON", () => {
      const event = parseJsonlEvent("null");
      expect(event).toBeNull();
    });

    test("returns null for object without type field", () => {
      const event = parseJsonlEvent('{"foo": "bar"}');
      expect(event).toBeNull();
    });

    test("returns null for object with non-string type field", () => {
      const event = parseJsonlEvent('{"type": 123}');
      expect(event).toBeNull();
    });

    test("with requiresObjectPrefix returns null for lines not starting with {", () => {
      const line = `some text before ${JSON.stringify({ type: "message" })}`;
      const event = parseJsonlEvent(line, true);
      expect(event).toBeNull();
    });

    test("with requiresObjectPrefix parses lines starting with {", () => {
      const line = JSON.stringify({ type: "message", data: "test" });
      const event = parseJsonlEvent<{ type: string; data: string }>(line, true);

      expect(event).not.toBeNull();
      expect(event?.type).toBe("message");
    });

    test("without requiresObjectPrefix still parses valid JSON", () => {
      const line = JSON.stringify({ type: "event", value: 42 });
      const event = parseJsonlEvent<{ type: string; value: number }>(line);

      expect(event).not.toBeNull();
      expect(event?.value).toBe(42);
    });
  });

  describe("defaultBuildEnv", () => {
    test("returns object containing process.env", () => {
      const env = defaultBuildEnv();

      expect(typeof env).toBe("object");
      // Should contain at least PATH from the environment
      expect(env.PATH).toBeDefined();
    });

    test("returns a Record<string, string>", () => {
      const env = defaultBuildEnv();

      for (const [key, value] of Object.entries(env)) {
        expect(typeof key).toBe("string");
        expect(typeof value).toBe("string");
      }
    });
  });

  describe("createLineFormatter", () => {
    test("returns formatted output when parser and formatter succeed", () => {
      const parser = (line: string) => {
        try {
          return JSON.parse(line) as { type: string; text: string };
        } catch {
          return null;
        }
      };
      const displayFormatter = (event: { type: string; text: string }) => event.text;

      const formatter = createLineFormatter(parser, displayFormatter);
      const line = JSON.stringify({ type: "message", text: "Hello world" });

      expect(formatter(line)).toBe("Hello world");
    });

    test("returns null when parser returns null", () => {
      const parser = (_line: string) => null;
      const displayFormatter = (_event: unknown) => "formatted";

      const formatter = createLineFormatter(parser, displayFormatter);

      expect(formatter("invalid")).toBeNull();
    });

    test("returns empty string when displayFormatter returns null", () => {
      const parser = (line: string) => JSON.parse(line) as { type: string };
      const displayFormatter = (_event: { type: string }) => null;

      const formatter = createLineFormatter(parser, displayFormatter);
      const line = JSON.stringify({ type: "system" });

      expect(formatter(line)).toBe("");
    });

    test("returns empty string when displayFormatter returns empty string", () => {
      const parser = (line: string) => JSON.parse(line) as { type: string };
      const displayFormatter = (_event: { type: string }) => "";

      const formatter = createLineFormatter(parser, displayFormatter);
      const line = JSON.stringify({ type: "system" });

      expect(formatter(line)).toBe("");
    });
  });

  describe("stripSystemReminders", () => {
    test("removes system-reminder tags from string", () => {
      const text = "Hello <system-reminder>secret stuff</system-reminder> World";
      // Trailing whitespace after tag is consumed by regex
      expect(stripSystemReminders(text)).toBe("Hello World");
    });

    test("removes multiple system-reminder tags", () => {
      const text =
        "<system-reminder>first</system-reminder>middle<system-reminder>second</system-reminder>end";
      expect(stripSystemReminders(text)).toBe("middleend");
    });

    test("handles multiline content in tags", () => {
      const text = "Start\n<system-reminder>\nLine 1\nLine 2\n</system-reminder>\nEnd";
      expect(stripSystemReminders(text)).toBe("Start\nEnd");
    });

    test("trims result", () => {
      const text = "  <system-reminder>removed</system-reminder>  content  ";
      expect(stripSystemReminders(text)).toBe("content");
    });

    test("handles string without tags", () => {
      const text = "No tags here";
      expect(stripSystemReminders(text)).toBe("No tags here");
    });

    test("handles empty string", () => {
      expect(stripSystemReminders("")).toBe("");
    });

    test("handles non-string input by converting to string", () => {
      expect(stripSystemReminders(123 as unknown)).toBe("123");
      expect(stripSystemReminders(null as unknown)).toBe("");
      expect(stripSystemReminders(undefined as unknown)).toBe("");
    });
  });
});
