#!/usr/bin/env node

import { runServer } from "../src/server.js";

runServer().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
