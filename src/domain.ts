export type Member = {
  id: string;
  name: string;
  email: string;
  platformAdmin?: boolean;
  role: "owner" | "attorney" | "client";
};
export type Case = {
  id: string;
  title: string;
  client: string;
  incident: string;
  archived: number;
};
export type Evidence = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
  created: number;
};
export type Finding = {
  id: string;
  anatomicalStructure: string;
  evidenceId: string;
  citation: string;
  notes: string;
  type: string;
  laterality: string;
  sourceStatus: string;
  attorneyReviewStatus: string;
  placementStatus: string;
  renderStatus: string;
};
