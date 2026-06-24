const sharp = require("sharp");

const DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function parseImageDataUrl(imageData, { maxInputBytes }) {
  if (typeof imageData !== "string") {
    throw new Error("Missing image data");
  }

  const match = imageData.match(DATA_URL_PATTERN);
  if (!match || !STRICT_BASE64_PATTERN.test(match[2])) {
    throw new Error("Invalid image data");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > maxInputBytes) {
    throw new Error("Invalid image data");
  }

  return {
    buffer,
    mimeSubtype: match[1] === "jpg" ? "jpeg" : match[1],
  };
}

async function compressToPng(
  imageData,
  { maxInputBytes = 6 * 1024 * 1024, maxPixels = 4 * 1000 * 1000 } = {},
) {
  const { buffer } = parseImageDataUrl(imageData, { maxInputBytes });

  await validateImageMetadata(buffer, { maxPixels });

  return sharp(buffer, { limitInputPixels: maxPixels })
    .png({
      compressionLevel: 9,
    })
    .toBuffer();
}

async function validateImageMetadata(buffer, { maxPixels }) {
  const metadata = await sharp(buffer, {
    limitInputPixels: maxPixels,
  }).metadata();
  const pixels = (metadata.width || 0) * (metadata.height || 0);

  if (!metadata.width || !metadata.height || pixels > maxPixels) {
    throw new Error("Invalid image data");
  }
}

module.exports = { compressToPng, parseImageDataUrl, validateImageMetadata };
