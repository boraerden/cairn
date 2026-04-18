import { S3Client, GetObjectCommand, PutObjectCommand, type PutObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

export const s3 = new S3Client({ region: env.REGION });

export async function getObjectText(key: string): Promise<{ body: string; etag: string } | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.BUCKET, Key: key }));
    const body = await res.Body!.transformToString("utf-8");
    const etag = (res.ETag ?? "").replace(/"/g, "");
    return { body, etag };
  } catch (err: unknown) {
    if ((err as { name?: string; $metadata?: { httpStatusCode?: number } }).name === "NoSuchKey") return null;
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function putObjectText(
  key: string,
  body: string,
  options: { contentType?: string; ifMatchEtag?: string | null } = {},
): Promise<{ etag: string }> {
  const input: PutObjectCommandInput = {
    Bucket: env.BUCKET,
    Key: key,
    Body: body,
    ContentType: options.contentType ?? "application/json; charset=utf-8",
  };
  // S3 PutObject supports IfMatch only on newer APIs; we implement optimistic locking at the handler layer by re-reading before write.
  const res = await s3.send(new PutObjectCommand(input));
  return { etag: (res.ETag ?? "").replace(/"/g, "") };
}

export async function presignPut(key: string, contentType: string, ttlSeconds: number): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: env.BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSeconds });
}

export async function presignGet(key: string, ttlSeconds: number): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: env.BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSeconds });
}
