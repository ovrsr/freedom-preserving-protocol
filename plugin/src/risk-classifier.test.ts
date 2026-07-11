/**
 * Approval UI string length constraints (OpenClaw gateway limits).
 * Classifier logic lives in @ovrsr/fpp-enforcement-core.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyToolCall } from "./risk-classifier.js";
import {
  buildDescription,
  buildTitle,
  PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH,
  PLUGIN_APPROVAL_TITLE_MAX_LENGTH,
} from "./index.js";

const approvalClassifications: Array<{ toolName: string; params: Record<string, unknown> }> = [
  { toolName: "shell_exec", params: { command: "npm install some-very-long-package-name-that-might-push-the-limit@latest" } },
  { toolName: "shell_exec", params: { command: 'curl -X POST https://api.example.com/v1/extremely/long/path/that/might/blow/limits -d "payload"' } },
  { toolName: "shell_exec", params: { command: "sudo systemctl restart very-long-service-name-that-tests-boundary-conditions" } },
  { toolName: "shell_exec", params: { command: "openclaw plugins install clawhub:ovrsr/openclaw-fpp-plugin" } },
  { toolName: "filesystem_delete", params: { path: ".openclaw/workspace/deeply/nested/path/that/is/quite/long/file.txt" } },
  { toolName: "http_request", params: { method: "POST", url: "https://very-long-domain-name.example.com/api/v1/extremely/long/endpoint/path" } },
  { toolName: "send_email", params: { to: "recipient@example.com", body: "x".repeat(500) } },
];

test("buildDescription stays within 256 chars for all default approvalOn classifications", () => {
  for (const fixture of approvalClassifications) {
    const classification = classifyToolCall(fixture.toolName, fixture.params);
    const desc = buildDescription(classification, fixture.toolName);
    assert.ok(
      desc.length <= PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH,
      `description for ${classification.classification} is ${desc.length} chars (max ${PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH}): "${desc}"`,
    );
  }
});

test("buildTitle stays within 80 chars for all classification ids", () => {
  for (const fixture of approvalClassifications) {
    const classification = classifyToolCall(fixture.toolName, fixture.params);
    const title = buildTitle(classification);
    assert.ok(
      title.length <= PLUGIN_APPROVAL_TITLE_MAX_LENGTH,
      `title for ${classification.classification} is ${title.length} chars (max ${PLUGIN_APPROVAL_TITLE_MAX_LENGTH}): "${title}"`,
    );
  }
});

test("buildDescription truncates with ellipsis when reason is extremely long", () => {
  const longClassification = {
    classification: "exec.outbound-write" as const,
    decision: "approval" as const,
    reason: "x".repeat(300),
    matchedPatterns: [],
  };
  const desc = buildDescription(longClassification, "shell_exec");
  assert.ok(desc.length <= PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH);
  assert.ok(desc.endsWith("..."));
});
