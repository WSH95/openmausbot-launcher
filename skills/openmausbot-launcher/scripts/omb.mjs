#!/usr/bin/env node
// openmausbot-launcher driver. One executable entry point; the work lives in
// ./lib. Stdout is one JSON object, or one line with --brief.
import { run } from "./lib/cli.mjs";
import "./lib/verbs/lifecycle.mjs";
import "./lib/verbs/repo.mjs";
import "./lib/verbs/team.mjs";
import "./lib/verbs/run.mjs";
import "./lib/verbs/state.mjs";

const { code, output } = await run(process.argv.slice(2));
if (output !== undefined && output !== "") process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
process.exitCode = code;
