import { ensureAi } from "./ai/settings";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store, User } from "./store";
import { audit } from "./store";
import { recipeSchema } from "./rendering/recipe";
export { recipeSchema } from "./rendering/recipe";
export const productionSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(8000),
    medicalDescription: z.string().max(8000).default(""),
    medicalReferences: z.string().max(8000).default(""),
    clientImpact: z.string().max(8000).default(""),
    impactCitation: z.string().max(2000).default(""),
    evidenceId: z.string().max(120).default(""),
    citation: z.string().max(2000).default(""),
    measurementBasis: z.string().max(2000).default(""),
    recipe: recipeSchema.nullable().default(null),
    useAI: z.boolean().default(false),
    agentManaged: z.boolean().optional(),
    workflow: z.enum(["injury", "demand"]).optional(),
    agentNotes: z.string().max(8000).optional(),
    generalDefinition: z.string().max(8000).optional(),
    generalReferences: z.string().max(8000).optional(),
  })
  .refine((d) => !d.clientImpact || !!d.impactCitation, {
    message: "Client impact needs a source citation",
  });
export type ProductionInput = z.infer<typeof productionSchema>;
export type ProductionRecord = {
  id: string;
  case_id: string;
  firm_id: string;
  creator: string;
  body: ProductionInput;
  state: string;
  stage: string;
  error: string;
  attempts: number;
  updated: number;
  source_review: number;
  placement_review: number;
  render_review: number;
  applied: number;
  hidden: number;
  notification: string;
  assets: { id: string; name: string; mime: string; kind: string }[];
};
export function ensureProduction(db: Store) {
  ensureAi(db);
  db.exec(
    "CREATE TABLE IF NOT EXISTS worker_health(id INTEGER PRIMARY KEY,heartbeat INTEGER NOT NULL)",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS injury_agent_diagnostics(id INTEGER PRIMARY KEY,production_id TEXT NOT NULL,details TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS injury_response_recovery(production_id TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS injury_production(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),firm_id TEXT NOT NULL,creator TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft',stage TEXT NOT NULL DEFAULT 'Describe injury',error TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,source_review INTEGER NOT NULL DEFAULT 0,placement_review INTEGER NOT NULL DEFAULT 0,render_review INTEGER NOT NULL DEFAULT 0,applied INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,notification TEXT NOT NULL DEFAULT 'none');
 CREATE TABLE IF NOT EXISTS injury_artifacts(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES injury_production(id),evidence_id TEXT NOT NULL REFERENCES evidence(id),kind TEXT NOT NULL,UNIQUE(production_id,kind));
 CREATE TABLE IF NOT EXISTS injury_publications(id TEXT PRIMARY KEY,production_id TEXT,creator TEXT NOT NULL,firm_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,medical_references TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'submitted',reviewer TEXT,review_note TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS injury_notifications(id TEXT PRIMARY KEY,production_id TEXT NOT NULL REFERENCES injury_production(id),state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);`);
  db.exec(`CREATE TABLE IF NOT EXISTS injury_library_response_recovery(publication_id TEXT PRIMARY KEY,created INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS injury_library_jobs(
    publication_id TEXT PRIMARY KEY REFERENCES injury_publications(id),
    request TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'Waiting for Injury Creation Agent',
    error TEXT NOT NULL DEFAULT '',updated INTEGER NOT NULL,
    notification TEXT NOT NULL DEFAULT 'none',notification_attempts INTEGER NOT NULL DEFAULT 0,
    next_notification INTEGER NOT NULL DEFAULT 0);`);
  db.exec(
    "CREATE TABLE IF NOT EXISTS platform_admins(user_id TEXT PRIMARY KEY REFERENCES users(id))",
  );
  db.prepare(
    "INSERT OR IGNORE INTO platform_admins SELECT id FROM users WHERE email='raygalvan@gmail.com' AND role='owner' AND active=1",
  ).run();
  // Existing queued UI requests become persistent editable drafts, not endless jobs.
  for (const r of db
    .prepare(
      "SELECT l.*,c.firm_id FROM injury_library l JOIN cases c ON c.id=l.case_id WHERE l.engine_id IS NULL",
    )
    .all() as Record<string, any>[]) {
    if (!r.created_by) continue;
    db.prepare(
      "INSERT OR IGNORE INTO injury_production(id,case_id,firm_id,creator,body,updated) VALUES(?,?,?,?,?,?)",
    ).run(
      r.id,
      r.case_id,
      r.firm_id,
      r.created_by,
      JSON.stringify(
        productionSchema.parse({
          name: r.name,
          description: r.generated_from || r.name,
        }),
      ),
      Date.now(),
    );
  }
}
export function productionRecord(
  db: Store,
  id: string,
): ProductionRecord | null {
  const r = db
    .prepare("SELECT * FROM injury_production WHERE id=?")
    .get(id) as any;
  if (!r) return null;
  const assets = db
    .prepare(
      "SELECT e.id,e.name,e.mime,a.kind FROM injury_artifacts a JOIN evidence e ON e.id=a.evidence_id WHERE a.production_id=? ORDER BY a.kind",
    )
    .all(id);
  return { ...r, body: JSON.parse(r.body), assets };
}
export function createProduction(
  db: Store,
  user: User,
  caseId: string,
  input: ProductionInput,
) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO injury_production(id,case_id,firm_id,creator,body,updated) VALUES(?,?,?,?,?,?)",
  ).run(id, caseId, user.firm_id, user.id, JSON.stringify(input), Date.now());
  audit(db, user.id, "injury.created", caseId);
  return productionRecord(db, id)!;
}
export function isPlatformAdmin(db: Store, user: User) {
  return !!db
    .prepare(
      "SELECT u.id FROM users u JOIN platform_admins p ON p.user_id=u.id WHERE u.id=? AND u.active=1",
    )
    .get(user.id);
}
