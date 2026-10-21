// Load the baked glb the way the game runtime would (GLTFLoader.parse), then
// step the idle clip through an AnimationMixer and confirm the tails move.
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const buf = readFileSync(process.argv[2])
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(ab, '', ok, fail))
let meshes = 0, skinned = 0, tris = 0, bones = 0
const mats = new Set()
gltf.scene.traverse(o => {
  if (o.isMesh) { meshes++; if (o.isSkinnedMesh) skinned++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
    for (const m of [o.material].flat()) mats.add(`${m.name}${m.side === THREE.FrontSide ? '' : '(double)'}`) }
  if (o.isBone) bones++
})
const clip = gltf.animations[0]
const mixer = new THREE.AnimationMixer(gltf.scene)
mixer.clipAction(clip).play()
const tip = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('tail4.2'))
const q0 = tip.quaternion.clone(); mixer.update(clip.duration / 4)
const moved = tip.quaternion.angleTo(q0)
console.log(JSON.stringify({ meshes, skinned, bones, tris: Math.round(tris), materials: [...mats], clips: gltf.animations.map(a => `${a.name} ${a.duration.toFixed(2)}s ${a.tracks.length} tracks`), tailTipRotatedRad: +moved.toFixed(3) }))
