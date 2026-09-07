import type { S3Transport, S3Config } from "../server/evidence-storage";
import type {
  GetObjectCommandOutput,
  PutObjectCommandInput,
  GetObjectCommandInput,
} from "@aws-sdk/client-s3";
export const s3Config: S3Config = {
  bucket: "synthetic-evidence-test",
  region: "us-east-2",
  owner: "123456789012",
};
export function fakeS3() {
  const objects = new Map<string, Buffer>();
  const puts: PutObjectCommandInput[] = [];
  const gets: GetObjectCommandInput[] = [];
  const transport: S3Transport = {
    async put(input) {
      puts.push(input);
      const version = `v${puts.length}`;
      objects.set(`${input.Key}:${version}`, Buffer.from(input.Body as Buffer));
      return { VersionId: version };
    },
    async get(input) {
      gets.push(input);
      const bytes = objects.get(`${input.Key}:${input.VersionId}`);
      if (!bytes) throw new Error("NoSuchKey");
      return {
        ContentLength: bytes.length,
        Body: {
          transformToByteArray: async () => bytes,
        } as unknown as GetObjectCommandOutput["Body"],
      };
    },
  };
  return { transport, objects, puts, gets };
}
