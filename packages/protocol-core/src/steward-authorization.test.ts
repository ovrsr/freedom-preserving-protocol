import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeV2 } from "./canonical-json.js";
import {
  STEWARD_DIGEST_DOMAINS,
  KeyRefSchema,
  OperatorAuthorizationRevocationV1Schema,
  OperatorAuthorizationV1Schema,
  StewardBootstrapV1Schema,
  StewardKeyAttestationV1Schema,
  attestationSigningFields,
  authorizationRevocationSigningFields,
  authorizationSigningFields,
  bootstrapSigningFields,
  buildStewardEvidenceDigest,
  buildStewardReplayDigest,
  isStewardIdV1,
  mintStewardIdV1,
  parseKeyRef,
  parseOperatorAuthorization,
  parseOperatorAuthorizationRevocation,
  parseStewardBootstrap,
  parseStewardIdV1,
  parseStewardKeyAttestation,
  validateOperatorAuthorizationBounds,
  type OperatorAuthorizationV1,
  type StewardBootstrapV1,
  type StewardKeyAttestationV1,
} from "./steward-authorization.js";

describe("StewardIdV1", () => {
  it("mints fpp:steward:v1:<26 lowercase base32 chars> from 128 random bits", () => {
    const id = mintStewardIdV1();
    assert.match(id, /^fpp:steward:v1:[a-z2-7]{26}$/);
    assert.equal(parseStewardIdV1(id).ok, true);
    assert.equal(isStewardIdV1(id), true);
  });

  it("mints distinct ids across calls", () => {
    const a = mintStewardIdV1();
    const b = mintStewardIdV1();
    assert.notEqual(a, b);
  });

  it("rejects malformed steward ids", () => {
    assert.equal(parseStewardIdV1("fpp:ed25519:abc").ok, false);
    assert.equal(parseStewardIdV1("fpp:steward:v1:ABC").ok, false); // uppercase
    assert.equal(parseStewardIdV1("fpp:steward:v1:018").ok, false); // invalid base32 chars / length
    assert.equal(parseStewardIdV1("fpp:steward:v1:" + "a".repeat(25)).ok, false);
    assert.equal(parseStewardIdV1("fpp:steward:v1:" + "a".repeat(27)).ok, false);
    assert.equal(isStewardIdV1("not-a-steward"), false);
  });
});

describe("KeyRef", () => {
  it("parses openpgp:<lowercase fingerprint>", () => {
    const fp = "a".repeat(40);
    const result = parseKeyRef(`openpgp:${fp}`);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.keyRef.algorithm, "openpgp");
      assert.equal(result.keyRef.identifier, fp);
      assert.equal(result.keyRef.raw, `openpgp:${fp}`);
    }
  });

  it("rejects malformed key refs", () => {
    assert.equal(parseKeyRef("openpgp:ABCD").ok, false); // uppercase
    assert.equal(parseKeyRef("ed25519:abc").ok, false);
    assert.equal(parseKeyRef("openpgp:").ok, false);
    assert.equal(parseKeyRef("openpgp:zzz").ok, false);
    assert.equal(KeyRefSchema ? true : false, true);
  });
});

describe("StewardKeyAttestationV1", () => {
  const validAttestation: StewardKeyAttestationV1 = {
    schemaVersion: 1,
    kind: "steward-key-attestation",
    attestationId: "att-001",
    operation: "initial-bind",
    stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
    audience: "instance:local-1",
    subjectKey: {
      algorithm: "openpgp",
      keyRef: `openpgp:${"b".repeat(40)}`,
    },
    issuedAt: "2026-07-18T12:00:00.000Z",
    nonce: "n".repeat(32),
    reason: "bootstrap steward key",
  };

  it("accepts a valid attestation", () => {
    const result = parseStewardKeyAttestation(validAttestation);
    assert.equal(result.ok, true);
  });

  it("accepts add/rotate/revoke operations with required fields", () => {
    assert.equal(
      parseStewardKeyAttestation({
        ...validAttestation,
        operation: "add",
        attestationId: "att-002",
        nonce: "o".repeat(32),
      }).ok,
      true,
    );
    assert.equal(
      parseStewardKeyAttestation({
        ...validAttestation,
        operation: "rotate",
        replacesKeyRef: `openpgp:${"c".repeat(40)}`,
        attestationId: "att-003",
        nonce: "p".repeat(32),
      }).ok,
      true,
    );
    assert.equal(
      parseStewardKeyAttestation({
        ...validAttestation,
        operation: "revoke",
        attestationId: "att-004",
        nonce: "q".repeat(32),
        reason: "compromised",
      }).ok,
      true,
    );
  });

  it("rejects unknown properties and invalid steward/audience/nonce", () => {
    assert.equal(
      parseStewardKeyAttestation({ ...validAttestation, extra: true }).ok,
      false,
    );
    assert.equal(
      parseStewardKeyAttestation({
        ...validAttestation,
        stewardId: "fpp:ed25519:dead",
      }).ok,
      false,
    );
    assert.equal(
      parseStewardKeyAttestation({ ...validAttestation, audience: "" }).ok,
      false,
    );
    assert.equal(
      parseStewardKeyAttestation({ ...validAttestation, nonce: "short" }).ok,
      false,
    );
    assert.equal(
      parseStewardKeyAttestation({
        ...validAttestation,
        issuedAt: "not-iso",
      }).ok,
      false,
    );
  });

  it("canonical signing fields equal the full attestation payload", () => {
    const fields = attestationSigningFields(validAttestation);
    assert.equal(
      canonicalizeV2(fields),
      canonicalizeV2(validAttestation),
    );
    assert.ok(StewardKeyAttestationV1Schema);
  });
});

