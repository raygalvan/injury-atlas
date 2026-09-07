import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";

/** Library entries mirror the engine's reference groups by id so the viewer
 * can resolve them to BodyParts3D meshes. Generated entries have no engine id
 * until the placement job produces one. */
export type LibraryEntry = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  section: string;
  laterality: string;
  status: "seed" | "queued" | "generating" | "ready" | "failed" | "approved";
  engineId: string | null;
  caseId: string | null;
  generatedFrom: string | null;
  createdBy: string | null;
  created: number;
};
export const SEED_LIBRARY: Omit<
  LibraryEntry,
  "status" | "engineId" | "caseId" | "generatedFrom" | "createdBy" | "created"
>[] = [
  { id: "brain-hemorrhage", name: "Brain reference", shortName: "Brain reference", color: "#b42318", section: "Head & brain", laterality: "unspecified" },
  { id: "skull-fracture", name: "Skull reference", shortName: "Skull reference", color: "#c96712", section: "Head & brain", laterality: "unspecified" },
  { id: "left-ribs-2-4", name: "Left ribs 2–4 reference", shortName: "Left ribs 2–4", color: "#a9362d", section: "Rib cage", laterality: "left" },
  { id: "right-ribs-2-5", name: "Right ribs 2–5 reference", shortName: "Right ribs 2–5", color: "#8f241f", section: "Rib cage", laterality: "right" },
  { id: "right-ribs-8-10", name: "Right ribs 8–10 reference", shortName: "Right ribs 8–10", color: "#701d1d", section: "Rib cage", laterality: "right" },
  { id: "left-costal-cartilage-3-7", name: "Left costal cartilage 3–7", shortName: "Costal cartilage 3–7", color: "#d97706", section: "Rib cage", laterality: "left" },
  { id: "pulmonary-findings", name: "Pulmonary reference", shortName: "Lungs", color: "#9f3b50", section: "Chest", laterality: "bilateral" },
  { id: "periaortic-findings", name: "Periaortic reference", shortName: "Periaortic", color: "#b91c1c", section: "Chest", laterality: "midline" },
];
const KEYWORDS: Record<string, RegExp> = {
  "brain-hemorrhage": /\b(subarachnoid|subdural|epidural|intracranial|brain bleed|h(a)?emorrhage|concussion|brain)\b/i,
  "skull-fracture": /\b(skull|cranial|cranium|frontal bone|orbital|supraorbital|head fracture)\b/i,
  "left-costal-cartilage-3-7": /\b(costal cartilage|costochondral|cartilage)\b/i,
  "pulmonary-findings": /\b(lungs?|pulmonary|pneumothorax|hemothorax|contused lung)\b/i,
  "periaortic-findings": /\b(aorta|aortic|periaortic|mediastin)/i,
};
const UNKNOWN: [RegExp, string][] = [
  [/\bfemur|thigh\b/i, "Femur fracture"],
  [/\bcervical|spine|spinal|vertebra|whiplash\b/i, "Cervical spine injury"],
  [/\bknee|acl|meniscus|patella\b/i, "Knee ligament tear"],
  [/\bshoulder|rotator|clavicle|collarbone\b/i, "Shoulder injury"],
  [/\bankle|foot|metatarsal\b/i, "Ankle fracture"],
  [/\bwrist|radius|forearm|ulna\b/i, "Distal radius fracture"],
  [/\bburn|scald\b/i, "Thermal burn"],
  [/\bpelvi|hip\b/i, "Pelvic fracture"],
  [/\bliver|hepatic|spleen|splenic|kidney|renal|bowel|mesenter\b/i, "Abdominal organ injury"],
];
export type InjuryMatch = { matches: string[]; unmatched: string | null; method: "claude" | "keywords" };

