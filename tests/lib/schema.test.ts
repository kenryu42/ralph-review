import { describe, expect, test } from "bun:test";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION } from "@/lib/types";

interface JsonSchema {
  properties?: Record<string, unknown>;
  required?: unknown;
}

describe("config schema artifact", () => {
  test("contains canonical metadata fields and required config keys", async () => {
    const schemaText = await Bun.file("assets/ralph-review.schema.json").text();
    const schema = JSON.parse(schemaText) as JsonSchema;

    const properties = schema.properties ?? {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    expect(properties.$schema).toBeDefined();
    expect(properties.version).toBeDefined();
    expect(properties.reviewer).toBeDefined();
    expect(properties.fixer).toBeDefined();
    expect(properties.defaultReview).toBeDefined();

    const schemaProperty = properties.$schema as Record<string, unknown>;
    expect(schemaProperty.const).toBe(CONFIG_SCHEMA_URI);

    const versionProperty = properties.version as Record<string, unknown>;
    expect(versionProperty.const).toBe(CONFIG_VERSION);

    expect(required).toContain("$schema");
    expect(required).toContain("version");
    expect(required).toContain("reviewer");
    expect(required).toContain("fixer");
    expect(required).toContain("maxIterations");
    expect(required).toContain("iterationTimeout");
    expect(required).toContain("defaultReview");
  });
});
