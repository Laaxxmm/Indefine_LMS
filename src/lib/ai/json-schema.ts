// Zod (v3, the repo's `import { z } from "zod"`) → JSON Schema, for the providers' structured
// output. Covers the shapes agents use (objects, arrays, primitives, enums, literals, unions,
// optional/nullable/default/effects). Anything else becomes a permissive primitive schema —
// safe, because the router validates every answer against the real Zod schema afterwards.
import type { ZodTypeAny } from "zod";

export type JsonSchema = Record<string, unknown>;

const ANY: JsonSchema = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };

interface Def {
  typeName?: string;
  [k: string]: unknown;
}

function withDescription(schema: ZodTypeAny, out: JsonSchema): JsonSchema {
  return schema.description ? { ...out, description: schema.description } : out;
}

export function zodToJsonSchema(schema: ZodTypeAny, depth = 0): JsonSchema {
  if (depth > 20) return ANY;
  const def = schema._def as Def;
  const next = (s: unknown) => zodToJsonSchema(s as ZodTypeAny, depth + 1);
  switch (def.typeName) {
    case "ZodString": {
      const checks = (def.checks as { kind: string }[] | undefined) ?? [];
      const fmt = checks.find((c) => ["email", "datetime", "date", "uuid", "url"].includes(c.kind))?.kind;
      const format = fmt === "datetime" ? "date-time" : fmt === "url" ? "uri" : fmt;
      return withDescription(schema, format ? { type: "string", format } : { type: "string" });
    }
    case "ZodNumber": {
      const checks = (def.checks as { kind: string }[] | undefined) ?? [];
      return withDescription(schema, { type: checks.some((c) => c.kind === "int") ? "integer" : "number" });
    }
    case "ZodBigInt":
      return withDescription(schema, { type: "integer" });
    case "ZodBoolean":
      return withDescription(schema, { type: "boolean" });
    case "ZodNull":
      return { type: "null" };
    case "ZodDate":
      return withDescription(schema, { type: "string", format: "date-time" });
    case "ZodLiteral": {
      const v = def.value as string | number | boolean;
      return withDescription(schema, { type: typeof v === "number" ? "number" : typeof v, enum: [v] });
    }
    case "ZodEnum":
      return withDescription(schema, { type: "string", enum: [...(def.values as string[])] });
    case "ZodNativeEnum": {
      const obj = def.values as Record<string, string | number>;
      // Numeric TS enums carry a reverse mapping (value → name); keep only real values.
      const vals = Object.keys(obj)
        .filter((k) => typeof obj[obj[k] as string] !== "number")
        .map((k) => obj[k]);
      const allNum = vals.every((v) => typeof v === "number");
      return withDescription(schema, { type: allNum ? "number" : "string", enum: vals });
    }
    case "ZodArray":
      return withDescription(schema, { type: "array", items: next(def.type) });
    case "ZodTuple":
      return withDescription(schema, { type: "array", items: ANY });
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = next(child);
        if (!child.isOptional()) required.push(key);
      }
      return withDescription(schema, { type: "object", properties, required, additionalProperties: false });
    }
    case "ZodRecord":
      return withDescription(schema, { type: "object", additionalProperties: next(def.valueType) });
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = def.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
      const list = Array.isArray(options) ? options : [...options.values()];
      return withDescription(schema, { anyOf: list.map(next) });
    }
    case "ZodNullable":
      return withDescription(schema, { anyOf: [next(def.innerType), { type: "null" }] });
    case "ZodOptional":
    case "ZodDefault":
    case "ZodReadonly":
    case "ZodCatch":
      return withDescription(schema, next(def.innerType));
    case "ZodEffects":
      return withDescription(schema, next(def.schema));
    case "ZodBranded":
      return next(def.type);
    case "ZodPipeline":
      return next(def.in);
    case "ZodLazy":
      return next((def.getter as () => ZodTypeAny)());
    default:
      return ANY;
  }
}

/**
 * The object every provider is asked to return: the caller's answer plus a self-reported
 * confidence in [0, 1]. Without a caller schema the answer is free text.
 */
export function routerOutputJsonSchema(schema?: ZodTypeAny): JsonSchema {
  return {
    type: "object",
    properties: {
      output: schema ? zodToJsonSchema(schema) : { type: "string" },
      confidence: {
        type: "number",
        description: "Your confidence that `output` is complete and correct, from 0 (guess) to 1 (certain).",
      },
    },
    required: ["output", "confidence"],
    additionalProperties: false,
  };
}
