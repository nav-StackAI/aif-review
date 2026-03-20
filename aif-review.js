#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AIF — Architecture Impact Framework
//  Adversarial Multi-Model Code Review
//
//  Open-sourced by GoXero · https://github.com/naveenbshastry/aif-review
//
//  Usage:
//    npx aif-review --file src/index.js            # review a single file
//    npx aif-review --dir src/                      # review a directory
//    npx aif-review --dir src/ --ext .ts,.js        # filter by extension
//    npx aif-review --dir src/ --non-interactive    # skip interactive triage
//    npx aif-review --config                        # reconfigure models
//
//  Environment variables:
//    Set API keys for the providers you want to use in a .env file.
//    Run `npx aif-review --config` for interactive setup.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename, extname, resolve } from "path";
import { createInterface } from "readline";

// ─── Load .env if present ────────────────────────────────────────────────

function loadEnvFile() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.substring(0, eq).trim();
    const val = trimmed.substring(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();

// ─── Terminal Branding ───────────────────────────────────────────────────

const BRAND = `
\x1b[38;5;208m╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   \x1b[1m\x1b[38;5;214m ██████╗  ██████╗ ██╗  ██╗███████╗██████╗  ██████╗  \x1b[0m\x1b[38;5;208m      ║
║   \x1b[1m\x1b[38;5;214m██╔════╝ ██╔═══██╗╚██╗██╔╝██╔════╝██╔══██╗██╔═══██╗ \x1b[0m\x1b[38;5;208m      ║
║   \x1b[1m\x1b[38;5;214m██║  ███╗██║   ██║ ╚███╔╝ █████╗  ██████╔╝██║   ██║ \x1b[0m\x1b[38;5;208m      ║
║   \x1b[1m\x1b[38;5;214m██║   ██║██║   ██║ ██╔██╗ ██╔══╝  ██╔══██╗██║   ██║ \x1b[0m\x1b[38;5;208m      ║
║   \x1b[1m\x1b[38;5;214m╚██████╔╝╚██████╔╝██╔╝ ██╗███████╗██║  ██║╚██████╔╝ \x1b[0m\x1b[38;5;208m      ║
║   \x1b[1m\x1b[38;5;214m ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝  \x1b[0m\x1b[38;5;208m      ║
║                                                              ║
║   \x1b[38;5;245m█▀█ █▀█ █▀▀ █ █ █ ▀█▀ █▀▀ █▀▀ ▀█▀ █ █ █▀█ █▀▀\x1b[38;5;208m         ║
║   \x1b[38;5;245m█▀█ █▀▄ █   █▀█ █  █  █▀▀ █    █  █ █ █▀▄ █▀▀\x1b[38;5;208m         ║
║   \x1b[38;5;245m▀ ▀ ▀ ▀ ▀▀▀ ▀ ▀ ▀  ▀  ▀▀▀ ▀▀▀  ▀  ▀▀▀ ▀ ▀ ▀▀▀\x1b[38;5;208m         ║
║                                                              ║
║   \x1b[38;5;253mI M P A C T   F R A M E W O R K\x1b[38;5;208m                           ║
║   \x1b[38;5;245m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[38;5;208m                           ║
║   \x1b[38;5;245mAdversarial Multi-Model Code Review\x1b[38;5;208m                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝\x1b[0m
`;

const c = {
  orange: (t) => `\x1b[38;5;208m${t}\x1b[0m`,
  gold: (t) => `\x1b[38;5;214m${t}\x1b[0m`,
  gray: (t) => `\x1b[38;5;245m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
};

const DIVIDER = c.orange("━".repeat(64));
const SECTION = (text) => `\n${c.orange("▸")} ${c.bold(text)}`;

// ─── Provider & Model Registry ───────────────────────────────────────────

const PROVIDERS = {
  groq: {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    free: true,
    signup: "console.groq.com/keys",
    format: "openai",
  },
  cerebras: {
    name: "Cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    keyEnv: "CEREBRAS_API_KEY",
    free: true,
    signup: "cloud.cerebras.ai",
    format: "openai",
  },
  mistral: {
    name: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    keyEnv: "MISTRAL_API_KEY",
    free: true,
    signup: "console.mistral.ai",
    format: "openai",
  },
  gemini: {
    name: "Google Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyEnv: "GEMINI_API_KEY",
    free: true,
    signup: "aistudio.google.com/apikey",
    format: "openai",
  },
  openrouter: {
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    free: true,
    signup: "openrouter.ai/settings/keys",
    format: "openai",
  },
  anthropic: {
    name: "Anthropic",
    url: "https://api.anthropic.com/v1/messages",
    keyEnv: "ANTHROPIC_API_KEY",
    free: false,
    signup: "console.anthropic.com/settings/keys",
    format: "anthropic",
  },
  openai: {
    name: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    keyEnv: "OPENAI_API_KEY",
    free: false,
    signup: "platform.openai.com/api-keys",
    format: "openai",
  },
};

// Default model roster — users can override via aif.config.json
const DEFAULT_MODELS = [
  // ── Free tier models ──
  { name: "Groq Llama 3.3 70B",            shortName: "Groq-Llama70",    provider: "groq",       model: "llama-3.3-70b-versatile",                   maxTokens: 4096 },
  { name: "Groq Llama 4 Scout",            shortName: "Groq-Scout",      provider: "groq",       model: "meta-llama/llama-4-scout-17b-16e-instruct",  maxTokens: 4096 },
  { name: "Cerebras Qwen3 235B",           shortName: "Cerebras-Qwen",   provider: "cerebras",   model: "qwen-3-235b-a22b-instruct-2507",            maxTokens: 4096 },
  { name: "Cerebras Llama 3.1 8B",         shortName: "Cerebras-8B",     provider: "cerebras",   model: "llama3.1-8b",                                maxTokens: 4096 },
  { name: "Mistral Small",                 shortName: "Mistral",         provider: "mistral",    model: "mistral-small-latest",                       maxTokens: 4096 },
  { name: "Gemini 2.5 Flash",              shortName: "Gemini",          provider: "gemini",     model: "gemini-2.5-flash",                           maxTokens: 4096 },
  { name: "OpenRouter Llama 3.3 70B Free", shortName: "OR-Llama70",      provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free",     maxTokens: 4096 },
  { name: "OpenRouter Nemotron 120B Free", shortName: "OR-Nemotron",     provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free",     maxTokens: 4096 },
  // ── Paid models (higher quality, used if key is set) ──
  { name: "Claude Sonnet 4",               shortName: "Claude",          provider: "anthropic",  model: "claude-sonnet-4-20250514",                   maxTokens: 4096 },
  { name: "GPT-4o Mini",                   shortName: "GPT-4o-Mini",     provider: "openai",     model: "gpt-4o-mini",                                maxTokens: 4096 },
];

// ─── Load user config if present ─────────────────────────────────────────

function loadConfig() {
  const configPath = join(process.cwd(), "aif.config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    console.log(c.yellow("⚠") + " Could not parse aif.config.json, using defaults.");
    return null;
  }
}

function getActiveModels(config) {
  const models = config?.models || DEFAULT_MODELS;
  return models.filter(m => {
    const provider = PROVIDERS[m.provider];
    if (!provider) return false;
    return !!process.env[provider.keyEnv];
  }).map(m => ({
    ...m,
    url: PROVIDERS[m.provider].url,
    keyEnv: PROVIDERS[m.provider].keyEnv,
    format: PROVIDERS[m.provider].format,
  }));
}

// ─── AIF System Prompt ───────────────────────────────────────────────────

function buildSystemPrompt(context) {
  return `You are a senior software architect performing an adversarial code review. Your job is NOT to be helpful or supportive. Your job is to find every weakness, gap, contradiction, blind spot, and fragility in the code.

${context ? `CONTEXT: ${context}\n` : ""}REVIEW THROUGH THESE LENSES:
1. Security — injection, auth bypass, token leaks, data exposure
2. Reliability — crashes, unhandled errors, race conditions, resource exhaustion
3. Performance — blocking I/O, memory leaks, unnecessary work, cold start impact
4. Correctness — logic bugs, off-by-one, type mismatches, edge cases
5. Architecture — coupling, dead code, missing abstractions, violation of stated patterns
6. Scalability — what breaks at 100 users? 1,000? 10,000?

FOR EACH FINDING, output EXACTLY this JSON format (one finding per object in an array):
{
  "findings": [
    {
      "id": 1,
      "title": "Short title",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "security|reliability|performance|correctness|architecture|scalability",
      "location": "filename:line_range or function_name",
      "problem": "What's wrong and WHY it matters",
      "fix": "Specific fix or improvement"
    }
  ]
}

RULES:
- Only output the JSON. No preamble, no markdown fences, no explanation outside the JSON.
- Be brutal. Be specific. No softening.
- If something is fine, skip it — only surface problems.
- Minimum 5 findings, maximum 20 per review chunk.
- CRITICAL = will crash or cause data loss/security breach in production
- HIGH = will cause visible bugs or performance issues for users
- MEDIUM = will cause maintainability or minor UX issues
- LOW = code smell or improvement opportunity`;
}

// ─── File Discovery ──────────────────────────────────────────────────────

function discoverFiles(dir, extensions) {
  const results = [];
  const exts = extensions ? extensions.split(",").map(e => e.startsWith(".") ? e : `.${e}`) : null;

  function walk(d) {
    for (const entry of readdirSync(d)) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist" || entry === "build" || entry === "__pycache__") continue;
      const full = join(d, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile()) {
          if (exts && !exts.includes(extname(entry))) continue;
          if (!exts) {
            // Auto-detect code files
            const ext = extname(entry);
            const codeExts = new Set([".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".c", ".cpp", ".h", ".cs", ".swift", ".kt", ".scala", ".sol", ".zig", ".ex", ".exs", ".clj", ".vue", ".svelte"]);
            if (!codeExts.has(ext)) continue;
          }
          results.push(full);
        }
      } catch { /* skip permission errors */ }
    }
  }

  walk(dir);
  return results;
}

function loadCode(files, baseDir) {
  const chunks = [];
  let currentChunk = "";
  let currentTokenEstimate = 0;

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const name = baseDir ? file.replace(baseDir + "/", "") : basename(file);
    const fileBlock = `\n// ══════ FILE: ${name} ══════\n${content}\n`;
    const tokenEstimate = Math.ceil(fileBlock.length / 3.5);

    if (currentTokenEstimate + tokenEstimate > 80000 && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = fileBlock;
      currentTokenEstimate = tokenEstimate;
    } else {
      currentChunk += fileBlock;
      currentTokenEstimate += tokenEstimate;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// ─── API Calls ───────────────────────────────────────────────────────────

async function callModel(model, systemPrompt, codeChunk, chunkLabel) {
  const apiKey = process.env[model.keyEnv];
  if (!apiKey) {
    return { model: model.name, error: `Missing ${model.keyEnv}` };
  }

  const userPrompt = `Review this code chunk (${chunkLabel}):\n\n${codeChunk}`;
  console.log(`  ⏳ ${model.shortName} reviewing ${chunkLabel}...`);
  const startTime = Date.now();

  try {
    let resp, content, tokens;

    if (model.format === "anthropic") {
      // Anthropic Messages API
      resp = await fetch(model.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model.model,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          max_tokens: model.maxTokens,
          temperature: 0.3,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { model: model.name, error: `API ${resp.status}: ${errText.substring(0, 200)}` };
      }

      const data = await resp.json();
      content = data.content?.[0]?.text || "";
      tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    } else {
      // OpenAI-compatible API
      resp = await fetch(model.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: model.maxTokens,
          temperature: 0.3,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return { model: model.name, error: `API ${resp.status}: ${errText.substring(0, 200)}` };
      }

      const data = await resp.json();
      content = data.choices?.[0]?.message?.content || "";
      tokens = data.usage?.total_tokens || "?";
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ ${model.shortName} done (${elapsed}s, ${tokens} tokens)`);

    // Parse findings
    const findings = parseFindings(content, model.shortName);
    return { model: model.name, shortName: model.shortName, findings, elapsed, tokens };
  } catch (err) {
    return { model: model.name, error: `Network error: ${err.message}` };
  }
}

function parseFindings(content, modelName) {
  try {
    let jsonStr = content;

    // Strip thinking tags (Qwen3, DeepSeek R1)
    jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Strip markdown fences
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    // Find the JSON object containing findings
    const jsonMatch = jsonStr.match(/\{[\s\S]*"findings"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    return parsed.findings || [];
  } catch {
    console.log(`  ⚠️  ${modelName} returned non-JSON. Storing raw for manual review.`);
    return [];
  }
}

// ─── Cross-Model Synthesis ───────────────────────────────────────────────

function synthesizeFindings(allResults) {
  const allFindings = [];

  for (const result of allResults) {
    if (result.error) {
      console.log(`\n${c.red("✗")} ${result.model}: ${c.gray(result.error)}`);
      continue;
    }
    for (const finding of result.findings) {
      allFindings.push({ ...finding, source: result.shortName });
    }
  }

  const groups = [];
  const used = new Set();

  for (let i = 0; i < allFindings.length; i++) {
    if (used.has(i)) continue;
    const group = [allFindings[i]];
    used.add(i);

    for (let j = i + 1; j < allFindings.length; j++) {
      if (used.has(j)) continue;
      if (isSimilar(allFindings[i], allFindings[j])) {
        group.push(allFindings[j]);
        used.add(j);
      }
    }

    const sources = [...new Set(group.map(f => f.source))];
    const maxSeverity = getMaxSeverity(group.map(f => f.severity));
    const totalModels = [...new Set(allResults.filter(r => !r.error).map(r => r.shortName))].length;

    groups.push({
      id: groups.length + 1,
      title: group[0].title,
      severity: maxSeverity,
      category: group[0].category,
      location: group[0].location,
      problem: group[0].problem,
      fix: group[0].fix,
      agreedBy: sources,
      agreementLevel: sources.length >= Math.max(3, Math.ceil(totalModels * 0.6)) ? "ALL"
                    : sources.length >= 2 ? "MAJORITY"
                    : "SINGLE",
      variants: group.length > 1 ? group.map(f => ({ source: f.source, title: f.title, problem: f.problem })) : undefined,
    });
  }

  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const agreementOrder = { ALL: 0, MAJORITY: 1, SINGLE: 2 };

  groups.sort((a, b) => {
    const agr = agreementOrder[a.agreementLevel] - agreementOrder[b.agreementLevel];
    if (agr !== 0) return agr;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return groups;
}

function isSimilar(a, b) {
  if (a.category !== b.category) return false;
  const aWords = new Set(a.title.toLowerCase().split(/\s+/));
  const bWords = new Set(b.title.toLowerCase().split(/\s+/));
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w) && w.length > 3) overlap++;
  return overlap >= 2;
}

function getMaxSeverity(severities) {
  for (const s of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    if (severities.includes(s)) return s;
  }
  return "LOW";
}

// ─── Interactive Review ──────────────────────────────────────────────────

async function interactiveReview(synthesized) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  console.log("\n" + "═".repeat(80));
  console.log("  AIF FINDINGS — REVIEW EACH BEFORE FINALIZING");
  console.log("  For each finding, enter your evaluation:");
  console.log(`    ${c.green("v")} = VALID (will fix)`);
  console.log(`    ${c.gold("p")} = PARTIALLY VALID (needs nuance)`);
  console.log(`    ${c.gray("a")} = ALREADY FIXED`);
  console.log(`    ${c.yellow("d")} = DEFER (accept risk for now)`);
  console.log(`    ${c.red("r")} = REJECT (not a real issue)`);
  console.log(`    ${c.gray("s")} = SKIP (review later)`);
  console.log("═".repeat(80));

  const reviewed = [];

  for (const finding of synthesized) {
    const agreementIcon = finding.agreementLevel === "ALL" ? c.red("●") : finding.agreementLevel === "MAJORITY" ? c.yellow("●") : c.gray("●");
    const sevIcon = { CRITICAL: "🚨", HIGH: "⚠️", MEDIUM: "📋", LOW: "💡" }[finding.severity] || "📋";

    console.log(`\n${c.gray("-".repeat(80))}`);
    console.log(`${agreementIcon} #${finding.id} | ${sevIcon} ${c.bold(finding.severity)} | ${finding.category.toUpperCase()}`);
    console.log(`   ${c.bold("Title:")} ${finding.title}`);
    console.log(`   ${c.bold("Where:")} ${finding.location}`);
    console.log(`   ${c.bold("Agreed by:")} ${finding.agreedBy.join(" + ")} (${finding.agreementLevel})`);
    console.log(`   ${c.bold("Problem:")} ${finding.problem}`);
    console.log(`   ${c.bold("Fix:")} ${finding.fix}`);
    if (finding.variants) {
      console.log(`   ${c.gray(`[${finding.variants.length} models flagged variants of this]`)}`);
    }

    const answer = await ask(`\n   Your eval [${c.green("v")}/${c.gold("p")}/${c.gray("a")}/${c.yellow("d")}/${c.red("r")}/${c.gray("s")}]: `);
    const ev = (answer.trim().toLowerCase())[0];

    let evalLabel, note = "";
    switch (ev) {
      case "v": evalLabel = "VALID"; break;
      case "p":
        evalLabel = "PARTIALLY VALID";
        note = await ask("   Note (what's the nuance?): ");
        break;
      case "a": evalLabel = "ALREADY FIXED"; break;
      case "d": evalLabel = "DEFER"; break;
      case "r":
        evalLabel = "REJECT";
        note = await ask("   Note (why reject?): ");
        break;
      default: evalLabel = "SKIP";
    }

    reviewed.push({ ...finding, evaluation: evalLabel, note: note || undefined });
    console.log(`   → ${c.bold(evalLabel)}${note ? ` — ${note}` : ""}`);
  }

  rl.close();
  return reviewed;
}

// ─── Report Generation ───────────────────────────────────────────────────

function generateReport(reviewed, metadata, models) {
  const timestamp = new Date().toISOString().substring(0, 19).replace("T", " ");
  const validFindings = reviewed.filter(f => f.evaluation === "VALID" || f.evaluation === "PARTIALLY VALID");
  const fixNow = validFindings.filter(f => f.severity === "CRITICAL" || f.severity === "HIGH");
  const fixLater = validFindings.filter(f => f.severity === "MEDIUM" || f.severity === "LOW");
  const rejected = reviewed.filter(f => f.evaluation === "REJECT" || f.evaluation === "ALREADY FIXED");
  const deferred = reviewed.filter(f => f.evaluation === "DEFER");

  let md = `# AIF Review — ${metadata.target}
**Date:** ${timestamp}
**Models:** ${models.map(m => m.name).join(", ")}
**Target:** ${metadata.target}
**Chunks:** ${metadata.chunks}
**Total findings:** ${reviewed.length} (${validFindings.length} valid, ${rejected.length} rejected/fixed, ${deferred.length} deferred)

---

## FIX NOW (Valid CRITICAL + HIGH)

| # | Finding | Severity | Agreed By | Location | Fix |
|---|---------|----------|-----------|----------|-----|
`;
  for (const f of fixNow) md += `| ${f.id} | **${f.title}** | ${f.severity} | ${f.agreedBy.join("+")} | ${f.location} | ${f.fix} |\n`;
  if (!fixNow.length) md += "| — | No critical/high findings | — | — | — | — |\n";

  md += `\n## FIX LATER (Valid MEDIUM + LOW)

| # | Finding | Severity | Agreed By | Location | Fix |
|---|---------|----------|-----------|----------|-----|
`;
  for (const f of fixLater) md += `| ${f.id} | ${f.title} | ${f.severity} | ${f.agreedBy.join("+")} | ${f.location} | ${f.fix} |\n`;
  if (!fixLater.length) md += "| — | No medium/low findings | — | — | — | — |\n";

  md += `\n## REJECTED / ALREADY FIXED

| # | Finding | Evaluation | Note |
|---|---------|-----------|------|
`;
  for (const f of rejected) md += `| ${f.id} | ${f.title} | ${f.evaluation} | ${f.note || "—"} |\n`;

  md += `\n## DEFERRED

| # | Finding | Severity | Reason |
|---|---------|----------|--------|
`;
  for (const f of deferred) md += `| ${f.id} | ${f.title} | ${f.severity} | Accepted risk for now |\n`;

  md += `\n---

## All Findings Detail

`;
  for (const f of reviewed) {
    md += `### #${f.id}: ${f.title}
- **Severity:** ${f.severity} | **Category:** ${f.category}
- **Location:** ${f.location}
- **Agreed by:** ${f.agreedBy.join(", ")} (${f.agreementLevel})
- **Problem:** ${f.problem}
- **Fix:** ${f.fix}
- **Evaluation:** ${f.evaluation}${f.note ? ` — ${f.note}` : ""}

`;
  }

  md += `---
*Generated by [AIF Review](https://github.com/naveenbshastry/aif-review) — Adversarial Multi-Model Code Review by GoXero.*\n`;

  return md;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let targetDir = null;
  let targetFile = null;
  let extensions = null;
  let nonInteractive = false;
  let showConfig = false;
  let context = null;
  let outputDir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dir": targetDir = resolve(args[++i]); break;
      case "--file": targetFile = resolve(args[++i]); break;
      case "--ext": extensions = args[++i]; break;
      case "--non-interactive": nonInteractive = true; break;
      case "--config": showConfig = true; break;
      case "--context": context = args[++i]; break;
      case "--output": outputDir = resolve(args[++i]); break;
      case "--help": case "-h": printHelp(); process.exit(0);
    }
  }

  // Show config mode
  if (showConfig) {
    await runSetup();
    return;
  }

  // Validate input
  if (!targetDir && !targetFile) {
    console.log(BRAND);
    console.log(`  ${c.red("Error:")} Specify ${c.bold("--file")} or ${c.bold("--dir")} to review.\n`);
    printHelp();
    process.exit(1);
  }

  // Load config and find active models
  const config = loadConfig();
  const activeModels = getActiveModels(config);

  if (activeModels.length === 0) {
    console.log(BRAND);
    console.log(`  ${c.red("No API keys found!")}\n`);
    console.log(`  Copy ${c.bold(".env.example")} to ${c.bold(".env")} and add at least one key.`);
    console.log(`  Or run ${c.gold("npx aif-review --config")} for interactive setup.\n`);
    console.log(`  ${c.gray("Free providers (no credit card):")}`);
    for (const [, p] of Object.entries(PROVIDERS)) {
      if (p.free) console.log(`    ${c.green("→")} ${p.name}: ${c.gray(p.signup)}`);
    }
    process.exit(1);
  }

  const skippedModels = (config?.models || DEFAULT_MODELS).filter(m => {
    const provider = PROVIDERS[m.provider];
    return provider && !process.env[provider.keyEnv];
  });

  // Banner
  console.log(BRAND);
  if (skippedModels.length > 0) {
    console.log(`  ${c.yellow("⚠")} Skipping ${skippedModels.length} model(s) (missing keys): ${c.gray(skippedModels.map(m => m.shortName).join(", "))}`);
  }
  console.log(DIVIDER);
  console.log(`  ${c.gold(activeModels.length)} models loaded across ${c.gold([...new Set(activeModels.map(m => m.provider))].length)} providers`);
  console.log(`  ${activeModels.map(m => c.gray(m.shortName)).join(" · ")}`);
  console.log(DIVIDER);

  // Discover files
  let files;
  let targetLabel;

  if (targetFile) {
    files = [targetFile];
    targetLabel = basename(targetFile);
  } else {
    files = discoverFiles(targetDir, extensions);
    targetLabel = basename(targetDir);
  }

  if (files.length === 0) {
    console.log(`\n  ${c.red("No code files found.")} Use ${c.bold("--ext")} to specify extensions.\n`);
    process.exit(1);
  }

  console.log(SECTION(`Loading ${files.length} file(s)`));
  const baseDir = targetDir || process.cwd();
  for (const f of files.slice(0, 20)) console.log(`   ${c.gray(f.replace(baseDir + "/", ""))}`);
  if (files.length > 20) console.log(`   ${c.gray(`... and ${files.length - 20} more`)}`);

  const chunks = loadCode(files, baseDir);
  console.log(`  ${c.gray(`Split into ${chunks.length} chunk(s)`)}\n`);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(context || config?.context);

  // Dispatch to all models
  console.log(SECTION(`Dispatching to ${activeModels.length} models...\n`));

  const allResults = [];
  for (let ch = 0; ch < chunks.length; ch++) {
    const chunkLabel = chunks.length === 1 ? targetLabel : `${targetLabel} chunk ${ch + 1}/${chunks.length}`;

    const results = await Promise.all(
      activeModels.map(model => callModel(model, systemPrompt, chunks[ch], chunkLabel))
    );
    allResults.push(...results);
  }

  // Model results
  console.log("\n" + DIVIDER);
  console.log(SECTION("Model Results\n"));
  for (const r of allResults) {
    if (r.error) {
      console.log(`   ${c.red("✗")} ${r.model}: ${c.gray(r.error.substring(0, 100))}`);
    } else {
      console.log(`   ${c.green("✓")} ${c.bold(r.model)}: ${c.gold(r.findings.length)} findings ${c.gray(`(${r.elapsed}s, ${r.tokens} tok)`)}`);
    }
  }

  // Synthesize
  const synthesized = synthesizeFindings(allResults);
  console.log("\n" + DIVIDER);
  console.log(SECTION(`Synthesis — ${synthesized.length} unique findings\n`));
  const allAgree = synthesized.filter(f => f.agreementLevel === "ALL").length;
  const majAgree = synthesized.filter(f => f.agreementLevel === "MAJORITY").length;
  const singleOnly = synthesized.filter(f => f.agreementLevel === "SINGLE").length;
  console.log(`   ${c.red("●")} ALL agree:      ${allAgree}`);
  console.log(`   ${c.yellow("●")} MAJORITY agree: ${majAgree}`);
  console.log(`   ${c.gray("●")} SINGLE model:   ${singleOnly}`);

  // Interactive review prompt
  let reviewed;
  if (nonInteractive) {
    reviewed = synthesized.map(f => ({ ...f, evaluation: "SKIP" }));
    console.log(`\n  ⚡ Non-interactive mode: all findings saved for later review.`);
  } else if (synthesized.length > 0) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question(
      `\n  ${c.gold(`▸ ${synthesized.length} findings ready.`)} Start interactive review? [${c.bold("y")}/n]: `, r
    ));
    rl.close();
    if (answer.trim().toLowerCase() !== "n") {
      reviewed = await interactiveReview(synthesized);
    } else {
      reviewed = synthesized.map(f => ({ ...f, evaluation: "SKIP" }));
      console.log("  Saved for later. Re-run without --non-interactive to review.");
    }
  } else {
    reviewed = [];
  }

  // Generate report
  const report = generateReport(reviewed, { target: targetLabel, chunks: chunks.length }, activeModels);
  const dateStr = new Date().toISOString().substring(0, 10);
  const outFile = join(outputDir, `AIF-REVIEW-${targetLabel.toUpperCase().replace(/[^A-Z0-9]/g, "-")}-${dateStr}.md`);
  writeFileSync(outFile, report);

  const jsonFile = outFile.replace(".md", ".json");
  writeFileSync(jsonFile, JSON.stringify({
    metadata: { target: targetLabel, date: new Date().toISOString(), models: activeModels.map(m => m.name) },
    findings: reviewed,
  }, null, 2));

  console.log("\n" + DIVIDER);
  console.log(SECTION("Output\n"));
  console.log(`   ${c.gray("Markdown:")} ${outFile}`);
  console.log(`   ${c.gray("JSON:")}     ${jsonFile}`);

  const valid = reviewed.filter(f => f.evaluation === "VALID" || f.evaluation === "PARTIALLY VALID");
  console.log("\n" + DIVIDER);
  if (valid.length > 0) {
    console.log(`\n  ${c.red(`▸ ${valid.length} finding(s) marked VALID`)} — fix queue ready.`);
  } else if (reviewed.length > 0) {
    console.log(`\n  ${c.gold(`▸ ${reviewed.length} finding(s)`)} saved for review.`);
  } else {
    console.log(`\n  ${c.green("▸ All clear")} — code passed AIF review.`);
  }
  console.log(`\n${c.gray(`  AIF Review v1.0 · ${activeModels.length} models · ${dateStr}`)}\n`);
}

