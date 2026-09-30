#!/usr/bin/env node

import { runCli } from "../src/runner.js";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
