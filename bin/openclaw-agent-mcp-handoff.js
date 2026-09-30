#!/usr/bin/env node

import { runHandoffCli } from "../src/handoff.js";

runHandoffCli(process.argv.slice(2)).catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
