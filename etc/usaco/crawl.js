#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const zlib = require("node:zlib");

const DEFAULT_BASE_URL = "https://usaco.org/index.php?page=training";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_OUTPUT_FORMAT = "metadata";
const DEFAULT_METADATA_OUTPUT_PATH = "etc/usaco/usaco-training.json";
const DEFAULT_QDUOJ_OUTPUT_PATH = "etc/usaco/usaco-qduoj-import.zip";
const DEFAULT_QDUOJ_RULE_TYPE = "ACM";
const DEFAULT_TIME_LIMIT_MS = 2000;
const DEFAULT_MEMORY_LIMIT_MB = 256;
const SITE_ORIGIN = "https://usaco.org/";

const QDUOJ_TEMPLATES = Object.freeze({
  "C++": {
    prepend: "#include <bits/stdc++.h>\nusing namespace std;",
    template:
      "int main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  return 0;\n}",
    append: "",
  },
  Java: {
    prepend: "import java.io.*;\nimport java.util.*;\n\npublic class Main {",
    template:
      "  public static void main(String[] args) throws Exception {\n    BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n    StringBuilder out = new StringBuilder();\n\n    System.out.print(out);\n  }",
    append: "}",
  },
  Python3: {
    prepend: "import sys",
    template:
      "def main() -> None:\n    input = sys.stdin.readline\n\n\nif __name__ == '__main__':\n    main()",
    append: "",
  },
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${buildHelpText()}\n`);
    return;
  }

  let resolvedOptions = options.tui ? await runTui(options) : options;
  if (resolvedOptions == null) {
    process.stderr.write("Cancelled.\n");
    return;
  }

  resolvedOptions = normalizeExecutionOptions(resolvedOptions);

  const crawler = new UsacoTrainingCrawler(resolvedOptions);
  const result = await crawler.crawl();
  const outputInfo = await emitResult(result, resolvedOptions, crawler);

  if (resolvedOptions.tui) {
    const summary = summarizeResult(result);
    process.stderr.write(
      [
        "",
        "Crawl finished.",
        `Format: ${resolvedOptions.outputFormat}`,
        `Output: ${formatOutputPath(outputInfo.outputPath)}`,
        `Seasons: ${summary.seasons}`,
        `Contests: ${summary.contests}`,
        `Divisions: ${summary.divisions}`,
        `Problems: ${summary.problems}`,
        "",
      ].join("\n"),
    );
  }
}

function normalizeExecutionOptions(options) {
  const normalized = {
    ...options,
    outputFormat: normalizeOutputFormat(options.outputFormat ?? DEFAULT_OUTPUT_FORMAT),
    qduojRuleType: normalizeQduojRuleType(
      options.qduojRuleType ?? DEFAULT_QDUOJ_RULE_TYPE,
    ),
  };

  if (normalized.outputFormat === "qduoj") {
    normalized.includeStatements = true;
    if (normalized.outputPath == null) {
      normalized.outputPath = DEFAULT_QDUOJ_OUTPUT_PATH;
    }
  }

  return normalized;
}

async function emitResult(result, options, crawler) {
  if (options.outputFormat === "qduoj") {
    return buildQduojPackage(result, options, crawler);
  }

  const serialized = JSON.stringify(result, null, 2);

  if (options.outputPath) {
    const absoluteOutputPath = path.resolve(process.cwd(), options.outputPath);
    await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await fs.writeFile(absoluteOutputPath, `${serialized}\n`, "utf8");
    process.stderr.write(`Saved crawl result to ${absoluteOutputPath}\n`);
    return {
      outputPath: absoluteOutputPath,
    };
  }

  process.stdout.write(`${serialized}\n`);
  return {
    outputPath: null,
  };
}

async function buildQduojPackage(result, options, crawler) {
  const outputPath = path.resolve(process.cwd(), options.outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const packageWriter = new ZipArchiveWriter(outputPath);
  const problemTargets = flattenProblemTargets(result);

  try {
    for (const [index, target] of problemTargets.entries()) {
      const current = index + 1;
      process.stderr.write(
        `[qduoj ${current}/${problemTargets.length}] ${target.problem.title}\n`,
      );

      if (!target.problem.testDataUrl) {
        throw new Error(
          `Missing test data URL for ${target.problem.title} (${target.problem.url})`,
        );
      }

      if (!target.problem.problemPage?.structured) {
        throw new Error(
          `Missing parsed problem statement for ${target.problem.title}. QDUOJ export requires statement parsing.`,
        );
      }

      const testDataBuffer = await crawler.fetchBinary(target.problem.testDataUrl);
      const testCases = extractSequentialTestCasesFromZip(testDataBuffer);
      const problemJson = buildQduojProblemJson(
        target,
        testCases,
        options.qduojRuleType,
      );

      await packageWriter.addFile(
        `${current}/problem.json`,
        Buffer.from(`${JSON.stringify(problemJson, null, 2)}\n`, "utf8"),
      );

      for (const testCase of testCases) {
        await packageWriter.addFile(
          `${current}/testcase/${testCase.name}`,
          testCase.data,
        );
      }
    }
  } finally {
    await packageWriter.close();
  }

  process.stderr.write(`Saved QDUOJ import package to ${outputPath}\n`);
  return {
    outputPath,
  };
}

function flattenProblemTargets(result) {
  const problemTargets = [];

  for (const season of result.seasons) {
    for (const contest of season.contests) {
      for (const division of contest.divisions) {
        for (const problem of division.problems) {
          problemTargets.push({
            season,
            contest,
            division,
            problem,
          });
        }
      }
    }
  }

  return problemTargets;
}

function buildQduojProblemJson(target, testCases, qduojRuleType) {
  const structured = target.problem.problemPage.structured;

  return {
    display_id: buildQduojDisplayId(target.problem),
    title:
      target.problem.problemTitleFromProblemPage ??
      target.problem.title ??
      `USACO ${target.problem.cpid ?? ""}`.trim(),
    description: {
      format: "html",
      value: structured.descriptionHtml || "<p></p>",
    },
    input_description: {
      format: "html",
      value: structured.inputHtml || "<p></p>",
    },
    output_description: {
      format: "html",
      value: structured.outputHtml || "<p></p>",
    },
    hint: {
      format: "html",
      value: buildQduojHintHtml(structured.hintHtml, target.problem),
    },
    test_case_score: buildQduojTestCaseScore(testCases, qduojRuleType),
    time_limit: structured.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
    memory_limit: structured.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB,
    samples: structured.samples,
    template: QDUOJ_TEMPLATES,
    spj: null,
    rule_type: qduojRuleType,
    source: buildQduojSource(target),
    answers: [],
    tags: buildQduojTags(target),
  };
}

function buildQduojDisplayId(problem) {
  const rawId =
    problem.cpid != null
      ? `usaco-${problem.cpid}`
      : `usaco-${problem.order ?? "x"}`;

  return rawId.slice(0, 24);
}

function buildQduojTestCaseScore(testCases, qduojRuleType) {
  const pairs = [];

  for (let index = 0; index < testCases.length; index += 2) {
    const inputCase = testCases[index];
    const outputCase = testCases[index + 1];

    if (!inputCase || !outputCase) {
      throw new Error("Test case list does not contain complete input/output pairs");
    }

    pairs.push({
      input_name: inputCase.name,
      output_name: outputCase.name,
      score: qduojRuleType === "OI" ? 1 : 100,
    });
  }

  return pairs;
}

function buildQduojSource(target) {
  const parts = [
    "USACO",
    target.season.name,
    target.contest.label,
    target.division.name,
  ];

  return parts.join(" | ").slice(0, 200);
}

function buildQduojTags(target) {
  return uniqueCompact([
    "USACO",
    target.season.name,
    target.contest.label.replace(/\s+Results$/i, ""),
    target.division.name,
  ]);
}

function buildQduojHintHtml(baseHintHtml, problem) {
  const base = baseHintHtml || "<p></p>";
  const links = [];

  if (problem.url) {
    links.push(
      `<li><a href="${escapeHtmlAttribute(problem.url)}">Original problem page</a></li>`,
    );
  }
  if (problem.solutionUrl) {
    links.push(
      `<li><a href="${escapeHtmlAttribute(problem.solutionUrl)}">Official solution</a></li>`,
    );
  }
  if (problem.testDataUrl) {
    links.push(
      `<li><a href="${escapeHtmlAttribute(problem.testDataUrl)}">Official test data</a></li>`,
    );
  }

  const footer = links.length
    ? `<hr/><p><strong>USACO links</strong></p><ul>${links.join("")}</ul>`
    : "";

  return `${base}${footer}`;
}

async function runTui(initialOptions) {
  const options = {
    ...initialOptions,
    outputFormat: normalizeOutputFormat(
      initialOptions.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    ),
    qduojRuleType: normalizeQduojRuleType(
      initialOptions.qduojRuleType ?? DEFAULT_QDUOJ_RULE_TYPE,
    ),
    outputPath:
      initialOptions.outputPath ??
      getDefaultOutputPathForFormat(
        initialOptions.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      ),
  };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      renderTui(options);
      const answer = normalizeAnswer(
        await rl.question("Select an action [1-10]: "),
      );

      if (answer === "1") {
        const previousFormat = options.outputFormat;
        options.outputFormat = await promptOutputFormat(rl, options.outputFormat);
        if (
          options.outputPath == null ||
          options.outputPath === getDefaultOutputPathForFormat(previousFormat)
        ) {
          options.outputPath = getDefaultOutputPathForFormat(options.outputFormat);
        }
        continue;
      }

      if (answer === "2") {
        options.outputPath = await promptOutputPath(
          rl,
          options.outputPath,
          options.outputFormat,
        );
        continue;
      }

      if (answer === "3") {
        if (options.outputFormat === "qduoj") {
          await pauseTui(
            rl,
            "QDUOJ export always fetches full problem statements. Press Enter to continue.",
          );
          continue;
        }

        options.includeStatements = await promptBoolean(
          rl,
          "Include full problem statements?",
          options.includeStatements,
        );
        continue;
      }

      if (answer === "4") {
        options.qduojRuleType = await promptQduojRuleType(
          rl,
          options.qduojRuleType,
        );
        continue;
      }

      if (answer === "5") {
        options.seasonLimit = await promptOptionalPositiveInteger(
          rl,
          "Season limit",
          options.seasonLimit,
        );
        continue;
      }

      if (answer === "6") {
        options.contestLimit = await promptOptionalPositiveInteger(
          rl,
          "Contest limit",
          options.contestLimit,
        );
        continue;
      }

      if (answer === "7") {
        options.concurrency = await promptPositiveInteger(
          rl,
          "Concurrency",
          options.concurrency,
        );
        continue;
      }

      if (answer === "8") {
        options.baseUrl = await promptUrl(rl, "Base URL", options.baseUrl);
        continue;
      }

      if (answer === "9") {
        if (process.stdout.isTTY) {
          console.clear();
        }
        process.stdout.write("Starting crawl...\n\n");
        return options;
      }

      if (answer === "10") {
        return null;
      }

      await pauseTui(rl, "Unknown selection. Press Enter to continue.");
    }
  } finally {
    rl.close();
  }
}

function renderTui(options) {
  const includeStatementsLabel =
    options.outputFormat === "qduoj"
      ? "forced by qduoj"
      : formatBoolean(options.includeStatements);
  const tip =
    options.outputFormat === "qduoj"
      ? "Tip: QDUOJ export writes an importable zip package. Use season/contest limits to keep package size manageable."
      : 'Tip: enter "stdout" as the output path to print JSON to the terminal.';
  const lines = [
    "USACO crawler TUI",
    "",
    `1. Output format      : ${options.outputFormat}`,
    `2. Output path        : ${formatOutputPath(options.outputPath)}`,
    `3. Include statements : ${includeStatementsLabel}`,
    `4. QDUOJ rule type    : ${options.qduojRuleType}`,
    `5. Season limit       : ${formatOptionalNumber(options.seasonLimit)}`,
    `6. Contest limit      : ${formatOptionalNumber(options.contestLimit)}`,
    `7. Concurrency        : ${options.concurrency}`,
    `8. Base URL           : ${options.baseUrl}`,
    "9. Run crawl",
    "10. Quit",
    "",
    tip,
    "",
  ];

  if (process.stdout.isTTY) {
    console.clear();
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function promptOutputFormat(rl, currentValue) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(`Output format [${currentValue}] (metadata/qduoj): `),
    );

    if (!answer) {
      return currentValue;
    }

    try {
      return normalizeOutputFormat(answer);
    } catch (error) {
      await pauseTui(rl, `${error.message} Press Enter to continue.`);
    }
  }
}

async function promptOutputPath(rl, currentValue, outputFormat) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(
        outputFormat === "qduoj"
          ? `Output path [${formatOutputPath(currentValue)}] (.zip recommended): `
          : `Output path [${formatOutputPath(currentValue)}] (stdout=print to screen): `,
      ),
    );

    if (!answer) {
      return currentValue;
    }

    if (outputFormat !== "qduoj" && answer.toLowerCase() === "stdout") {
      return null;
    }

    if (outputFormat === "qduoj" && answer.toLowerCase() === "stdout") {
      await pauseTui(
        rl,
        "QDUOJ export cannot write a binary zip to stdout. Press Enter to continue.",
      );
      continue;
    }

    return answer;
  }
}

async function promptBoolean(rl, label, currentValue) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(`${label} [${currentValue ? "Y/n" : "y/N"}]: `),
    );

    if (!answer) {
      return currentValue;
    }

    if (/^(y|yes)$/i.test(answer)) {
      return true;
    }

    if (/^(n|no)$/i.test(answer)) {
      return false;
    }

    await pauseTui(rl, "Please answer with y or n. Press Enter to continue.");
  }
}

async function promptQduojRuleType(rl, currentValue) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(`QDUOJ rule type [${currentValue}] (ACM/OI): `),
    );

    if (!answer) {
      return currentValue;
    }

    try {
      return normalizeQduojRuleType(answer);
    } catch (error) {
      await pauseTui(rl, `${error.message} Press Enter to continue.`);
    }
  }
}

async function promptOptionalPositiveInteger(rl, label, currentValue) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(
        `${label} [${formatOptionalNumber(currentValue)}] (number/all): `,
      ),
    );

    if (!answer) {
      return currentValue;
    }

    if (answer.toLowerCase() === "all") {
      return null;
    }

    try {
      return parsePositiveInteger(answer, label);
    } catch (error) {
      await pauseTui(rl, `${error.message} Press Enter to continue.`);
    }
  }
}

async function promptPositiveInteger(rl, label, currentValue) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(`${label} [${currentValue}]: `),
    );

    if (!answer) {
      return currentValue;
    }

    try {
      return parsePositiveInteger(answer, label);
    } catch (error) {
      await pauseTui(rl, `${error.message} Press Enter to continue.`);
    }
  }
}

async function promptUrl(rl, label, currentValue) {
  while (true) {
    const answer = normalizeAnswer(
      await rl.question(`${label} [${currentValue}]: `),
    );

    if (!answer) {
      return currentValue;
    }

    try {
      return new URL(answer).toString();
    } catch {
      await pauseTui(rl, "Please enter a valid URL. Press Enter to continue.");
    }
  }
}

async function pauseTui(rl, message) {
  await rl.question(`${message}\n`);
}

function normalizeAnswer(value) {
  return String(value ?? "").trim();
}

function normalizeOutputFormat(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "metadata" || normalized === "json") {
    return "metadata";
  }

  if (normalized === "qduoj" || normalized === "qduoj-zip") {
    return "qduoj";
  }

  throw new Error("Output format must be metadata or qduoj");
}

function normalizeQduojRuleType(value) {
  const normalized = String(value ?? "").trim().toUpperCase();

  if (normalized === "ACM" || normalized === "OI") {
    return normalized;
  }

  throw new Error("QDUOJ rule type must be ACM or OI");
}

function getDefaultOutputPathForFormat(outputFormat) {
  return outputFormat === "qduoj"
    ? DEFAULT_QDUOJ_OUTPUT_PATH
    : DEFAULT_METADATA_OUTPUT_PATH;
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

function formatOptionalNumber(value) {
  return value == null ? "all" : String(value);
}

function formatOutputPath(value) {
  return value == null ? "stdout" : value;
}

function summarizeResult(result) {
  let contests = 0;
  let divisions = 0;
  let problems = 0;

  for (const season of result.seasons) {
    contests += season.contests.length;

    for (const contest of season.contests) {
      divisions += contest.divisions.length;

      for (const division of contest.divisions) {
        problems += division.problems.length;
      }
    }
  }

  return {
    seasons: result.seasons.length,
    contests,
    divisions,
    problems,
  };
}

class UsacoTrainingCrawler {
  constructor(options) {
    this.options = options;
    this.htmlCache = new Map();
  }

  async crawl() {
    const trainingHtml = await this.fetchHtml(this.options.baseUrl);
    const parsedTrainingPage = parseTrainingPage(trainingHtml, this.options.baseUrl);
    const limitedSeasons = limitSeasons(
      parsedTrainingPage.seasons,
      this.options.seasonLimit,
      this.options.contestLimit,
    );
    const contests = limitedSeasons.flatMap((season) => season.contests);

    await mapLimit(contests, this.options.concurrency, async (contest, index) => {
      process.stderr.write(
        `[contest ${index + 1}/${contests.length}] ${contest.label}\n`,
      );

      const contestHtml = await this.fetchHtml(contest.url);
      const contestDetails = parseContestPage(contestHtml, contest.url);
      Object.assign(contest, contestDetails);
    });

    const shouldFetchProblemPages =
      this.options.includeStatements || this.options.outputFormat === "qduoj";

    if (shouldFetchProblemPages) {
      const problemTargets = contests.flatMap((contest) =>
        contest.divisions.flatMap((division) =>
          division.problems.map((problem) => ({
            contest,
            division,
            problem,
          })),
        ),
      );

      await mapLimit(
        problemTargets,
        this.options.concurrency,
        async ({ problem }, index) => {
          process.stderr.write(
            `[problem ${index + 1}/${problemTargets.length}] ${problem.title}\n`,
          );

          const problemHtml = await this.fetchHtml(problem.url);
          const problemDetails = parseProblemPage(problemHtml, problem.url);
          Object.assign(problem, problemDetails);
        },
      );
    }

    return {
      fetchedAt: new Date().toISOString(),
      source: {
        trainingPage: this.options.baseUrl,
        siteOrigin: SITE_ORIGIN,
      },
      options: {
        outputFormat: this.options.outputFormat,
        includeStatements: shouldFetchProblemPages,
        qduojRuleType:
          this.options.outputFormat === "qduoj" ? this.options.qduojRuleType : null,
        concurrency: this.options.concurrency,
        seasonLimit: this.options.seasonLimit,
        contestLimit: this.options.contestLimit,
      },
      resources: parsedTrainingPage.resources,
      seasons: limitedSeasons,
    };
  }

  async fetchHtml(url, attempt = 1) {
    if (this.htmlCache.has(url)) {
      return this.htmlCache.get(url);
    }

    const promise = this.fetchTextWithRetry(url, attempt).catch((error) => {
      this.htmlCache.delete(url);
      throw error;
    });

    this.htmlCache.set(url, promise);
    return promise;
  }

  async fetchBinary(url, attempt = 1) {
    return this.fetchBufferWithRetry(url, attempt);
  }

  async fetchTextWithRetry(url, attempt) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; usaco-training-crawler/1.0; +https://usaco.org/)",
          accept: "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response.text();
    } catch (error) {
      if (attempt >= 3) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }

      await sleep(300 * attempt);
      return this.fetchTextWithRetry(url, attempt + 1);
    }
  }

  async fetchBufferWithRetry(url, attempt) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; usaco-training-crawler/1.0; +https://usaco.org/)",
          accept: "*/*",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }

      await sleep(300 * attempt);
      return this.fetchBufferWithRetry(url, attempt + 1);
    }
  }
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    concurrency: DEFAULT_CONCURRENCY,
    contestLimit: null,
    seasonLimit: null,
    includeStatements: false,
    outputPath: null,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    qduojRuleType: DEFAULT_QDUOJ_RULE_TYPE,
    help: false,
    tui: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--include-statements") {
      options.includeStatements = true;
      continue;
    }

    if (argument === "--tui") {
      options.tui = true;
      continue;
    }

    if (argument === "--output") {
      index += 1;
      options.outputPath = requireOptionValue(argv, index, "--output");
      continue;
    }

    if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
      continue;
    }

    if (argument === "--output-format" || argument === "--format") {
      index += 1;
      options.outputFormat = normalizeOutputFormat(
        requireOptionValue(argv, index, argument),
      );
      continue;
    }

    if (argument.startsWith("--output-format=")) {
      options.outputFormat = normalizeOutputFormat(
        argument.slice("--output-format=".length),
      );
      continue;
    }

    if (argument.startsWith("--format=")) {
      options.outputFormat = normalizeOutputFormat(
        argument.slice("--format=".length),
      );
      continue;
    }

    if (argument === "--qduoj-rule-type") {
      index += 1;
      options.qduojRuleType = normalizeQduojRuleType(
        requireOptionValue(argv, index, "--qduoj-rule-type"),
      );
      continue;
    }

    if (argument.startsWith("--qduoj-rule-type=")) {
      options.qduojRuleType = normalizeQduojRuleType(
        argument.slice("--qduoj-rule-type=".length),
      );
      continue;
    }

    if (argument === "--base-url") {
      index += 1;
      options.baseUrl = requireOptionValue(argv, index, "--base-url");
      continue;
    }

    if (argument.startsWith("--base-url=")) {
      options.baseUrl = argument.slice("--base-url=".length);
      continue;
    }

    if (argument === "--concurrency") {
      index += 1;
      options.concurrency = parsePositiveInteger(
        requireOptionValue(argv, index, "--concurrency"),
        "--concurrency",
      );
      continue;
    }

    if (argument.startsWith("--concurrency=")) {
      options.concurrency = parsePositiveInteger(
        argument.slice("--concurrency=".length),
        "--concurrency",
      );
      continue;
    }

    if (argument === "--contest-limit") {
      index += 1;
      options.contestLimit = parsePositiveInteger(
        requireOptionValue(argv, index, "--contest-limit"),
        "--contest-limit",
      );
      continue;
    }

    if (argument.startsWith("--contest-limit=")) {
      options.contestLimit = parsePositiveInteger(
        argument.slice("--contest-limit=".length),
        "--contest-limit",
      );
      continue;
    }

    if (argument === "--season-limit") {
      index += 1;
      options.seasonLimit = parsePositiveInteger(
        requireOptionValue(argv, index, "--season-limit"),
        "--season-limit",
      );
      continue;
    }

    if (argument.startsWith("--season-limit=")) {
      options.seasonLimit = parsePositiveInteger(
        argument.slice("--season-limit=".length),
        "--season-limit",
      );
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

function buildHelpText() {
  return [
    "USACO training page crawler",
    "",
    "Usage:",
    "  node etc/usaco/crawl.js [options]",
    "",
    "Options:",
    "  --tui                     Open a simple interactive terminal UI",
    "  --output-format <type>    metadata or qduoj (default: metadata)",
    "  --qduoj-rule-type <type>  ACM or OI for QDUOJ export (default: ACM)",
    "  --output <path>           Save output to a file",
    "  --include-statements      Also fetch every problem page and include its statement",
    "  --concurrency <n>         Max number of parallel HTTP requests (default: 4)",
    "  --season-limit <n>        Only keep the first N seasons from the training page",
    "  --contest-limit <n>       Only keep the first N contests across all seasons",
    "  --base-url <url>          Override the training page URL",
    "  --help                    Print this help text",
  ].join("\n");
}

function parseTrainingPage(html, baseUrl) {
  const resources = [];
  const guideMatch = html.match(
    /new on-line training resource: the <a href="([^"]+)">([^<]+)<\/a>/i,
  );
  if (guideMatch) {
    resources.push({
      title: cleanText(guideMatch[2]),
      url: resolveUrl(guideMatch[1], baseUrl),
    });
  }

  const legacyMatch = html.match(
    /legacy USACO <a href="([^"]+)">([^<]+)<\/a>/i,
  );
  if (legacyMatch) {
    resources.push({
      title: cleanText(legacyMatch[2]),
      url: resolveUrl(legacyMatch[1], baseUrl),
    });
  }

  const seasons = [];
  const seasonPattern =
    /<h3>\s*([^<]+?)\s*<\/h3>\s*([\s\S]*?)(?=<h3>|<\/div>\s*<\/div>)/gi;

  for (const match of html.matchAll(seasonPattern)) {
    const seasonName = cleanText(match[1]).replace(/:\s*$/, "");
    const seasonBlock = match[2];
    const contests = [];
    const contestPattern =
      /<p>\s*<a href=['"]([^'"]+)['"]>([\s\S]*?)<\/a>\.?\s*<\/p>/gi;

    for (const contestMatch of seasonBlock.matchAll(contestPattern)) {
      const url = resolveUrl(contestMatch[1], baseUrl);
      const page = extractPageId(url);

      contests.push({
        label: cleanText(contestMatch[2]),
        url,
        page,
      });
    }

    seasons.push({
      name: seasonName,
      contests,
    });
  }

  return { resources, seasons };
}

function parseContestPage(html, contestUrl) {
  const headers = [...html.matchAll(/<h2>\s*([\s\S]*?)\s*<\/h2>/gi)]
    .map((match) => cleanText(stripTags(match[1])))
    .filter(Boolean);
  const contestTitle = headers[0] ?? null;

  const divisions = [];
  const divisionPattern =
    /<h2>\s*<img[^>]*\/>\s*([^<]+?)<\/h2>\s*([\s\S]*?)(?=<h2>\s*<img|<h3>\s*Final Remarks|<\/div>\s*<\/div>)/gi;

  for (const divisionMatch of html.matchAll(divisionPattern)) {
    const divisionTitle = cleanText(divisionMatch[1]);
    const divisionBody = divisionMatch[2];
    const divisionSummaryMatch = divisionBody.match(/<p>\s*([\s\S]*?)<\/p>/i);
    const problemBlocks = [
      ...divisionBody.matchAll(
        /<div class=['"]panel historypanel['"]>([\s\S]*?)(?=<div class=['"]panel historypanel['"]>|$)/gi,
      ),
    ];

    divisions.push({
      name: extractDivisionName(divisionTitle),
      title: divisionTitle,
      summary: divisionSummaryMatch
        ? cleanText(htmlToText(divisionSummaryMatch[1]))
        : null,
      problems: problemBlocks.map((problemBlockMatch) =>
        parseProblemCard(problemBlockMatch[1], contestUrl),
      ),
    });
  }

  return {
    contestTitle,
    divisions,
  };
}

function parseProblemCard(problemBlockHtml, contestUrl) {
  const orderMatch = problemBlockHtml.match(/<h1[^>]*>\s*(\d+)\s*<\/h1>/i);
  const titleMatch = problemBlockHtml.match(/<b>([\s\S]*?)<\/b>/i);
  const links = [
    ...problemBlockHtml.matchAll(/<a href=['"]([^'"]+)['"]>\s*([^<]+)\s*<\/a>/gi),
  ];

  const problemLink = links.find(
    (match) => cleanText(match[2]).toLowerCase() === "view problem",
  );
  const testDataLink = links.find(
    (match) => cleanText(match[2]).toLowerCase() === "test data",
  );
  const solutionLink = links.find(
    (match) => cleanText(match[2]).toLowerCase() === "solution",
  );

  const url = problemLink ? resolveUrl(problemLink[1], contestUrl) : null;

  return {
    order: orderMatch ? Number.parseInt(orderMatch[1], 10) : null,
    title: titleMatch ? cleanText(titleMatch[1]) : null,
    url,
    cpid: url ? extractCpid(url) : null,
    testDataUrl: testDataLink ? resolveUrl(testDataLink[1], contestUrl) : null,
    solutionUrl: solutionLink ? resolveUrl(solutionLink[1], contestUrl) : null,
  };
}

function parseProblemPage(html, problemUrl) {
  const headers = [...html.matchAll(/<h2>\s*([\s\S]*?)\s*<\/h2>/gi)]
    .map((match) => cleanText(stripTags(match[1])))
    .filter(Boolean);

  const contestTitle = headers[0] ?? null;
  const problemHeader = headers[1] ?? null;
  const problemHeaderMatch = problemHeader
    ? problemHeader.match(/^Problem\s+(\d+)\.\s*(.+)$/i)
    : null;

  const statementMatch = html.match(
    /<span id="probtext-text" class="mathjax">([\s\S]*?)<\/span>/i,
  );
  const statementHtml = statementMatch ? statementMatch[1].trim() : null;
  const statementText = statementHtml ? htmlToText(statementHtml) : null;

  return {
    contestTitleFromProblemPage: contestTitle,
    problemNumber: problemHeaderMatch
      ? Number.parseInt(problemHeaderMatch[1], 10)
      : null,
    problemTitleFromProblemPage: problemHeaderMatch
      ? cleanText(problemHeaderMatch[2])
      : problemHeader,
    problemPage: {
      url: problemUrl,
      statementHtml,
      statementText,
      structured:
        statementHtml && statementText
          ? parseUsacoStatement(statementHtml, statementText)
          : null,
    },
  };
}

function parseUsacoStatement(statementHtml, statementText) {
  const inputMatch = statementHtml.match(
    /<div class=['"]prob-in-spec['"]>([\s\S]*?)<\/div>/i,
  );
  const outputMatch = statementHtml.match(
    /<div class=['"]prob-out-spec['"]>([\s\S]*?)<\/div>/i,
  );

  const descriptionHtml = sanitizeHtmlFragment(
    inputMatch ? statementHtml.slice(0, inputMatch.index) : statementHtml,
  );
  const inputHtml = sanitizeHtmlFragment(
    inputMatch ? removeLeadingHeading(inputMatch[1]) : "",
  );
  const outputHtml = sanitizeHtmlFragment(
    outputMatch ? removeLeadingHeading(outputMatch[1]) : "",
  );

  const afterOutputIndex = outputMatch
    ? outputMatch.index + outputMatch[0].length
    : inputMatch
      ? inputMatch.index + inputMatch[0].length
      : statementHtml.length;
  const tailHtml = sanitizeHtmlFragment(statementHtml.slice(afterOutputIndex));
  const samples = extractSamples(statementHtml);
  const hintHtml = sanitizeHtmlFragment(removeSampleBlocks(tailHtml));

  return {
    descriptionHtml: descriptionHtml || "<p></p>",
    inputHtml: inputHtml || "<p></p>",
    outputHtml: outputHtml || "<p></p>",
    hintHtml: hintHtml || "<p></p>",
    samples,
    timeLimitMs: extractTimeLimitMs(statementText),
    memoryLimitMb: extractMemoryLimitMb(statementText),
  };
}

function removeLeadingHeading(html) {
  return String(html).replace(/^\s*<h4>[\s\S]*?<\/h4>\s*/i, "").trim();
}

function sanitizeHtmlFragment(html) {
  return String(html ?? "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^(<p>\s*<\/p>\s*)+/i, "")
    .replace(/(\s*<p>\s*<\/p>)+$/i, "")
    .trim();
}

function extractSamples(statementHtml) {
  const samplePattern =
    /<h4>\s*SAMPLE INPUT:\s*<\/h4>\s*<pre class=['"]in['"]>([\s\S]*?)<\/pre>\s*<h4>\s*SAMPLE OUTPUT:\s*<\/h4>\s*<pre class=['"]out['"]>([\s\S]*?)<\/pre>/gi;
  const samples = [];

  for (const match of statementHtml.matchAll(samplePattern)) {
    samples.push({
      input: decodePreText(match[1]),
      output: decodePreText(match[2]),
    });
  }

  return samples;
}

function removeSampleBlocks(html) {
  return String(html).replace(
    /<h4>\s*SAMPLE INPUT:\s*<\/h4>\s*<pre class=['"]in['"]>[\s\S]*?<\/pre>\s*<h4>\s*SAMPLE OUTPUT:\s*<\/h4>\s*<pre class=['"]out['"]>[\s\S]*?<\/pre>/gi,
    "",
  );
}

function decodePreText(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function extractTimeLimitMs(statementText) {
  const explicitMatch = statementText.match(
    /time limit for this problem is\s+([0-9]+(?:\.[0-9]+)?)s/i,
  );

  if (explicitMatch) {
    return Math.round(Number.parseFloat(explicitMatch[1]) * 1000);
  }

  return DEFAULT_TIME_LIMIT_MS;
}

function extractMemoryLimitMb(statementText) {
  const explicitMatch = statementText.match(
    /memory limit for this problem is\s+([0-9]+(?:\.[0-9]+)?)MB/i,
  );

  if (explicitMatch) {
    return Math.round(Number.parseFloat(explicitMatch[1]));
  }

  return DEFAULT_MEMORY_LIMIT_MB;
}

function limitSeasons(seasons, seasonLimit, contestLimit) {
  let nextSeasons = seasons.map((season) => ({
    name: season.name,
    contests: season.contests.map((contest) => ({ ...contest })),
  }));

  if (seasonLimit != null) {
    nextSeasons = nextSeasons.slice(0, seasonLimit);
  }

  if (contestLimit != null) {
    let remaining = contestLimit;
    nextSeasons = nextSeasons
      .map((season) => {
        if (remaining <= 0) {
          return {
            name: season.name,
            contests: [],
          };
        }

        const contests = season.contests.slice(0, remaining);
        remaining -= contests.length;
        return {
          name: season.name,
          contests,
        };
      })
      .filter((season) => season.contests.length > 0);
  }

  return nextSeasons;
}

function extractDivisionName(divisionTitle) {
  const parts = divisionTitle.split(",");
  return cleanText(parts[parts.length - 1] ?? divisionTitle);
}

function extractPageId(url) {
  try {
    return new URL(url).searchParams.get("page");
  } catch {
    return null;
  }
}

function extractCpid(url) {
  try {
    const value = new URL(url).searchParams.get("cpid");
    return value == null ? null : Number.parseInt(value, 10);
  } catch {
    return null;
  }
}

function resolveUrl(target, baseUrl) {
  return new URL(target, baseUrl || SITE_ORIGIN).toString();
}

function cleanText(value) {
  return decodeHtmlEntities(String(value))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/\r/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|h4|pre)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<pre[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      const normalized = entity.toLowerCase();

      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
      }

      return namedEntities[normalized] ?? match;
    },
  );
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function uniqueCompact(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function requireOptionValue(argv, index, optionName) {
  const value = argv[index];
  if (value == null || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return value;
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function extractSequentialTestCasesFromZip(zipBuffer) {
  const entries = parseZipEntries(zipBuffer)
    .filter((entry) => !entry.name.endsWith("/"))
    .map((entry) => ({
      ...entry,
      baseName: path.posix.basename(entry.name),
    }));

  const entryByBaseName = new Map(entries.map((entry) => [entry.baseName, entry]));
  const testCases = [];

  for (let index = 1; ; index += 1) {
    const inputEntry = entryByBaseName.get(`${index}.in`);
    const outputEntry = entryByBaseName.get(`${index}.out`);

    if (!inputEntry || !outputEntry) {
      break;
    }

    testCases.push({
      name: `${index}.in`,
      data: inputEntry.data,
    });
    testCases.push({
      name: `${index}.out`,
      data: outputEntry.data,
    });
  }

  if (testCases.length === 0) {
    throw new Error("Could not find sequential test cases in the downloaded zip");
  }

  return testCases;
}

function parseZipEntries(zipBuffer) {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(zipBuffer);
  const totalEntries = zipBuffer.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectoryOffset = zipBuffer.readUInt32LE(
    endOfCentralDirectoryOffset + 16,
  );

  let offset = centralDirectoryOffset;
  const entries = [];

  for (let index = 0; index < totalEntries; index += 1) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry");
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
    const flags = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    entries.push({
      name,
      data: readZipEntryData(zipBuffer, {
        compressionMethod,
        flags,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      }),
    });

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(zipBuffer) {
  const minOffset = Math.max(0, zipBuffer.length - 65557);

  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Invalid ZIP file: end of central directory not found");
}

function readZipEntryData(zipBuffer, entry) {
  if ((entry.flags & 0x1) !== 0) {
    throw new Error("Encrypted ZIP entries are not supported");
  }

  const localHeaderSignature = zipBuffer.readUInt32LE(entry.localHeaderOffset);
  if (localHeaderSignature !== 0x04034b50) {
    throw new Error("Invalid ZIP local file header");
  }

  const localFileNameLength = zipBuffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraFieldLength = zipBuffer.readUInt16LE(
    entry.localHeaderOffset + 28,
  );
  const dataStart =
    entry.localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressedData = zipBuffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressedData);
  }

  if (entry.compressionMethod === 8) {
    const inflated = zlib.inflateRawSync(compressedData);
    if (inflated.length !== entry.uncompressedSize) {
      throw new Error("ZIP entry size mismatch after inflation");
    }
    return inflated;
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}

class ZipArchiveWriter {
  constructor(outputPath) {
    this.outputPath = outputPath;
    this.handlePromise = fs.open(outputPath, "w");
    this.entries = [];
    this.offset = 0;
    this.closed = false;
  }

  async addFile(name, data) {
    if (this.closed) {
      throw new Error("Cannot add files after the zip archive has been closed");
    }

    const handle = await this.handlePromise;
    const normalizedName = name.replace(/\\/g, "/");
    const fileNameBuffer = Buffer.from(normalizedName, "utf8");
    const fileData = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const deflated = zlib.deflateRawSync(fileData, { level: 9 });
    const useCompression = deflated.length < fileData.length;
    const storedData = useCompression ? deflated : fileData;
    const compressionMethod = useCompression ? 8 : 0;
    const crc = crc32(fileData);
    const dosTimestamp = convertDateToDos(new Date());
    const localHeaderOffset = this.offset;

    const localHeader = Buffer.alloc(30 + fileNameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTimestamp.time, 10);
    localHeader.writeUInt16LE(dosTimestamp.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(storedData.length, 18);
    localHeader.writeUInt32LE(fileData.length, 22);
    localHeader.writeUInt16LE(fileNameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    fileNameBuffer.copy(localHeader, 30);

    await handle.write(localHeader, 0, localHeader.length, this.offset);
    this.offset += localHeader.length;
    await handle.write(storedData, 0, storedData.length, this.offset);
    this.offset += storedData.length;

    this.ensureZip32Limit(this.offset);

    this.entries.push({
      fileNameBuffer,
      compressionMethod,
      crc,
      compressedSize: storedData.length,
      uncompressedSize: fileData.length,
      localHeaderOffset,
      dosTimestamp,
    });
  }

  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const handle = await this.handlePromise;
    const centralDirectoryOffset = this.offset;

    for (const entry of this.entries) {
      const centralHeader = Buffer.alloc(46 + entry.fileNameBuffer.length);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(entry.compressionMethod, 10);
      centralHeader.writeUInt16LE(entry.dosTimestamp.time, 12);
      centralHeader.writeUInt16LE(entry.dosTimestamp.date, 14);
      centralHeader.writeUInt32LE(entry.crc, 16);
      centralHeader.writeUInt32LE(entry.compressedSize, 20);
      centralHeader.writeUInt32LE(entry.uncompressedSize, 24);
      centralHeader.writeUInt16LE(entry.fileNameBuffer.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(entry.localHeaderOffset, 42);
      entry.fileNameBuffer.copy(centralHeader, 46);

      await handle.write(centralHeader, 0, centralHeader.length, this.offset);
      this.offset += centralHeader.length;
    }

    const centralDirectorySize = this.offset - centralDirectoryOffset;
    this.ensureZip32Limit(centralDirectoryOffset);
    this.ensureZip32Limit(centralDirectorySize);
    if (this.entries.length > 0xffff) {
      throw new Error(
        "ZIP32 entry limit exceeded. Split the export with --season-limit or --contest-limit.",
      );
    }

    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(0, 4);
    endOfCentralDirectory.writeUInt16LE(0, 6);
    endOfCentralDirectory.writeUInt16LE(this.entries.length, 8);
    endOfCentralDirectory.writeUInt16LE(this.entries.length, 10);
    endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
    endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
    endOfCentralDirectory.writeUInt16LE(0, 20);

    await handle.write(
      endOfCentralDirectory,
      0,
      endOfCentralDirectory.length,
      this.offset,
    );
    await handle.close();
  }

  ensureZip32Limit(value) {
    if (value > 0xffffffff) {
      throw new Error(
        "ZIP32 size limit exceeded. Split the export with --season-limit or --contest-limit.",
      );
    }
  }
}

function convertDateToDos(date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

async function mapLimit(items, limit, iteratee) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length || 1) },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        await iteratee(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(workers);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
