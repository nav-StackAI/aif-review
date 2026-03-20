#!/usr/bin/env node
// Shortcut for: npx aif-review --config
process.argv.push("--config");
await import("./aif-review.js");
