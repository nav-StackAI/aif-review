# AIF Review

**Adversarial Multi-Model Code Review**

Pit multiple LLMs against your code — or any document — simultaneously. Each model independently hunts for security vulnerabilities, reliability issues, performance problems, and architectural flaws. AIF cross-references their findings to surface what matters — issues flagged by multiple models get priority, noise from single models gets filtered.

Built and open-sourced by [GoXero](https://goxero.com).

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    ██████╗  ██████╗ ██╗  ██╗███████╗██████╗  ██████╗        ║
║   ██╔════╝ ██╔═══██╗╚██╗██╔╝██╔════╝██╔══██╗██╔═══██╗      ║
║   ██║  ███╗██║   ██║ ╚███╔╝ █████╗  ██████╔╝██║   ██║      ║
║   ██║   ██║██║   ██║ ██╔██╗ ██╔══╝  ██╔══██╗██║   ██║      ║
║   ╚██████╔╝╚██████╔╝██╔╝ ██╗███████╗██║  ██║╚██████╔╝      ║
║    ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝      ║
║                                                              ║
║   A R C H I T E C T U R E                                   ║
║   I M P A C T   F R A M E W O R K                           ║
║   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                           ║
║   Adversarial Multi-Model Code Review                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

## Why?

Every LLM has blind spots. GPT might miss a race condition that Claude catches. Gemini might flag a security issue that Llama overlooks. By running multiple models adversarially — each told to be *brutal* and find *every* weakness — you get coverage no single model provides.

AIF then cross-references the results: if 3 out of 5 models flag the same issue, it's probably real. If only one model flags something, it might be noise. You decide.

## Quick Start

```bash
# 1. Clone and enter
git clone https://github.com/naveenbshastry/aif-review.git
cd aif-review

# 2. Set up API keys (interactive wizard)
node aif-review.js --config

# 3. Review your code
node aif-review.js --file ../your-project/src/server.js
node aif-review.js --dir ../your-project/src/ --ext .js,.ts
```

**Zero dependencies.** Just Node.js 18+ and at least one API key.

## Supported Providers

| Provider | Free Tier | Signup | Models |
|----------|-----------|--------|--------|
| **Groq** | ✅ No CC | [console.groq.com/keys](https://console.groq.com/keys) | Llama 3.3 70B, Llama 4 Scout |
| **Cerebras** | ✅ No CC | [cloud.cerebras.ai](https://cloud.cerebras.ai) | Qwen3 235B, Llama 3.1 8B |
| **Mistral** | ✅ No CC | [console.mistral.ai](https://console.mistral.ai) | Mistral Small |
| **Google Gemini** | ✅ No CC | [aistudio.google.com](https://aistudio.google.com/apikey) | Gemini 2.5 Flash |
| **OpenRouter** | ✅ No CC | [openrouter.ai](https://openrouter.ai/settings/keys) | Llama 3.3 70B Free, Nemotron 120B |
| **Anthropic** | 💰 Paid | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Claude Sonnet 4 |
| **OpenAI** | 💰 Paid | [platform.openai.com](https://platform.openai.com/api-keys) | GPT-4o Mini |

**You only need one key to start.** More models = better cross-validation.

## How It Works

```
┌─────────────┐     ┌──────────┐     ┌──────────────────┐     ┌────────────┐
│  Your Code  │────▶│  Chunk   │────▶│  N Models (async) │────▶│  Synthesis │
│  (any lang) │     │  Splitter│     │  Each reviews     │     │  Dedup +   │
└─────────────┘     └──────────┘     │  independently    │     │  Agreement │
                                     └──────────────────┘     └─────┬──────┘
                                                                     │
                                                          ┌──────────▼──────────┐
                                                          │  Interactive Triage  │
                                                          │  v=valid p=partial   │
                                                          │  a=fixed d=defer     │
                                                          │  r=reject s=skip     │
                                                          └──────────┬──────────┘
                                                                     │
                                                          ┌──────────▼──────────┐
                                                          │  Markdown + JSON    │
                                                          │  Reports            │
                                                          └─────────────────────┘
```

1. **Load** — Reads your code files, auto-chunks if needed (80K token limit per chunk)
2. **Dispatch** — Sends each chunk to all configured models simultaneously
3. **Parse** — Extracts structured findings from each model's response
4. **Synthesize** — Deduplicates across models, identifies cross-model agreement
5. **Triage** — Interactive review: you evaluate each finding (VALID / REJECT / DEFER / etc.)
6. **Report** — Generates Markdown and JSON reports with prioritized fix lists

## Document Review (Python runner — AIF v2)

The framework matured beyond code: `aif_review.py` runs **any document** (a product brief, a design doc, a strategy memo) through an adversarial multi-model review. Same philosophy, hardened by real runs:

```bash
python3 aif_review.py --doc ./your-doc.md --angle generic --model gemini
python3 aif_review.py --doc ./your-doc.md --angle generic --model mistral --run-id AIF_007
python3 aif_review.py --doc ./your-doc.md --angle generic --model groq  --run-id AIF_007
```

**What v2 learned the hard way (lessons baked into the code):**

- **Raw HTTP, zero SDKs** — no install step, no SDK-version churn
- **One model per invocation** — a slow or failing model never blocks the others; each call stays inside tight sandbox/CI time caps
- **Bounded thinking budgets** — a thinking model starved of output tokens returns *empty*; give it a budget, cap the total
- **Send a real User-Agent** — Cloudflare's WAF silently 403s default Python user agents; that error is easy to misread as a dead API key
- **Respect free-tier TPM ceilings** — truncate oversized docs before sending

Review *angles* are prompt templates (see `ANGLES` in the script) — write your own for your domain. The included `gamification` angle is a real one used to stress-test a live product's design brief, included as an example of how specific an angle should be.

## Agreement Levels

- 🔴 **ALL** — 60%+ of models flagged this issue → high confidence, fix first
- 🟡 **MAJORITY** — 2+ models agree → worth investigating
- ⚪ **SINGLE** — Only one model flagged it → could be noise, use judgment

## Configuration

### Environment Variables (.env)

```bash
# Copy the example and add your keys
cp .env.example .env
```

### Custom Model Roster (aif.config.json)

Want to use different models? Create `aif.config.json`:

```json
{
  "context": "Express REST API with PostgreSQL, serving a React frontend",
  "models": [
    {
      "name": "Groq Llama 3.3 70B",
      "shortName": "Groq-70B",
      "provider": "groq",
      "model": "llama-3.3-70b-versatile",
      "maxTokens": 4096
    },
    {
      "name": "Claude Sonnet 4",
      "shortName": "Claude",
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "maxTokens": 4096
    }
  ]
}
```

Providers: `groq`, `cerebras`, `mistral`, `gemini`, `openrouter`, `anthropic`, `openai`

### Adding a Custom Provider

Edit the `PROVIDERS` object in `aif-review.js`:

```javascript
myProvider: {
  name: "My Provider",
  url: "https://api.myprovider.com/v1/chat/completions",
  keyEnv: "MY_PROVIDER_KEY",
  free: true,
  signup: "myprovider.com/keys",
  format: "openai",  // or "anthropic" for Anthropic-format APIs
},
```

## CLI Reference

```
aif-review [options]

  --file <path>        Review a single file
  --dir <path>         Review all code files in a directory (recursive)
  --ext <.js,.ts>      Filter files by extension (comma-separated)
  --context <text>     Project context for the AI reviewers
  --output <dir>       Output directory for reports (default: cwd)
  --non-interactive    Skip interactive triage, save all findings
  --config             Run the setup wizard
  -h, --help           Show help
```

## CI/CD Integration

```yaml
# GitHub Actions example
- name: AIF Code Review
  run: |
    node aif-review.js --dir ./src --ext .js,.ts --non-interactive
  env:
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Example Output

```
▸ Synthesis — 24 unique findings

   ● ALL agree:      2
   ● MAJORITY agree: 5
   ● SINGLE model:   17

  ▸ 24 findings ready. Start interactive review? [y/n]: y

────────────────────────────────────────────
● #1 | 🚨 CRITICAL | SECURITY
   Title: SQL Injection in /users endpoint
   Where: server.js:17-19
   Agreed by: Groq-Llama70 + Claude + Gemini (ALL)
   Problem: User input directly interpolated into SQL query
   Fix: Use parameterized queries

   Your eval [v/p/a/d/r/s]: v
   → VALID
```

## License

MIT — use it however you want.

## Credits

Built by [Nav Shastry](https://github.com/naveenbshastry) at [GoXero](https://goxero.com).

Born from the real need to review production code when you're a solo founder and your codebase doesn't fit in any single model's context window.