// ─── Setup Wizard ────────────────────────────────────────────────────────

async function runSetup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  console.log(BRAND);
  console.log(SECTION("Setup Wizard\n"));
  console.log("  AIF works with any LLM provider. You just need API keys.");
  console.log("  All free-tier providers work without a credit card.\n");

  let envLines = [];

  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const existing = process.env[provider.keyEnv];
    const freeTag = provider.free ? c.green(" [FREE]") : c.yellow(" [PAID]");
    const status = existing ? c.green("✓ configured") : c.gray("not set");

    console.log(`  ${c.bold(provider.name)}${freeTag} — ${status}`);
    console.log(`    Sign up: ${c.gray(provider.signup)}`);

    if (!existing) {
      const apiKey = await ask(`    Paste ${provider.name} API key (or Enter to skip): `);
      if (apiKey.trim()) {
        envLines.push(`${provider.keyEnv}=${apiKey.trim()}`);
        console.log(`    ${c.green("✓")} Saved\n`);
      } else {
        console.log(`    ${c.gray("→ Skipped")}\n`);
      }
    } else {
      console.log("");
    }
  }

  if (envLines.length > 0) {
    const envPath = join(process.cwd(), ".env");
    let envContent = "";
    if (existsSync(envPath)) {
      envContent = readFileSync(envPath, "utf-8") + "\n";
    }
    envContent += "# AIF Review API Keys\n" + envLines.join("\n") + "\n";
    writeFileSync(envPath, envContent);
    console.log(`\n  ${c.green("✓")} Saved ${envLines.length} key(s) to ${c.bold(".env")}`);
  }

  // Optional: project context
  console.log(SECTION("Project Context (optional)\n"));
  const ctx = await ask("  Describe your project in one sentence (helps models give better reviews)\n  > ");

  if (ctx.trim()) {
    const configPath = join(process.cwd(), "aif.config.json");
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
    config.context = ctx.trim();
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`\n  ${c.green("✓")} Saved to ${c.bold("aif.config.json")}`);
  }

  console.log(`\n${DIVIDER}`);
  console.log(`\n  ${c.green("Setup complete!")} Run your first review:\n`);
  console.log(`    ${c.gold("npx aif-review --file src/index.js")}`);
  console.log(`    ${c.gold("npx aif-review --dir src/ --ext .js,.ts")}\n`);

  rl.close();
}

