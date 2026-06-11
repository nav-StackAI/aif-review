"""
aif_review.py — AIF (Adversarial Improvement Framework, DNA OP 27) runner v2.

Runs ONE document through ONE model with ONE review angle, and saves the
critique. Multi-model coverage = call it once per model.

Why v2 (vs run_aif.py): (1) raw HTTP, no SDKs — no `mistralai`/`groq` install
step, no SDK-version churn; (2) doc-agnostic — point --doc at anything;
(3) one-model-per-invocation — each call finishes well inside a 45s sandbox
cap (run_aif.py's parallel ThreadPool could blow past it); (4) bounded Gemini
thinking so a review can't run 40s+.

Lessons baked in from AIF_001-006:
  - Gemini errored repeatedly → use gemini-3.5-flash + maxOutputTokens 8000
    + a bounded thinkingBudget (a thinking model starved of tokens returns
    empty — the filled=0 class of bug).
  - Groq has a low TPM ceiling → truncate oversized docs before sending.
  - One model per process → a slow/failing model never blocks the others.

Usage:
  python3 aif_review.py --doc ../brand/GAMIFICATION.md --angle gamification --model gemini
  python3 aif_review.py --doc ../brand/GAMIFICATION.md --angle gamification --model mistral --run-id AIF_007
  python3 aif_review.py --doc ../brand/GAMIFICATION.md --angle gamification --model groq  --run-id AIF_007
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(SCRIPT_DIR, "..", ".env")
RUNS_DIR = os.path.join(SCRIPT_DIR, "runs")

# Load API keys from a .env if present (project root one dir up from the
# script, or the current working dir). If neither exists, fall back to keys
# already exported in the environment. setdefault means a real env var always
# wins over the file, and a missing file never crashes the run.
for _env in (ENV_PATH, os.path.join(os.getcwd(), ".env")):
    if not os.path.isfile(_env):
        continue
    for line in open(_env):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())
    break

# Groq's 70B free tier is ~12K TPM. Keep input well under that; truncate huge
# docs. GAMIFICATION.md is ~12K chars (~3K tokens) so this rarely fires.
MAX_DOC_CHARS = 32000

# ─── Review-angle prompts ─────────────────────────────────────────────────
ANGLES = {
    "gamification": """You are three reviewers in one, all hostile to hype: (a) a learning scientist (PhD, educational psychology — retrieval practice, motivation, competitive-exam prep); (b) a senior product designer who has shipped gamified consumer apps and seen them burn out; (c) a skeptical seasoned operator who has watched gamification kill serious products.

Below is the gamification design brief for Agny — an AI-tutored, pattern-based CAT (Indian MBA entrance) prep platform aimed at anxious 22-28-year-old self-paying working professionals. The brief claims to be "best-in-class, sober gamification — the chess.com of CAT, not the Duolingo."

Your job: find where this design is wrong, shallow, naive, or will fail in the real world. Be ruthless and specific — cite the actual sections, principles, and mechanics. Do NOT give generic praise or generic advice.

For each finding, structure as:
1. The finding (one sentence)
2. The specific section / principle / mechanic it concerns
3. Why it fails or is fragile (with reasoning or precedent)
4. What you'd change

Cover at minimum:
- Whether "sober gamification" actually retains an anxious exam aspirant, or whether it under-motivates compared to louder competitors
- Whether the four principles (competence-not-control, localized comparison, multi-track motivation, freedom-to-fail) are real and sufficient, or have gaps
- Whether "Modes" (Learn/Practice/Exam/Pressure, switchable mid-session) will work or will confuse, be gamed, or distort behaviour
- Whether the rating / leagues / improvement-delta will cause harmful anxiety despite the safeguards
- Whether the single "rating counts up" motion exception is principled or a slippery slope
- What is MISSING — mechanics or psychology the brief doesn't address that it should
- Whether the novelty claim ("first to bring this genre to CAT, done with restraint") is sound

End with: "If I were betting this gamification design fails to move retention or revenue, my single highest-conviction reason would be: ____"

DOCUMENT:
=========
{doc}
""",
    "generic": """You are a panel of ruthless, specific expert reviewers. Critique the document below — find what is wrong, shallow, fragile, or missing. Cite actual sections. No generic advice, no politeness.

For each finding: (1) the finding in one sentence, (2) the specific part of the document, (3) why it fails or is fragile, (4) what to change.

End with your single highest-conviction concern.