export function ensureInjuryTables(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS injury_library(id TEXT PRIMARY KEY,name TEXT NOT NULL,short_name TEXT NOT NULL,color TEXT NOT NULL,section TEXT NOT NULL,laterality TEXT NOT NULL,status TEXT NOT NULL,engine_id TEXT,case_id TEXT,generated_from TEXT,created_by TEXT,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS case_injuries(case_id TEXT NOT NULL REFERENCES cases(id),injury_id TEXT NOT NULL REFERENCES injury_library(id),hidden INTEGER NOT NULL DEFAULT 0,review_status TEXT NOT NULL DEFAULT 'pending',applied_by TEXT NOT NULL,applied_at INTEGER NOT NULL,PRIMARY KEY(case_id,injury_id));`);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO injury_library(id,name,short_name,color,section,laterality,status,engine_id,case_id,generated_from,created_by,created) VALUES(?,?,?,?,?,?,'seed',?,NULL,NULL,NULL,?)",
  );
  for (const s of SEED_LIBRARY)
    insert.run(s.id, s.name, s.shortName, s.color, s.section, s.laterality, s.id, 0);
}
const row = (r: Record<string, unknown>): LibraryEntry => ({
  id: String(r.id),
  name: String(r.name),
  shortName: String(r.short_name),
  color: String(r.color),
  section: String(r.section),
  laterality: String(r.laterality),
  status: r.status as LibraryEntry["status"],
  engineId: (r.engine_id as string | null) ?? null,
  caseId: (r.case_id as string | null) ?? null,
  generatedFrom: (r.generated_from as string | null) ?? null,
  createdBy: (r.created_by as string | null) ?? null,
  created: Number(r.created),
});
export function listLibrary(db: Store): LibraryEntry[] {
  return (
    db
      .prepare("SELECT * FROM injury_library WHERE engine_id IS NOT NULL ORDER BY created, name")
      .all() as Record<string, unknown>[]
  ).map(row);
}
export function caseInjuries(db: Store, caseId: string) {
  const applied = (
    db
      .prepare("SELECT injury_id AS id,hidden,review_status FROM case_injuries WHERE case_id=? ORDER BY applied_at")
      .all(caseId) as { id: string; hidden: number; review_status: string }[]
  ).map((r) => ({ id: r.id, hidden: !!r.hidden, reviewStatus: r.review_status }));
  const generated = (
    db
      .prepare("SELECT * FROM injury_library WHERE case_id=? AND engine_id IS NULL ORDER BY created")
      .all(caseId) as Record<string, unknown>[]
  )
    .map(row)
    .map((e) => ({ id: e.id, name: e.name, status: e.status }));
  return { applied, generated };
}
export function applyInjuries(
  db: Store,
  caseId: string,
  userId: string,
  injuries: { id: string; hidden: boolean }[],
) {
  const known = new Set(listLibrary(db).map((e) => e.id));
  const wanted = injuries.filter((i) => known.has(i.id));
  db.exec("BEGIN");
  try {
    const keep = wanted.map((i) => i.id);
    if (keep.length)
      db.prepare(
        `DELETE FROM case_injuries WHERE case_id=? AND injury_id NOT IN (${keep.map(() => "?").join(",")})`,
      ).run(caseId, ...keep);
    else db.prepare("DELETE FROM case_injuries WHERE case_id=?").run(caseId);
    const upsert = db.prepare(
      "INSERT INTO case_injuries(case_id,injury_id,hidden,review_status,applied_by,applied_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(case_id,injury_id) DO UPDATE SET hidden=excluded.hidden",
    );
    for (const i of wanted) upsert.run(caseId, i.id, i.hidden ? 1 : 0, userId, Date.now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return caseInjuries(db, caseId);
}
export function queueGeneration(
  db: Store,
  caseId: string,
  userId: string,
  name: string,
  description: string,
) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO injury_library(id,name,short_name,color,section,laterality,status,engine_id,case_id,generated_from,created_by,created) VALUES(?,?,?,?,?,?,'queued',NULL,?,?,?,?)",
  ).run(id, name, name, "#8f241f", "Generated", "unspecified", caseId, description, userId, Date.now());
  return { id, name, status: "queued" as const };
}

export function matchByKeywords(description: string, library: LibraryEntry[]): InjuryMatch {
  const text = description.trim();
  const ids = new Set(library.map((e) => e.id));
  const matches: string[] = [];
  for (const [id, re] of Object.entries(KEYWORDS)) if (ids.has(id) && re.test(text)) matches.push(id);
  if (/\bribs?\b|\brib cage\b/i.test(text)) {
    const left = /\bleft\b/i.test(text), right = /\bright\b/i.test(text);
    const numbers = [...text.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 12);
    const lower = numbers.some((n) => n >= 8) || /\blower ribs?\b|\b(eighth|ninth|tenth)\b/i.test(text);
    const upper = numbers.some((n) => n < 8) || !lower;
    if ((left || !right) && ids.has("left-ribs-2-4")) matches.push("left-ribs-2-4");
    if (right || !left) {
      if (upper && ids.has("right-ribs-2-5")) matches.push("right-ribs-2-5");
      if (lower && ids.has("right-ribs-8-10")) matches.push("right-ribs-8-10");
    }
  }
  const unknown = UNKNOWN.find(([re]) => re.test(text));
  return { matches, unmatched: unknown ? unknown[1] : matches.length ? null : "the injuries described", method: "keywords" };
}

const claudeResult = z.object({
  matches: z.array(z.string()).max(50),
  unmatched: z.array(z.string().min(1).max(120)).max(20),
});
/** Claude matches free text against the catalogue when a key is configured.
 * Any failure falls back to keywords so the viewer always gets an answer. */
export async function matchInjuries(
  description: string,
  library: LibraryEntry[],
  client: Anthropic | null = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null,
): Promise<InjuryMatch> {
  const fallback = matchByKeywords(description, library);
  if (!client) return fallback;
  try {
    const catalogue = library.map((e) => ({ id: e.id, name: e.name, section: e.section, laterality: e.laterality }));
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      output_config: { effort: "low" },
      system:
        "You match a personal-injury description to entries in an anatomical injury catalogue for a 3D demonstrative. " +
        "Reply with JSON only: {\"matches\": [catalogue ids that the description supports], \"unmatched\": [short clinical names of injuries the description mentions that no catalogue entry covers]}. " +
        "Only use ids from the catalogue. Respect laterality: a left-sided injury never matches a right-sided entry. When a side is not stated for ribs, include both sides. Do not invent injuries that are not described.",
      messages: [
        {
          role: "user",
          content: `Catalogue:\n${JSON.stringify(catalogue)}\n\nDescription:\n${description.trim()}`,
        },
      ],
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = claudeResult.parse(JSON.parse(json));
    const ids = new Set(library.map((e) => e.id));
    return {
      matches: [...new Set(parsed.matches.filter((id) => ids.has(id)))],
      unmatched: parsed.unmatched[0] ?? (parsed.matches.length ? null : "the injuries described"),
      method: "claude",
    };
  } catch {
    return fallback;
  }
}
