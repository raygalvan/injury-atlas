import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
  type PutObjectCommandOutput,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
export type EvidenceWrite = {
  file: string;
  firmId: string;
  caseId: string;
  body: Buffer;
};
export interface EvidenceStorage {
  put(input: EvidenceWrite): Promise<string>;
  get(reference: string): Promise<Buffer>;
}
export type S3Config = { bucket: string; region: string; owner: string };
export interface S3Transport {
  put(
    input: PutObjectCommandInput,
  ): Promise<Pick<PutObjectCommandOutput, "VersionId">>;
  get(
    input: GetObjectCommandInput,
  ): Promise<Pick<GetObjectCommandOutput, "Body" | "ContentLength">>;
}
const segment = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new Error("Invalid storage identifier");
  return value;
};
export function s3ConfigFromEnv(env = process.env): S3Config | undefined {
  if (!env.S3_BUCKET) return undefined;
  const config = {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION || env.AWS_REGION || "us-east-2",
    owner: env.S3_EXPECTED_BUCKET_OWNER || "",
  };
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(config.region) ||
    !/^\d{12}$/.test(config.owner)
  )
    throw new Error(
      "Configure a valid S3_BUCKET, S3_REGION and S3_EXPECTED_BUCKET_OWNER",
    );
  return config;
}

// Existing bare-token references always read from EBS. New S3 references pin the
// bucket, region and object version, so later versions never replace the evidence.
export function createEvidenceStorage(
  dataDir: string,
  config?: S3Config,
  transport?: S3Transport,
): EvidenceStorage {
  const directory = path.resolve(dataDir, "evidence");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (config && !transport) {
    const client = new S3Client({ region: config.region });
    transport = {
      put: (input) => client.send(new PutObjectCommand(input)),
      get: (input) => client.send(new GetObjectCommand(input)),
    };
  }
  const s3 = transport;
  return {
    async put({ file, firmId, caseId, body }) {
      segment(file);
      if (body.length > MAX_EVIDENCE_BYTES)
        throw new Error("Evidence exceeds the upload limit");
      if (!config) {
        await writeFile(path.join(directory, file), body, {
          mode: 0o600,
          flag: "wx",
        });
        return file;
      }
      const key = `evidence/${segment(firmId)}/${segment(caseId)}/${file}`;
      const output = await s3!.put({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ExpectedBucketOwner: config.owner,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
        IfNoneMatch: "*",
      });
      if (!output.VersionId || output.VersionId === "null")
        throw new Error(
          "S3 bucket versioning must be enabled before uploading evidence",
        );
      return (
        "s3:" +
        JSON.stringify({
          bucket: config.bucket,
          region: config.region,
          key,
          versionId: output.VersionId,
        })
      );
    },
    async get(reference) {
      if (!reference.startsWith("s3:"))
        return readFile(path.join(directory, segment(reference)));
      if (!config || !s3)
        throw new Error("S3 must remain configured to read S3 evidence");
      const stored = JSON.parse(reference.slice(3));
      if (
        stored.bucket !== config.bucket ||
        stored.region !== config.region ||
        typeof stored.key !== "string" ||
        !/^evidence\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/.test(
          stored.key,
        ) ||
        typeof stored.versionId !== "string" ||
        !stored.versionId ||
        stored.versionId === "null"
      )
        throw new Error(
          "Invalid S3 evidence reference or mismatched bucket configuration",
        );
      const output = await s3.get({
        Bucket: config.bucket,
        Key: stored.key,
        VersionId: stored.versionId,
        ExpectedBucketOwner: config.owner,
      });
      if (
        !output.Body ||
        output.ContentLength === undefined ||
        output.ContentLength > MAX_EVIDENCE_BYTES
      )
        throw new Error("Invalid S3 evidence object");
      const body = Buffer.from(await output.Body.transformToByteArray());
      if (body.length > MAX_EVIDENCE_BYTES)
        throw new Error("Evidence exceeds the download limit");
      return body;
    },
  };
}
