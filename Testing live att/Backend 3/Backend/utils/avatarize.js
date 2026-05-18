'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const AVATAR_SCRIPT = path.join(__dirname, '..', '..', 'Python', 'avatar_maker.py');
const FACES_DIR     = path.join(__dirname, '..', 'uploads', 'faces');

/**
 * Generates a cartoon avatar for a given image file.
 *
 * The avatar is saved as:   <original_name>_avatar.jpg   (or .png if circle=true)
 * alongside the original file in uploads/faces/.
 *
 * Returns the relative path  uploads/faces/<name>_avatar.jpg
 * or null on failure.
 */
function generateAvatar(sourceImagePath, options = {}) {
  return new Promise((resolve) => {
    if (!fs.existsSync(sourceImagePath)) {
      console.warn('[Avatar] Source not found:', sourceImagePath);
      return resolve(null);
    }

    const { circle = false, size = 512 } = options;
    const parsed  = path.parse(sourceImagePath);
    const outExt  = circle ? '.png' : '.jpg';
    const outName = parsed.name + '_avatar' + outExt;
    const outPath = path.join(parsed.dir, outName);

    const args = [AVATAR_SCRIPT, sourceImagePath, outPath, '--size', String(size)];
    if (circle) args.push('--circle');

    const py = spawn('python', args);

    py.stdout.on('data', (d) => process.stdout.write('[Avatar] ' + d));
    py.stderr.on('data', (d) => process.stderr.write('[Avatar] ' + d));

    py.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        const relPath = 'uploads/faces/' + outName;
        console.log('[Avatar] Generated:', relPath);
        resolve(relPath);
      } else {
        console.warn('[Avatar] Script exited with code', code);
        resolve(null);
      }
    });

    py.on('error', (err) => {
      console.warn('[Avatar] Spawn error:', err.message);
      resolve(null);
    });
  });
}

/**
 * Process all images in uploads/faces/ that don't already have an avatar.
 * Useful for back-filling existing employees.
 */
async function batchGenerateAvatars(options = {}) {
  const files = fs.readdirSync(FACES_DIR).filter(
    (f) => /\.(jpg|jpeg|png)$/i.test(f) && !f.includes('_avatar')
  );
  console.log(`[Avatar] Batch: ${files.length} images to process`);
  const results = [];
  for (const f of files) {
    const src = path.join(FACES_DIR, f);
    const out = await generateAvatar(src, options);
    results.push({ file: f, avatar: out });
  }
  return results;
}

module.exports = { generateAvatar, batchGenerateAvatars };
