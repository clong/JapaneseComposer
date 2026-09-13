// Offline authoring utility. Blender and glTF Transform are not needed at runtime.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { resolve } from 'node:path';
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/optimize-tutor-characters.js /path/to/blender-exports [character-id ...]');
const ids = process.argv.slice(3);
if (!ids.length) ids.push('pikachu');
for (const id of ids) if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`Invalid character ID: ${id}`);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
for (const id of ids) {
  const document = await io.read(resolve(input, `${id}.glb`));
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16 }), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }));
  await io.write(resolve('src/assets/tutor', `${id}.glb`), document);
  console.log(`Optimized ${id}`);
}
