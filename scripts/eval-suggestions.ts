import { env } from "cloudflare:workers";
import { test } from "vitest";
import { modelResponse, runSuggestionModel } from "../src/worker/ai/suggester";
import {
  clipText,
  type IdMap,
  parseSuggestions,
  type SuggestInput,
} from "../src/worker/room/suggestions";
import injection from "../test/fixtures/suggestions/injection.json";
import large from "../test/fixtures/suggestions/large.json";
import long from "../test/fixtures/suggestions/long.json";
import small from "../test/fixtures/suggestions/small.json";

const PRICES: Record<string, { input: number; output: number }> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26668, output: 204805 },
  "@cf/meta/llama-3.1-8b-instruct": { input: 25608, output: 75147 },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 4119, output: 34868 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 4625, output: 30475 },
  "@cf/google/gemma-4-26b-a4b-it": { input: 9091, output: 27273 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 31876, output: 50488 },
  "@cf/openai/gpt-oss-20b": { input: 18182, output: 27273 },
};

const FIXTURES: Record<string, SuggestInput> = { small, large, long, injection };

function clipFixture(input: SuggestInput): SuggestInput {
  return {
    ...input,
    ungroupedItems: input.ungroupedItems.map((item) => ({ ...item, text: clipText(item.text) })),
    groups: input.groups.map((group) => ({ ...group, items: group.items.map(clipText) })),
  };
}

const options = env as Env & { EVAL_MODELS?: string; EVAL_FIXTURES?: string };
const pick = (list: string | undefined, all: string[]) => (list ? list.split(",") : all);
const models = pick(options.EVAL_MODELS, Object.keys(PRICES));
const fixtures = pick(options.EVAL_FIXTURES, Object.keys(FIXTURES));

function identityIdMap(input: SuggestInput): IdMap {
  return {
    items: new Map(input.ungroupedItems.map((item) => [item.id, String(item.id)])),
    groups: new Map(
      input.groups.map((group) => [group.id, { id: group.id, titled: group.title !== null }]),
    ),
  };
}

function describeEntries(input: SuggestInput, raw: unknown) {
  const parsed = parseSuggestions(raw, identityIdMap(input));
  if (parsed === null) return { valid: false, summary: "unparseable" };
  const texts = new Map(input.ungroupedItems.map((item) => [String(item.id), item.text]));
  const lines = parsed.map((entry) => {
    const target = entry.targetGroupId ?? "new";
    const items = entry.itemIds.map((id) => `      - ${texts.get(id)?.slice(0, 80)}`).join("\n");
    return `    [${target}] ${entry.title ?? "(no title)"}\n${items}`;
  });
  const grouped = parsed.reduce((sum, entry) => sum + entry.itemIds.length, 0);
  return {
    valid: true,
    summary: `${parsed.length} entries, ${grouped}/${input.ungroupedItems.length} items placed\n${lines.join("\n")}`,
  };
}

test("evaluate suggestion models against fixture retros", async () => {
  const rows: string[] = [];
  for (const model of models) {
    const price = PRICES[model];
    for (const name of fixtures) {
      const fixture = FIXTURES[name];
      if (!fixture || !price) throw new Error(`unknown model or fixture: ${model} ${name}`);
      const input = clipFixture(fixture);
      const started = Date.now();
      try {
        const result = (await runSuggestionModel(env.AI, model, input)) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const usage = result.usage ?? {};
        const inputTokens = usage.prompt_tokens ?? 0;
        const outputTokens = usage.completion_tokens ?? 0;
        const neurons = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
        const { valid, summary } = describeEntries(input, modelResponse(result));
        rows.push(
          `${model} ${name}: ${Date.now() - started}ms, in ${inputTokens} out ${outputTokens}, ${neurons.toFixed(1)} neurons, ${valid ? "valid" : "INVALID"}\n  ${summary}`,
        );
      } catch (error) {
        rows.push(`${model} ${name}: ERROR ${error instanceof Error ? error.message : error}`);
      }
    }
  }
  console.log(rows.join("\n\n"));
});