describe("OperatorAuthorizationV1", () => {
  const validAuth: OperatorAuthorizationV1 = {
    schemaVersion: 1,
    kind: "operator-authorization",
    authorizationId: "authz-001",
    stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
    signingKeyRef: `openpgp:${"d".repeat(40)}`,
    audience: "instance:local-1",
    mode: "one-shot",
    scope: {
      classifications: ["code.patch"],
    },
    issuedAt: "2026-07-18T12:00:00.000Z",
    expiresAt: "2026-07-18T13:00:00.000Z",
    nonce: "r".repeat(32),
    maxUses: 1,
    reason: "allow one patch",
  };

  it("accepts a valid one-shot authorization", () => {
    const result = parseOperatorAuthorization(validAuth);
    assert.equal(result.ok, true);
  });

  it("accepts standing authorizations with finite expiry and maxUses", () => {
    const result = parseOperatorAuthorization({
      ...validAuth,
      mode: "standing",
      authorizationId: "authz-002",
      nonce: "s".repeat(32),
      maxUses: 5,
      scope: {
        classifications: ["code.patch"],
        toolNames: ["apply_patch"],
        resourcePaths: ["src/foo.ts"],
      },
    });
    assert.equal(result.ok, true);
  });

  it("rejects empty/wildcard/duplicate scopes and consent-class tokens", () => {
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: { classifications: [] },
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: { classifications: ["*"] },
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: { classifications: ["code.patch", "code.patch"] },
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: {
          classifications: ["code.patch"],
          toolNames: ["apply_patch", "apply_patch"],
        },
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: {
          classifications: ["code.patch"],
          resourcePaths: ["a.ts", "a.ts"],
        },
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: { classifications: ["affected-party-consent"] },
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        scope: { classifications: ["data-subject-consent"] },
      }).ok,
      false,
    );
  });

  it("rejects unknown properties, bad times, and malformed nonces", () => {
    assert.equal(
      parseOperatorAuthorization({ ...validAuth, extra: 1 }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({
        ...validAuth,
        issuedAt: "yesterday",
      }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({ ...validAuth, nonce: "!!" }).ok,
      false,
    );
    assert.equal(
      parseOperatorAuthorization({ ...validAuth, audience: "" }).ok,
      false,
    );
  });

  it("enforces one-shot maxUses=1 and standing finite positive maxUses", () => {
    assert.equal(
      validateOperatorAuthorizationBounds({
        ...validAuth,
        maxUses: 2,
      }).ok,
      false,
    );
    assert.equal(
      validateOperatorAuthorizationBounds({
        ...validAuth,
        mode: "standing",
        maxUses: 0,
      }).ok,
      false,
    );
    assert.equal(
      validateOperatorAuthorizationBounds({
        ...validAuth,
        mode: "standing",
        maxUses: 3,
        expiresAt: "2026-07-18T11:00:00.000Z", // before issuedAt
      }).ok,
      false,
    );
    assert.equal(validateOperatorAuthorizationBounds(validAuth).ok, true);
  });

  it("canonical signing fields equal the full authorization payload", () => {
    assert.equal(
      canonicalizeV2(authorizationSigningFields(validAuth)),
      canonicalizeV2(validAuth),
    );
    assert.ok(OperatorAuthorizationV1Schema);
  });
});

