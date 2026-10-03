// Rule 9 of the Rendra umbrella: each image goes out in the lightest format with no visible loss.
// Candidates: lossless WebP, lossy WebP q90 and optimized PNG (PNG or JPG q92 4:4:4 for the og-image).
// A lossy candidate only competes when it stays above PSNR_MIN against the original (text stays sharp).
const sharp = require('sharp');

const PSNR_MIN = 45; // dB; below this, color fringes around small text start to show

async function psnr(original, candidate) {
  const a = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(candidate).removeAlpha().raw().toBuffer();
  if (a.data.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < b.length; i++) { const d = a.data[i] - b[i]; sum += d * d; }
  if (sum === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / (sum / b.length));
}

// png: Buffer with the lossless capture. kind: 'screen' (WebP/PNG) or 'social' (PNG/JPG).
// Returns { ext, buffer, mode, tried } with the smallest acceptable candidate.
async function imagemMaisLeve(png, kind = 'screen') {
  const cands = [{ ext: 'png', mode: 'png', buffer: await sharp(png).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer() }];
  if (kind === 'social') {
    cands.push({ ext: 'jpg', mode: 'jpg q92', buffer: await sharp(png).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer(), lossy: true });
  } else {
    cands.push({ ext: 'webp', mode: 'webp sem perda', buffer: await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer() });
    cands.push({ ext: 'webp', mode: 'webp q90', buffer: await sharp(png).webp({ quality: 90, effort: 6, smartSubsample: true }).toBuffer(), lossy: true });
  }
  for (const c of cands) c.psnr = c.lossy ? await psnr(png, c.buffer) : Infinity;
  const ok = cands.filter(c => !c.lossy || c.psnr >= PSNR_MIN).sort((x, y) => x.buffer.length - y.buffer.length);
  const best = ok[0];
  return { ext: best.ext, buffer: best.buffer, mode: best.mode, tried: cands.map(c => ({ ext: c.ext, mode: c.mode, bytes: c.buffer.length, psnr: c.psnr })) };
}

module.exports = { imagemMaisLeve, PSNR_MIN };
