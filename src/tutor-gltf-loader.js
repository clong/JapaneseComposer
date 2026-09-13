// Decode the bundled compressed character locally, without a decoder CDN.
import { GLTFLoader as BaseGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
export class GLTFLoader extends BaseGLTFLoader {
  constructor(manager) { super(manager); this.setMeshoptDecoder(MeshoptDecoder); }
}