describe("OperatorAuthorizationRevocationV1", () => {
  const validRevocation = {
    schemaVersion: 1 as const,
    kind: "operator-authorization-revocation" as const,
    authorizationId: "authz-001",
    stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
    signingKeyRef: `openpgp:${"e".repeat(40)}`,
    audience: "instance:local-1",
    issuedAt: "2026-07-18T14:00:00.000Z",
    nonce: "t".repeat(32),
    reason: "no longer needed",
  };

  it("accepts a valid revocation", () => {
    const result = parseOperatorAuthorizationRevocation(validRevocation);
    assert.equal(result.ok, true);
  });

  it("rejects unknown properties and missing required fields", () => {
    assert.equal(
      parseOperatorAuthorizationRevocation({
        ...validRevocation,
        extra: true,
      }).ok,
      false,
    );
    const { reason: _r, ...rest } = validRevocation;
    void _r;
    assert.equal(parseOperatorAuthorizationRevocation(rest).ok, false);
  });

  it("canonical signing fields equal the full revocation payload", () => {
    assert.equal(
      canonicalizeV2(authorizationRevocationSigningFields(validRevocation)),
      canonicalizeV2(validRevocation),
    );
    assert.ok(OperatorAuthorizationRevocationV1Schema);
  });
});

describe("steward evidence and replay digests", () => {
  it("uses domain-separated digests that differ by domain and payload", () => {
    const payload = { a: 1, b: "x" };
    const evidence = buildStewardEvidenceDigest(payload);
    const replay = buildStewardReplayDigest(payload);
    assert.notEqual(evidence, replay);
    assert.match(evidence, /^[0-9a-f]{64}$/);
    assert.match(replay, /^[0-9a-f]{64}$/);
    assert.equal(
      buildStewardEvidenceDigest(payload),
      buildStewardEvidenceDigest(payload),
    );
    assert.ok(STEWARD_DIGEST_DOMAINS.evidence);
    assert.ok(STEWARD_DIGEST_DOMAINS.replay);
  });

  it("keeps stable domain strings without an authorization literal key", () => {
    // ClawHub suspicious.exposed_secret_literal false-positives on
    // property names that look like credential fields with string literals.
    assert.equal(
      STEWARD_DIGEST_DOMAINS.authz,
      "fpp:v2:steward-authorization",
    );
    assert.equal(
      STEWARD_DIGEST_DOMAINS.revocation,
      "fpp:v2:steward-authorization-revocation",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        STEWARD_DIGEST_DOMAINS,
        "authorization",
      ),
      false,
    );
  });
});

