// Fails when the npm tarball would ship the wrong files.
//
// Reads the JSON that "npm pack --dry-run --json" prints on stdin:
//
//   npm pack --dry-run --json | node .github/scripts/check-package-contents.mjs
//
// This is plain ESM on purpose: it runs on Node 20, which cannot execute the
// project's TypeScript directly.

/** Exact files the package cannot work without. */
const REQUIRED_FILES = [
  { path: 'dist/cli.js', why: 'it is the target of the "bin" entries' },
];

/** Directories that must contain at least one file in the tarball. */
const REQUIRED_DIRS = [
  { prefix: 'katas/', why: 'the curriculum is data the CLI loads at runtime' },
];

/** Directories that must never be published. */
const FORBIDDEN_DIRS = [
  { prefix: 'src/', why: 'TypeScript sources are not part of the published package' },
  { prefix: 'test/', why: 'tests and fixtures are not part of the published package' },
];

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

function listPackedPaths(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`Expected the JSON output of "npm pack --dry-run --json" on stdin (${error.message}).`);
  }
  const files = Array.isArray(parsed) ? parsed[0]?.files : undefined;
  if (!Array.isArray(files)) {
    throw new Error('The npm pack output has no "files" list. Did the pack command fail?');
  }
  // npm reports forward slashes on every OS; normalise anyway so a future
  // change cannot silently defeat the prefix checks below.
  return files.map((file) => String(file.path).replaceAll('\\', '/'));
}

function findProblems(paths) {
  const problems = [];

  for (const { path, why } of REQUIRED_FILES) {
    if (!paths.includes(path)) {
      problems.push(`missing ${path}: ${why}. Did "npm run build" run first?`);
    }
  }
  for (const { prefix, why } of REQUIRED_DIRS) {
    if (!paths.some((path) => path.startsWith(prefix))) {
      problems.push(`nothing under ${prefix} was packed: ${why}. Check the "files" list in package.json.`);
    }
  }
  for (const { prefix, why } of FORBIDDEN_DIRS) {
    const leaked = paths.filter((path) => path.startsWith(prefix));
    if (leaked.length > 0) {
      problems.push(`${leaked.length} file(s) under ${prefix} would be published (for example ${leaked[0]}): ${why}.`);
    }
  }

  return problems;
}

try {
  const paths = listPackedPaths(await readStdin());
  const problems = findProblems(paths);

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`package check failed: ${problem}`);
    }
    process.exit(1);
  }
  console.log(`package check passed: ${paths.length} files, dist/ and katas/ present, no src/ or test/.`);
} catch (error) {
  console.error(`package check failed: ${error.message}`);
  process.exit(1);
}
