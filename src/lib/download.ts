import { downloadZip } from 'client-zip';
import type { Batch, BatchImage } from './batches';

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

async function toBlob(dataUrl: string) { return (await fetch(dataUrl)).blob(); }

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadImage(img: BatchImage) {
  if (!img.result) return;
  save(await toBlob(img.result), `${stem(img.name)}.png`);
}

/** All finished images as one zip (store-only — PNGs don't compress). Single image → plain PNG. */
export async function downloadBatch(batch: Batch) {
  const done = batch.images.filter(i => i.state === 'done' && i.result);
  if (!done.length) return;
  if (done.length === 1) return downloadImage(done[0]);
  const used = new Set<string>();
  const files = await Promise.all(done.map(async (img) => {
    let name = `${stem(img.name)}.png`, n = 1;
    while (used.has(name)) name = `${stem(img.name)}-${++n}.png`;
    used.add(name);
    return { name, lastModified: new Date(), input: await toBlob(img.result!) };
  }));
  const blob = await downloadZip(files).blob();
  save(blob, `${batch.name.replace(/[\\/:*?"<>|]+/g, '-')}.zip`);
}