describe("StewardBootstrapV1", () => {
  const fingerprint = "b".repeat(40);
  const publicKeyArmored = [
    "-----BEGIN PGP PUBLIC KEY BLOCK-----",
    "Version: test",
    "",
    "mDMEAAAAAAkB",
    "-----END PGP PUBLIC KEY BLOCK-----",
  ].join("\n");

  const validInitialBinding: StewardKeyAttestationV1 = {
    schemaVersion: 1,
    kind: "steward-key-attestation",
    attestationId: "att-bootstrap-001",
    operation: "initial-bind",
    stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
    audience: "instance:local-1",
    subjectKey: {
      algorithm: "openpgp",
      keyRef: `openpgp:${fingerprint}`,
      publicKeyArmored,
    },
    issuedAt: "2026-07-20T12:00:00.000Z",
    nonce: "n".repeat(32),
    reason: "secure steward genesis",
  };

  const validBootstrap: StewardBootstrapV1 = {
    schemaVersion: 1,
    kind: "steward-bootstrap",
    bootstrapId: "bootstrap-001",
    stewardId: "fpp:steward:v1:aaaaaaaaaaaaaaaaaaaaaaaaaa",
    audience: "instance:local-1",
    policy: {
      instanceAudience: "instance:local-1",
      maxStandingLifetimeMs: 86_400_000,
      maxStandingUses: 100,
      maxOneShotLifetimeMs: 3_600_000,
      allowedClockSkewMs: 300_000,
    },
    initialBinding: validInitialBinding,
    issuedAt: "2026-07-20T12:00:00.000Z",
    nonce: "b".repeat(32),
  };

  it("accepts a valid bootstrap binding identity, key, audience, and policy caps", () => {
    const result = parseStewardBootstrap(validBootstrap);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.bootstrap.bootstrapId, "bootstrap-001");
    assert.equal(result.bootstrap.initialBinding.operation, "initial-bind");
    assert.equal(result.bootstrap.policy.maxStandingUses, 100);
    assert.ok(StewardBootstrapV1Schema);
  });

  it("rejects mismatched nested steward/audience values and non-initial-bind operations", () => {
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        initialBinding: {
          ...validInitialBinding,
          stewardId: "fpp:steward:v1:bbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        initialBinding: {
          ...validInitialBinding,
          audience: "instance:other",
        },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        policy: {
          ...validBootstrap.policy,
          instanceAudience: "instance:other",
        },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        initialBinding: {
          ...validInitialBinding,
          operation: "add",
          attestationId: "att-add",
          nonce: "a".repeat(32),
        },
      }).ok,
      false,
    );
  });

  it("rejects malformed key refs, private-key material, invalid caps, unknown versions, and missing replay fields", () => {
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        initialBinding: {
          ...validInitialBinding,
          subjectKey: {
            ...validInitialBinding.subjectKey,
            keyRef: "openpgp:not-a-fingerprint",
          },
        },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        initialBinding: {
          ...validInitialBinding,
          subjectKey: {
            ...validInitialBinding.subjectKey,
            publicKeyArmored: [
              "-----BEGIN PGP PRIVATE KEY BLOCK-----",
              "mDMEAAAA",
              "-----END PGP PRIVATE KEY BLOCK-----",
            ].join("\n"),
          },
        },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        policy: { ...validBootstrap.policy, maxStandingUses: 0 },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        policy: { ...validBootstrap.policy, maxStandingLifetimeMs: -1 },
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        schemaVersion: 2,
      }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({
        ...validBootstrap,
        kind: "steward-bootstrap-v2",
      }).ok,
      false,
    );
    const { nonce: _n, ...missingNonce } = validBootstrap;
    assert.equal(parseStewardBootstrap(missingNonce).ok, false);
    const { issuedAt: _i, ...missingIssuedAt } = validBootstrap;
    assert.equal(parseStewardBootstrap(missingIssuedAt).ok, false);
    assert.equal(
      parseStewardBootstrap({ ...validBootstrap, nonce: "short" }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({ ...validBootstrap, issuedAt: "not-iso" }).ok,
      false,
    );
    assert.equal(
      parseStewardBootstrap({ ...validBootstrap, extra: true }).ok,
      false,
    );
  });

  it("rejects every recognized OpenPGP secret armor label and key algorithm/ref mismatch", () => {
    for (const label of ["PRIVATE", "SECRET"]) {
      const secretArmor = [
        `-----BEGIN PGP ${label} KEY BLOCK-----`,
        "mDMEAAAA",
        `-----END PGP ${label} KEY BLOCK-----`,
      ].join("\n");
      const withSecretMaterial = {
        ...validBootstrap,
        initialBinding: {
          ...validInitialBinding,
          subjectKey: {
            ...validInitialBinding.subjectKey,
            publicKeyArmored: secretArmor,
          },
        },
      };
      assert.equal(
        parseStewardBootstrap(withSecretMaterial).ok,
        false,
        `${label} armor must be rejected`,
      );
      assert.equal(
        parseStewardKeyAttestation(withSecretMaterial.initialBinding).ok,
        false,
        `${label} armor must be rejected from attestations`,
      );
    }

    const mismatchedAlgorithm = {
      ...validBootstrap,
      initialBinding: {
        ...validInitialBinding,
        subjectKey: {
          ...validInitialBinding.subjectKey,
          algorithm: "ed25519",
        },
      },
    };
    const parsed = parseStewardBootstrap(mismatchedAlgorithm);
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.error, /algorithm.*key.*ref/i);
  });

  it("canonical signing bytes change when expected key, audience, or any policy cap changes", () => {
    const base = canonicalizeV2(bootstrapSigningFields(validBootstrap));
    assert.equal(base, canonicalizeV2(validBootstrap));

    const keyChanged = {
      ...validBootstrap,
      initialBinding: {
        ...validInitialBinding,
        subjectKey: {
          ...validInitialBinding.subjectKey,
          keyRef: `openpgp:${"c".repeat(40)}`,
        },
      },
    };
    assert.notEqual(
      canonicalizeV2(bootstrapSigningFields(keyChanged)),
      base,
    );

    const audienceChanged = {
      ...validBootstrap,
      audience: "instance:other",
      policy: {
        ...validBootstrap.policy,
        instanceAudience: "instance:other",
      },
      initialBinding: {
        ...validInitialBinding,
        audience: "instance:other",
      },
    };
    assert.notEqual(
      canonicalizeV2(bootstrapSigningFields(audienceChanged)),
      base,
    );

    for (const cap of [
      "maxStandingLifetimeMs",
      "maxStandingUses",
      "maxOneShotLifetimeMs",
      "allowedClockSkewMs",
    ] as const) {
      const policyChanged = {
        ...validBootstrap,
        policy: {
          ...validBootstrap.policy,
          [cap]: validBootstrap.policy[cap] + 1,
        },
      };
      assert.notEqual(
        canonicalizeV2(bootstrapSigningFields(policyChanged)),
        base,
        `canonical bytes must change when ${cap} changes`,
      );
    }
  });
});