// ─── Help ────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
  ${c.bold("Usage:")}

    ${c.gold("aif-review")} ${c.gray("[options]")}

  ${c.bold("Options:")}

    --file <path>        Review a single file
    --dir <path>         Review all code files in a directory (recursive)
    --ext <.js,.ts>      Filter files by extension (comma-separated)
    --context <text>     Project context for the AI reviewers
    --output <dir>       Output directory for reports (default: cwd)
    --non-interactive    Skip interactive triage, save all findings
    --config             Run the setup wizard
    -h, --help           Show this help

  ${c.bold("Examples:")}

    ${c.gray("# Review a single file")}
    npx aif-review --file src/server.js

    ${c.gray("# Review an entire project")}
    npx aif-review --dir ./src --ext .ts,.tsx

    ${c.gray("# With project context")}
    npx aif-review --dir ./src --context "Express REST API with PostgreSQL"

    ${c.gray("# Non-interactive (CI/CD)")}
    npx aif-review --dir ./src --non-interactive

  ${c.bold("Setup:")}

    ${c.gray("# Interactive setup wizard")}
    npx aif-review --config

    ${c.gray("# Or manually: copy .env.example to .env and add your keys")}

  ${c.gray("Free providers (no credit card):")}
    Groq       → console.groq.com/keys
    Cerebras   → cloud.cerebras.ai
    Mistral    → console.mistral.ai
    Gemini     → aistudio.google.com/apikey
    OpenRouter → openrouter.ai/settings/keys
`);
}

// ─── Entry ───────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`\n${c.red("Fatal:")} ${err.message}`);
  process.exit(1);
});
