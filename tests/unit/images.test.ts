import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  getPublicImageUrl,
  prepareImage,
} from "@/server/services/images";

async function pngFile(): Promise<File> {
  const buffer = await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  })
    .png()
    .toBuffer();
  return new File([buffer], "photo.png", { type: "image/png" });
}

describe("image preparation", () => {
  it("re-encodes accepted images as WebP", async () => {
    const image = await prepareImage(await pngFile());
    expect(image.contentType).toBe("image/webp");
    expect(image.width).toBe(4);
    expect(image.height).toBe(3);
    expect(image.buffer.length).toBeGreaterThan(0);
  });

  it("rejects non-image content even with an image filename", async () => {
    const file = new File(["not an image"], "fake.png", {
      type: "image/png",
    });
    await expect(prepareImage(file)).rejects.toThrow(
      /JPEG, PNG, or WebP/,
    );
  });

  it("rejects files over the size limit", async () => {
    const file = new File([Buffer.alloc(MAX_IMAGE_BYTES + 1)], "large.png", {
      type: "image/png",
    });
    await expect(prepareImage(file)).rejects.toThrow(/5 MB/);
  });

  it("builds public URLs only for stored objects", () => {
    expect(getPublicImageUrl(null)).toBeNull();
    expect(getPublicImageUrl(undefined)).toBeNull();
  });
});
