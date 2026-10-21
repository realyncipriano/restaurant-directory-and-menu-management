import "server-only";

import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getR2Config } from "@/lib/env";
import { ConflictError } from "@/lib/errors";

let cachedClient: { endpoint: string; client: S3Client } | null = null;

function getClient(): S3Client {
  const config = getR2Config();
  if (!config) {
    throw new ConflictError("Object storage is not configured.");
  }
  if (cachedClient?.endpoint === config.endpoint) {
    return cachedClient.client;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClient = { endpoint: config.endpoint, client };
  return client;
}

export function isStorageConfigured(): boolean {
  return getR2Config() !== null;
}

export function isPublicStorageConfigured(): boolean {
  return Boolean(getR2Config()?.publicBaseUrl);
}

export function buildObjectKey(prefix: string, extension: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${prefix}/${Date.now()}-${randomUUID()}.${safeExtension}`;
}

export function getPublicUrl(
  objectKey: string | null | undefined,
): string | null {
  if (!objectKey) return null;
  const config = getR2Config();
  if (!config?.publicBaseUrl) return null;
  const path = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${config.publicBaseUrl}/${path}`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl = "public, max-age=31536000, immutable",
): Promise<void> {
  const config = getR2Config();
  if (!config) {
    throw new ConflictError("Object storage is not configured.");
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export async function deleteObject(
  objectKey: string | null | undefined,
): Promise<void> {
  if (!objectKey) return;
  const config = getR2Config();
  if (!config) return;

  try {
    await getClient().send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }),
    );
  } catch (error) {
    console.error("[r2] Failed to delete an object.", error);
  }
}

export async function readObject(objectKey: string): Promise<Buffer> {
  const config = getR2Config();
  if (!config) {
    throw new ConflictError("Object storage is not configured.");
  }

  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    }),
  );
  if (!response.Body) {
    throw new ConflictError("The stored file could not be read.");
  }
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getSignedObjectUrl(
  objectKey: string,
  expiresInSeconds = 300,
): Promise<string> {
  const config = getR2Config();
  if (!config) {
    throw new ConflictError("Object storage is not configured.");
  }

  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    }),
    { expiresIn: Math.min(Math.max(expiresInSeconds, 30), 3600) },
  );
}
