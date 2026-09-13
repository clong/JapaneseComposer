# Pikachu character provenance

`pikachu.glb` is original fan-art geometry authored for Japanese Composer with `scripts/build-pikachu.py`. The script constructs the head, pear-shaped body, tapered ears, painted cheeks, glossy eyes, paws, and beveled lightning-bolt tail. No downloaded character mesh, extracted game asset, MPFB body, or external texture is included.

Pikachu is a Pokémon character. Creating this mesh does not grant rights to the underlying character or place it in the public domain.

- Authoring: Blender 4.5.3 LTS; `scripts/build-pikachu.py` generates an editable `.blend`, uncompressed GLB, and studio preview.
- Optimization: glTF Transform 4.5.0 and Meshopt; `scripts/optimize-tutor-characters.js` produces the bundled GLB.
- Articulation: 15 viseme targets on `Head`, `Mouth`, and `Tongue`; articulated head, ear, paw, tail, and eye pivots. The model has no humanoid skeleton.
- Materials: locally defined yellow satin, charcoal ear tips, glassy dark eyes, vermilion cheeks, and soft coral tongue. The browser supplies studio lights and environment reflections.
- Portrait and thumbnail: rendered from the same shipped GLB during the Chrome portrait check.
- Preview voice: AI-generated Japanese recording from `gpt-4o-mini-tts-2025-12-15`, voice marin. `preview-ja.json` records its input and generation time. It is independent of the character and does not imitate a Pokémon actor.
- Runtime speech animation: local HeadAudio analysis; see `src/vendor/headaudio/PROVENANCE.md` and `THIRD_PARTY_NOTICES.md` for the code license and classifier changes.

Blender and the optimizer are authoring tools, not production runtime dependencies.