DOCUMENT:
=========
{doc}
""",
}


# ─── Model callers (raw HTTP) ─────────────────────────────────────────────
def _post(url, body, headers, timeout=90):
    # api.groq.com sits behind Cloudflare, whose WAF (error 1010) rejects the
    # default "Python-urllib/x.y" User-Agent — without an explicit UA every
    # Groq review 403s. In AIF_007 that 403 was misread as a dead API key;
    # it was the missing UA. Always send one. (See FAILURES.md.)
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "agny-aif/1.0 (adversarial-review-runner)",
            **headers,
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def call_gemini(prompt):
    key = os.environ["GEMINI_API_KEY"]
    model = "gemini-3.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 8000,
            # Bound thinking — a review needs some, but unbounded = 40s+.
            "thinkingConfig": {"thinkingBudget": 3000},
        },
    }
    data = _post(url, body, {})
    cand = (data.get("candidates") or [{}])[0]
    parts = (cand.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        raise RuntimeError(f"empty response (finishReason={cand.get('finishReason')})")
    return text, f"gemini/{model}"


def call_mistral(prompt):
    key = os.environ["MISTRAL_API_KEY"]
    # small-latest, not large — large can run >45s on a full doc and blow the
    # sandbox cap. Speed/reliability beats the marginal quality gain here.
    model = "mistral-small-latest"
    data = _post(
        "https://api.mistral.ai/v1/chat/completions",
        {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 4000},
        {"Authorization": f"Bearer {key}"},
    )
    return data["choices"][0]["message"]["content"].strip(), f"mistral/{model}"


def call_groq(prompt):
    key = os.environ["GROQ_API_KEY"]
    model = "llama-3.3-70b-versatile"
    data = _post(
        "https://api.groq.com/openai/v1/chat/completions",
        {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 3500},
        {"Authorization": f"Bearer {key}"},
    )
    return data["choices"][0]["message"]["content"].strip(), f"groq/{model}"


CALLERS = {"gemini": call_gemini, "mistral": call_mistral, "groq": call_groq}


def main():
    ap = argparse.ArgumentParser(description="AIF single-model review runner")
    ap.add_argument("--doc", required=True, help="path to the document to review")
    ap.add_argument("--angle", default="gamification", help=f"review angle: {list(ANGLES)}")
    ap.add_argument("--model", required=True, help=f"one of: {list(CALLERS)}")
    ap.add_argument("--run-id", default="", help="AIF_NNN run folder (default: auto next)")
    args = ap.parse_args()

    if args.model not in CALLERS:
        sys.exit(f"unknown model {args.model!r} — pick from {list(CALLERS)}")
    if args.angle not in ANGLES:
        sys.exit(f"unknown angle {args.angle!r} — pick from {list(ANGLES)}")

    doc = open(args.doc, encoding="utf-8").read()
    if len(doc) > MAX_DOC_CHARS:
        doc = doc[:MAX_DOC_CHARS] + "\n\n[... truncated for model token limit ...]"
        print(f"[note] doc truncated to {MAX_DOC_CHARS} chars", flush=True)
    prompt = ANGLES[args.angle].format(doc=doc)

    # Resolve run dir
    os.makedirs(RUNS_DIR, exist_ok=True)
    run_id = args.run_id
    if not run_id:
        existing = sorted(d for d in os.listdir(RUNS_DIR) if d.startswith("AIF_"))
        n = int(existing[-1].split("_")[1]) + 1 if existing else 1
        run_id = f"AIF_{n:03d}"
    run_dir = os.path.join(RUNS_DIR, run_id)
    os.makedirs(run_dir, exist_ok=True)

    tag = f"{args.model}_{args.angle}"
    print(f"AIF · {run_id} · {tag} · doc={os.path.basename(args.doc)} ({len(doc)} chars)", flush=True)
    t0 = time.time()
    try:
        text, model_str = CALLERS[args.model](prompt)
        elapsed = round(time.time() - t0, 1)
        header = (
            f"# AIF — {tag}\n\n"
            f"**Model:** {model_str}\n**Angle:** {args.angle}\n"
            f"**Doc:** {os.path.basename(args.doc)}\n**Elapsed:** {elapsed}s\n"
            f"**Timestamp:** {datetime.now(timezone.utc).isoformat()}\n\n---\n\n"
        )
        out = os.path.join(run_dir, f"{tag}.md")
        open(out, "w", encoding="utf-8").write(header + text)
        print(f"[OK] {tag} -> {out} ({elapsed}s, {len(text)} chars)", flush=True)
    except Exception as e:
        elapsed = round(time.time() - t0, 1)
        err = f"{type(e).__name__}: {str(e)[:300]}"
        out = os.path.join(run_dir, f"{tag}.ERROR.md")
        open(out, "w", encoding="utf-8").write(f"# AIF ERROR — {tag}\n\n{err}\n")
        print(f"[ERR] {tag} -> {err} ({elapsed}s)", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
