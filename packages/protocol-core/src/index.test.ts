import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  SCHEMA_VERSION,
} from "./index.js";

describe("@ovrsr/fpp-protocol-core public surface", () => {
  it("exports package identity and schema version 2", () => {
    assert.equal(PACKAGE_NAME, "@ovrsr/fpp-protocol-core");
    assert.equal(PACKAGE_VERSION, "1.0.0");
    assert.equal(SCHEMA_VERSION, 2);
  });
});
