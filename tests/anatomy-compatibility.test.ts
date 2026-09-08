import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anatomyCompatible,
  signatureFor,
} from "../server/anatomy-compatibility";
test("saved anatomy survives code-only updates but rejects changed or unknown geometry", () => {
  const geometrySignature =
    "da72bf9b512622cab3f69d1e1eef131c9ec279bd6b0f2973f375ec285b69792a";
  const release = { commit: "new", geometrySignature };
  assert.equal(
    anatomyCompatible({ engine: "old", geometrySignature }, release),
    true,
  );
  assert.equal(
    anatomyCompatible(
      { engine: "5968f08031e185df3830637e961a2d0f3d47caad" },
      release,
    ),
    true,
  );
  assert.equal(anatomyCompatible({ engine: "old" }, release), false);
  assert.equal(
    anatomyCompatible({ engine: "new", geometrySignature: "changed" }, release),
    false,
  );
  assert.equal(anatomyCompatible({}, release), false);
  assert.equal(signatureFor({ engine: "unknown-old" }, release), undefined);
  assert.equal(signatureFor({}, release), geometrySignature);
});
