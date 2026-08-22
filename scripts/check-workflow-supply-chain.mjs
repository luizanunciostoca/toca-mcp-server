import { readdir, readFile } from 'node:fs/promises';

const workflowDirectory = '.github/workflows';
const immutableCommitShaReference = /^[0-9a-f]{40}(?:\s*#.*)?$/i;
const immutableContainerImageReference = /@sha256:[0-9a-f]{64}$/i;
const actionUsePattern = /^\s*uses:\s*([^\s]+)\s*(?:#.*)?$/;
const containerImagePattern = /^\s*image:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/;
const failures = [];

const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => `${workflowDirectory}/${entry.name}`)
  .sort();

if (workflowFiles.length === 0) {
  failures.push(`${workflowDirectory}: no workflow files found`);
}

for (const workflowPath of workflowFiles) {
  const content = await readFile(workflowPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const actionMatch = line.match(actionUsePattern);
    if (actionMatch) {
      const actionRef = actionMatch[1];
      if (!actionRef.startsWith('./')) {
        const separatorIndex = actionRef.lastIndexOf('@');
        if (separatorIndex <= 0) {
          failures.push(
            `${workflowPath}:${index + 1}: external action is missing an immutable @SHA`,
          );
        } else {
          const reference = actionRef.slice(separatorIndex + 1);
          if (!immutableCommitShaReference.test(reference)) {
            failures.push(
              `${workflowPath}:${index + 1}: external action must be pinned to a full 40-character commit SHA`,
            );
          }
        }
      }
    }

    const imageMatch = line.match(containerImagePattern);
    if (imageMatch) {
      const imageRef = imageMatch[1];
      if (!imageRef.includes('${{') && !immutableContainerImageReference.test(imageRef)) {
        failures.push(
          `${workflowPath}:${index + 1}: static container image must be pinned to an immutable @sha256 digest`,
        );
      }
    }
  }

  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const preJobs = jobsIndex >= 0 ? lines.slice(0, jobsIndex) : lines;
  if (!preJobs.some((line) => /^permissions:\s*$/.test(line))) {
    failures.push(`${workflowPath}: missing explicit top-level permissions before jobs:`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`WORKFLOW_SUPPLY_CHAIN_CHECK_PASS=${workflowFiles.length}`);
