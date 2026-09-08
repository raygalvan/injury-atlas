import { injuryDocuments } from "./injury-documents";
import { saveArtifact } from "./injury-worker";
import type express from "express";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Store, type User } from "./store";
import {
  createProduction,
  productionRecord,
  productionSchema,
  isPlatformAdmin,
} from "./production";
import type { EvidenceStorage } from "./evidence-storage";
export function productionRoutes(
  app: express.Express,
  db: Store,
  storage: EvidenceStorage,
  staff: express.RequestHandler,
) {
  const get = (req: express.Request) => {
    const r = productionRecord(db, String(req.params.id));
    return r?.case_id === req.params.caseId ? r : null;
  };
  app.get("/api/production-capabilities", staff, (_req, res) => {
    let parts: unknown[] = [];
    try {
      parts = JSON.parse(
        readFileSync(".atlas-build/models/atlas.json", "utf8"),
      ).parts.map((p: any) => ({
        id: p.id,
        name: p.name,
        system: p.system,
        bounds: p.bounds,
      }));
    } catch {}
    res.json({
      parts,
      platformAdmin: isPlatformAdmin(db, res.locals.user),
      renderers: ["abrasion", "subarachnoid", "fracture"],
    });
  });
  app.get("/api/cases/:caseId/production", staff, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id FROM injury_production WHERE case_id=? ORDER BY updated DESC",
        )
        .all(String(req.params.caseId))
        .map((r) => productionRecord(db, String(r.id))),
    ),
  );
  app.post("/api/cases/:caseId/production", staff, (req, res) => {
    const data = productionSchema.parse(req.body);
    if (
      data.evidenceId &&
      !db
        .prepare("SELECT id FROM evidence WHERE id=? AND case_id=?")
        .get(data.evidenceId, String(req.params.caseId))
    )
      return res.status(400).json({ error: "Select evidence from this case" });
    res
      .status(201)
      .json(
        createProduction(db, res.locals.user, String(req.params.caseId), data),
      );
  });
  app.post("/api/cases/:caseId/production/:id/update", staff, (req, res) => {
    const r = get(req);
    if (!r) return res.sendStatus(404);
    if (!["draft", "failed"].includes(r.state) || r.assets.length)
      return res.status(409).json({
        error:
          "Duplicate this completed injury to create a revision. Existing artifacts remain immutable.",
      });
    const data = productionSchema.parse(req.body);
    if (
      data.evidenceId &&
      !db
        .prepare("SELECT id FROM evidence WHERE id=? AND case_id=?")
        .get(data.evidenceId, r.case_id)
    )
      return res.status(400).json({ error: "Select evidence from this case" });
    db.prepare(
      "UPDATE injury_production SET body=?,state='draft',error='',source_review=0,placement_review=0,render_review=0,updated=? WHERE id=?",
    ).run(JSON.stringify(data), Date.now(), r.id);
    audit(db, res.locals.user.id, "injury.updated", r.case_id);
    res.json(productionRecord(db, r.id));
  });
  app.post("/api/cases/:caseId/production/:id/queue", staff, (req, res) => {
    const r = get(req);
    if (!r) return res.sendStatus(404);
    if (!["draft", "failed"].includes(r.state))
      return res
        .status(409)
        .json({ error: "This request is already queued or complete" });
    if (r.body.recipe && !r.body.measurementBasis)
      return res.status(400).json({
        error:
          "Record the measurement source or explicit illustrative assumptions before rendering",
      });
    if (r.body.useAI && !process.env.ANTHROPIC_API_KEY)
      return res.status(409).json({
        error:
          "AI description is not configured. Turn off AI drafting to generate with your own description.",
      });
    if (
      Number(
        db
          .prepare(
            "SELECT count(*) n FROM injury_production WHERE firm_id=? AND state IN ('queued','running')",
          )
          .get(r.firm_id)!.n,
      ) >= 20
    )
      return res
        .status(429)
        .json({ error: "Your firm already has 20 queued requests" });
    db.prepare(
      "UPDATE injury_production SET state='queued',stage='Waiting for production worker',error='',notification='none',updated=? WHERE id=?",
    ).run(Date.now(), r.id);
    audit(db, res.locals.user.id, "injury.queued", r.case_id);
    res.status(202).json(productionRecord(db, r.id));
  });
  app.post("/api/cases/:caseId/production/:id/review", staff, (req, res) => {
    const r = get(req);
    if (!r) return res.sendStatus(404);
    const { decision } = z
      .object({
        decision: z.enum([
          "source",
          "placement",
          "render",
          "apply",
          "hide",
          "show",
          "remove",
        ]),
      })
      .parse(req.body);
    if (decision === "source" && (!r.body.evidenceId || !r.body.citation))
      return res
        .status(400)
        .json({ error: "Link source evidence and a citation first" });
    if (
      ["placement", "render", "apply"].includes(decision) &&
      (r.state !== "complete" || !r.body.recipe)
    )
      return res
        .status(409)
        .json({ error: "A completed 3D artifact is required" });
    if (
      decision === "apply" &&
      (!r.source_review || !r.placement_review || !r.render_review)
    )
      return res.status(409).json({
        error:
          "Approve source, placement and rendering separately before applying",
      });
    if (
      decision === "apply" &&
      r.body.recipe?.kind === "fracture" &&
      db
        .prepare(
          "SELECT id FROM injury_production WHERE case_id=? AND applied=1 AND id!=? AND json_extract(body,'$.recipe.parentId')=? AND json_extract(body,'$.recipe.kind')='fracture'",
        )
        .get(r.case_id, r.id, r.body.recipe.parentId)
    )
      return res.status(409).json({
        error:
          "Only one fracture replacement per anatomy piece is currently supported. Keep the additional finding documented.",
      });
    const column = {
      source: "source_review=1",
      placement: "placement_review=1",
      render: "render_review=1",
      apply: "applied=1,hidden=0",
      hide: "hidden=1",
      show: "hidden=0",
      remove: "applied=0",
    }[decision];
    db.prepare(
      `UPDATE injury_production SET ${column},updated=? WHERE id=?`,
    ).run(Date.now(), r.id);
    audit(db, res.locals.user.id, `injury.${decision}`, r.case_id);
    res.json(productionRecord(db, r.id));
  });
  app.get(
    "/api/cases/:caseId/production/:id/preview/:assetId",
    staff,
    async (req, res) => {
      const r = get(req);
      if (!r) return res.sendStatus(404);
      const a = db
        .prepare(
          "SELECT e.file,e.sha256 FROM evidence e JOIN injury_artifacts a ON a.evidence_id=e.id WHERE a.production_id=? AND e.id=? AND a.kind LIKE 'image-%' AND e.mime='image/png'",
        )
        .get(r.id, String(req.params.assetId));
      if (!a) return res.sendStatus(404);
      const bytes = await storage.get(String(a.file));
      if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
        throw new Error("Artifact integrity mismatch");
      res
        .set("Content-Security-Policy", "default-src 'none'; sandbox")
        .type("image/png")
        .send(bytes);
    },
  );
  app.post(
    "/api/cases/:caseId/production/:id/export",
    staff,
    async (req, res) => {
      const r = get(req);
      if (!r) return res.sendStatus(404);
      if (
        r.state !== "complete" ||
        !r.source_review ||
        (r.body.recipe && (!r.placement_review || !r.render_review))
      )
        return res.status(409).json({
          error:
            "Complete production and the separate review decisions before issuing an exhibit",
        });
      const images: Buffer[] = [];
      for (const a of db
        .prepare(
          "SELECT e.file FROM evidence e JOIN injury_artifacts a ON a.evidence_id=e.id WHERE a.production_id=? AND a.kind LIKE 'image-%' ORDER BY a.kind",
        )
        .all(r.id))
        images.push(await storage.get(String(a.file)));
      const ai = db
        .prepare(
          "SELECT e.file FROM evidence e JOIN injury_artifacts a ON a.evidence_id=e.id WHERE a.production_id=? AND a.kind='ai-draft'",
        )
        .get(r.id);
      const demand = ai
        ? JSON.parse((await storage.get(String(ai.file))).toString())
            .demandNarrative
        : "";
      const metadata = `Injury ${r.id}\nIssued ${new Date().toISOString()}\nReviewed by ${res.locals.user.name}\nSource reviewed: ${!!r.source_review}; placement reviewed: ${!!r.placement_review}; illustration reviewed: ${!!r.render_review}.\nThis export uses the saved illustration assets from this production version.`;
      const docs = await injuryDocuments(
        r.body.name,
        r.body,
        metadata,
        demand,
        images,
        true,
      );
      await saveArtifact(
        db,
        storage,
        r,
        "exhibit",
        `${r.body.name} — reviewed exhibit.pdf`,
        "application/pdf",
        docs.pdf,
      );
      await saveArtifact(
        db,
        storage,
        r,
        "demand-reviewed",
        `${r.body.name} — reviewed demand material.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docs.docx,
      );
      audit(db, res.locals.user.id, "injury.exhibit-issued", r.case_id);
      res.json(productionRecord(db, r.id));
    },
  );
  app.get(
    "/api/cases/:caseId/production/:id/geometry",
    staff,
    async (req, res) => {
      const r = get(req);
      if (!r) return res.sendStatus(404);
      const a = db
        .prepare(
          "SELECT e.file,e.sha256 FROM evidence e JOIN injury_artifacts a ON a.evidence_id=e.id WHERE a.production_id=? AND a.kind='geometry'",
        )
        .get(r.id);
      if (!a) return res.sendStatus(404);
      const bytes = await storage.get(String(a.file));
      if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
        throw new Error("Artifact integrity mismatch");
      const payload = JSON.parse(bytes.toString());
      const release = JSON.parse(
        readFileSync(".atlas-build/release.json", "utf8"),
      );
      if (payload.engine !== release.commit)
        return res.status(409).json({
          error:
            "This illustration uses a different anatomy engine version. Create and review a new revision before applying it.",
        });
      res.type("json").send(bytes);
    },
  );
  const publication = z.object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(8000),
    medicalReferences: z.string().trim().min(1).max(8000),
    kind: z.enum(["abrasion", "subarachnoid", "fracture", "documentation"]),
  });
  app.post("/api/cases/:caseId/production/:id/submit", staff, (req, res) => {
    const r = get(req);
    if (!r) return res.sendStatus(404);
    const d = publication.parse(req.body);
    db.prepare(
      "INSERT INTO injury_publications(id,production_id,creator,firm_id,name,description,medical_references,kind,created) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      r.id,
      res.locals.user.id,
      r.firm_id,
      d.name,
      d.description,
      d.medicalReferences,
      d.kind,
      Date.now(),
    );
    audit(db, res.locals.user.id, "injury.library-submitted", r.case_id);
    res.json({ ok: true });
  });
  app.get("/api/injury-library", staff, (_req, res) => {
    const u = res.locals.user as User,
      admin = isPlatformAdmin(db, u);
    res.json(
      db
        .prepare(
          `SELECT id,name,description,medical_references,kind,status,review_note,created FROM injury_publications WHERE status='approved' OR firm_id=? OR ?=1 ORDER BY created DESC`,
        )
        .all(u.firm_id, admin ? 1 : 0),
    );
  });
  app.post("/api/injury-library", staff, (req, res) => {
    const u = res.locals.user as User;
    if (!isPlatformAdmin(db, u)) return res.sendStatus(403);
    const d = publication.parse(req.body);
    db.prepare(
      "INSERT INTO injury_publications(id,creator,firm_id,name,description,medical_references,kind,created) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      u.id,
      u.firm_id,
      d.name,
      d.description,
      d.medicalReferences,
      d.kind,
      Date.now(),
    );
    res.status(201).json({ ok: true });
  });
  app.post("/api/injury-library/:id/revise", staff, (req, res) => {
    const u = res.locals.user as User,
      previous = db
        .prepare("SELECT * FROM injury_publications WHERE id=?")
        .get(String(req.params.id));
    if (!previous || (!isPlatformAdmin(db, u) && previous.creator !== u.id))
      return res.sendStatus(404);
    const d = publication.parse(req.body);
    db.prepare(
      "INSERT INTO injury_publications(id,production_id,creator,firm_id,name,description,medical_references,kind,created) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      previous.production_id ?? null,
      u.id,
      u.firm_id,
      d.name,
      d.description,
      d.medicalReferences,
      d.kind,
      Date.now(),
    );
    audit(db, u.id, "injury.library-revised");
    res.status(201).json({ ok: true });
  });
  app.post("/api/injury-library/:id/review", staff, (req, res) => {
    if (!isPlatformAdmin(db, res.locals.user)) return res.sendStatus(403);
    const d = z
      .object({
        status: z.enum(["approved", "rejected", "retired"]),
        note: z.string().max(2000),
      })
      .parse(req.body);
    const result = db
      .prepare(
        "UPDATE injury_publications SET status=?,reviewer=?,review_note=? WHERE id=?",
      )
      .run(d.status, res.locals.user.id, d.note, String(req.params.id));
    if (!result.changes) return res.sendStatus(404);
    audit(db, res.locals.user.id, `injury.library-${d.status}`);
    res.json({ ok: true });
  });
}
