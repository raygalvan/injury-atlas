import { z } from "zod";
import {
  featureScopes,
  featureStatuses,
  type AfpFeature,
} from "../../shared/afp";
import { extensionPoints } from "./extension-points";
import { afpResources } from "./resources";
import type { Store, User } from "../store";
import { AiError } from "../ai/error";
const check = z
  .object({
    status: z.enum(["pending", "passed", "failed"]),
    reference: z.string().trim().max(2000),
  })
  .refine((v) => v.status === "pending" || !!v.reference, {
    message: "A test or security result needs a reference.",
  });
export const featureSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{2,79}$/),
  name: z.string().trim().min(1).max(180),
  owner: z.string().min(1).max(120),
  scope: z.enum(featureScopes),
  baseVersion: z.string().trim().min(1).max(160),
  extensionPoints: z.array(z.string()).min(1).max(20),
  resources: z.array(z.string()).max(20),
  status: z.enum(featureStatuses),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  compute: z.object({
    description: z.string().trim().max(2000),
    estimatedMonthlyUsd: z.number().nonnegative().max(1e9).nullable(),
    actualUsd: z.number().nonnegative().max(1e9).nullable(),
  }),
  tests: check,
  security: check,
  rollback: z
    .object({
      status: z.enum(["planned", "documented"]),
      reference: z.string().trim().max(2000),
    })
    .refine((v) => v.status !== "documented" || !!v.reference, {
      message: "Documented rollback needs a reference.",
    }),
});
export function ensureFeatures(db: Store) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS afp_features(id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL)",
  );
}
export function listFeatures(db: Store): AfpFeature[] {
  return db
    .prepare(
      "SELECT body FROM afp_features ORDER BY updated DESC,rowid DESC LIMIT 100",
    )
    .all()
    .map((r) => JSON.parse(String(r.body)));
}
export function validateFeature(
  db: Store,
  input: unknown,
  u: User,
  previous?: AfpFeature,
): AfpFeature {
  const v = featureSchema.parse(input);
  if (
    v.extensionPoints.some((id) => !extensionPoints.some((p) => p.id === id)) ||
    v.resources.some((id) => !afpResources().some((r) => r.id === id))
  )
    throw new AiError("Choose registered extension points and resources.");
  const owner = db
    .prepare("SELECT id,firm_id,role FROM users WHERE id=? AND active=1")
    .get(v.owner);
  if (!owner || owner.role === "client")
    throw new AiError("Choose an active staff owner.");
  if (v.status === "active" || v.status === "preview")
    throw new AiError(
      "AFP execution and preview are not connected. Register a draft or review record only.",
    );
  if (!previous && v.status !== "draft")
    throw new AiError("New feature records start as drafts.");
  if (previous?.status === "retired" && v.status !== "retired")
    throw new AiError(
      "Retired records cannot be reactivated. Register a new feature version.",
    );
  if (
    previous &&
    (v.id !== previous.id ||
      v.owner !== previous.owner ||
      v.scope !== previous.scope)
  )
    throw new AiError(
      "Feature identity, owner and scope cannot be changed on an existing record.",
    );
  const now = Date.now();
  return {
    ...v,
    firmId: String(owner.firm_id),
    creator: previous?.creator || u.id,
    revision: (previous?.revision || 0) + 1,
    created: previous?.created || now,
    updated: now,
  };
}
