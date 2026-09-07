import { createEvidenceStorage, s3ConfigFromEnv } from "./evidence-storage";
import { token } from "./store";
const config = s3ConfigFromEnv();
if (!config) throw new Error("S3_BUCKET is not configured");
const storage = createEvidenceStorage(process.env.DATA_DIR || "data", config);
const id = token();
const body = Buffer.from(
  "injury.bot S3 connection check. Synthetic data only.\n",
);
const reference = await storage.put({
  file: id,
  firmId: "_checks",
  caseId: id,
  body,
});
const received = await storage.get(reference);
if (!received.equals(body))
  throw new Error("S3 write/read verification failed");
console.log(
  `S3 write/read verified for ${config.bucket} in ${config.region}. Versioned synthetic check retained under evidence/_checks/.`,
);
