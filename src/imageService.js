const sharp = require("sharp");

const DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/=]+)$/;

function parseImageDataUrl(imageData) {
  if (typeof imageData !== "string") {
    throw new Error("Missing image data");
  }

  const match = imageData.match(DATA_URL_PATTERN);
  if (!match) {
    throw new Error("Invalid image data");
  }

  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeSubtype: match[1] === "jpg" ? "jpeg" : match[1],
  };
}

async function compressToPng(imageData) {
  const { buffer } = parseImageDataUrl(imageData);

  return sharp(buffer)
    .png({
      compressionLevel: 9,
    })
    .toBuffer();
}

module.exports = { compressToPng, parseImageDataUrl };
