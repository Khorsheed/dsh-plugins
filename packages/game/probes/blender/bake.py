"""Probe: bake a parts recipe into a rigged, animated .glb plus a preview render.

Run headless:  blender -b -P bake.py -- <recipe.json> <out-dir>

Only the quadruped base and the ear/tail parts the probe recipe uses are
implemented; the point is the pipeline (recipe -> bpy -> glb + png), not a
complete part library.
"""
import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Vector

t0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:]
recipe = json.load(open(argv[0], encoding='utf-8'))
out_dir = argv[1]
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
P = recipe['proportions']


def hex_rgba(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def material(name, color, rough=0.85, backface_cull=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    m.use_backface_culling = backface_cull
    return m


pal = recipe['palette']
MAT_BODY = material('body', hex_rgba(pal['body']))
MAT_ACCENT = material('accent', hex_rgba(pal['accent']))
MAT_EYE = material('eye', hex_rgba(pal['eye']), rough=0.3)
# Inverted-hull ink outline: a flipped, slightly inflated shell rendered
# back-face-culled. It is plain geometry, so it survives glTF export and
# draws the same in three.js without a post-process pass.
MAT_INK = material('ink', (0.02, 0.02, 0.025, 1.0), backface_cull=True)

parts = []  # (object, vertex group name)


def add(obj, group, mat):
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    parts.append((obj, group))
    return obj


L, H = P['bodyLength'], P['bodyHeight']
leg = P['legLength']
body_z = leg + H * 0.5

bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=(0, 0, body_z))
o = bpy.context.object
o.scale = (L * 0.55, H * 0.55, H * 0.5)
add(o, 'body', MAT_BODY)

hs = P['headSize']
head = Vector((L * 0.55, 0, body_z + H * 0.45))
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=hs * 0.5, location=head)
add(bpy.context.object, 'head', MAT_BODY)
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1,
                                     location=(L * 0.42, 0, body_z + H * 0.25))
bpy.context.object.scale = (hs * 0.4, hs * 0.32, hs * 0.5)
bpy.context.object.rotation_euler = (0, math.radians(-35), 0)
add(bpy.context.object, 'head', MAT_BODY)
bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=hs * 0.22, depth=P['snout'] * 1.6,
                                location=head + Vector((hs * 0.45, 0, -hs * 0.08)), rotation=(0, math.radians(90), 0))
add(bpy.context.object, 'head', MAT_BODY)
for side in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=hs * 0.06,
                                         location=head + Vector((hs * 0.38, side * hs * 0.2, hs * 0.1)))
    add(bpy.context.object, 'head', MAT_EYE)

ear = next(p for p in recipe['parts'] if p['type'] == 'ear')
for side in (-1, 1):
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=ear['size'] * 0.45, depth=ear['size'],
                                    location=head + Vector((-hs * 0.05, side * hs * 0.22, hs * 0.5)),
                                    rotation=(side * math.radians(-15), 0, 0))
    add(bpy.context.object, 'head', MAT_ACCENT)

for x in (L * 0.32, -L * 0.32):
    for y in (H * 0.25, -H * 0.25):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1,
                                             location=(x, y, (leg + H * 0.3) / 2))
        bpy.context.object.scale = (0.06, 0.06, (leg + H * 0.3) / 2)
        add(bpy.context.object, 'body', MAT_BODY)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=1, location=(x + 0.03, y, 0.03))
        bpy.context.object.scale = (0.08, 0.06, 0.035)
        add(bpy.context.object, 'body', MAT_ACCENT)

# Tails: tapered tubes built ring by ring so each ring's weight can be spread
# across a three-bone chain; fanned in the Y-Z plane behind the body.
tail = next(p for p in recipe['parts'] if p['type'] == 'tail')
n, tlen, thick = tail['count'], tail['length'], tail['thickness']
fan = math.radians(tail['fan'])
root = Vector((-L * 0.5, 0, body_z + H * 0.1))
RINGS, SEG, BONES = 14, 10, 3
tail_dirs = []
for i in range(n):
    a = -fan / 2 + fan * (i / (n - 1) if n > 1 else 0.5)
    # sweep backwards and up, fanned sideways; tip curls up a little
    d = Vector((-math.cos(math.radians(30)), math.sin(a) * 0.55, math.sin(math.radians(30)) + math.cos(a) * 0.5)).normalized()
    tail_dirs.append(d)
    me = bpy.data.meshes.new(f'tail{i}')
    bm = bmesh.new()
    side = d.cross(Vector((0, 0, 1)))
    side = side.normalized() if side.length > 1e-4 else Vector((0, 1, 0))
    up = side.cross(d).normalized()
    ring_verts = []
    for r in range(RINGS + 1):
        f = r / RINGS
        radius = thick * (0.55 + 1.1 * math.sin(math.pi * min(f * 1.15, 1.0))) * (1 - f * 0.6) + 0.004
        c = root + d * (tlen * f) + up * (tlen * 0.32 * f * f)
        ring_verts.append([bm.verts.new(c + (side * math.cos(t) + up * math.sin(t)) * radius)
                           for t in (2 * math.pi * k / SEG for k in range(SEG))])
    for r in range(RINGS):
        for k in range(SEG):
            bm.faces.new((ring_verts[r][k], ring_verts[r][(k + 1) % SEG], ring_verts[r + 1][(k + 1) % SEG], ring_verts[r + 1][k]))
    bm.faces.new(list(reversed(ring_verts[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(f'tail{i}', me)
    scene.collection.objects.link(obj)
    obj.data.materials.append(MAT_BODY)
    obj.data.materials.append(MAT_ACCENT)
    for p in me.polygons:
        p.use_smooth = True
        # white-tipped look inverted: accent on the last third (tail tips)
        if sum(me.vertices[v].co.copy().__sub__(root).dot(d) for v in p.vertices) / len(p.vertices) > tlen * 0.66:
            p.material_index = 1
    # per-vertex chain weights
    for b in range(BONES):
        vg = obj.vertex_groups.new(name=f'tail{i}.{b}')
        for v in me.vertices:
            f = (v.co - root).dot(d) / tlen * BONES
            w = max(0.0, 1.0 - abs(f - (b + 0.5)))
            if w > 0:
                vg.add([v.index], w, 'REPLACE')
    parts.append((obj, None))

# Assign rigid weights to the primitive parts, then join everything.
for obj, group in parts:
    if group is not None:
        vg = obj.vertex_groups.new(name=group)
        vg.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for obj, _ in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0][0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.object.join()
creature = bpy.context.object
creature.name = recipe['id']
creature.data.materials.append(MAT_INK)
ink_slot = len(creature.data.materials) - 1

# Armature: root -> body -> head, plus a three-bone chain per tail.
arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
b_body = eb.new('body')
b_body.head, b_body.tail = (0, 0, body_z - 0.1), (0, 0, body_z + 0.1)
b_head = eb.new('head')
b_head.head, b_head.tail = head - Vector((0.1, 0, 0)), head + Vector((0.05, 0, 0.1))
b_head.parent = b_body
for i, d in enumerate(tail_dirs):
    prev = b_body
    for b in range(BONES):
        bone = eb.new(f'tail{i}.{b}')
        bone.head = root + d * (tlen * b / BONES)
        bone.tail = root + d * (tlen * (b + 1) / BONES)
        bone.parent = prev
        bone.use_connect = b > 0
        prev = bone
bpy.ops.object.mode_set(mode='OBJECT')

sub = creature.modifiers.new('subdiv', 'SUBSURF')
sub.levels = sub.render_levels = 1
ink = creature.modifiers.new('ink', 'SOLIDIFY')
ink.thickness = -0.012
ink.offset = 1
ink.use_flip_normals = True
ink.material_offset = ink_slot
ink.use_rim = False
mod = creature.modifiers.new('rig', 'ARMATURE')
mod.object = rig
creature.parent = rig

# Idle action: per-tail phase-offset sway + breathing on the body bone.
fps = 24
scene.render.fps = fps
mo = recipe['motion']
frames = round(mo['tailSway']['period'] * fps)
scene.frame_start, scene.frame_end = 0, frames
rig.animation_data_create()
action = bpy.data.actions.new('idle')
rig.animation_data.action = action
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
amp = math.radians(mo['tailSway']['amplitude'])
for fr in range(0, frames + 1, 2):
    ph = 2 * math.pi * fr / frames
    pb = rig.pose.bones['body']
    s = 1 + mo['breath']['amplitude'] * math.sin(ph)
    pb.scale = (1, s, s)
    pb.keyframe_insert('scale', frame=fr)
    for i in range(n):
        for b in range(BONES):
            pb = rig.pose.bones[f'tail{i}.{b}']
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (0, 0, amp * (0.5 + 0.35 * b) * math.sin(ph - i * 0.6 - b * 0.9))
            pb.keyframe_insert('rotation_euler', frame=fr)
bpy.ops.object.mode_set(mode='OBJECT')
t_build = time.time() - t0

glb = os.path.join(out_dir, f"{recipe['id']}.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True, export_animations=True)
t_export = time.time() - t0 - t_build

# Preview render: three-quarter view, soft key light, paper-toned world.
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.location = (2.4, -2.6, 1.5)
target = bpy.data.objects.new('target', None)
target.location = (-0.15, 0, body_z + 0.15)
scene.collection.objects.link(target)
track = cam.constraints.new('TRACK_TO')
track.target = target
track.track_axis, track.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'
cam.data.lens = 45
scene.view_settings.view_transform = 'Standard'
scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(45), math.radians(10), math.radians(30))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('paper')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = hex_rgba('#f3ecdd')
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
scene.world = world
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
scene.render.engine = next(e for e in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'BLENDER_WORKBENCH') if e in engines)
scene.render.resolution_x = scene.render.resolution_y = 768
scene.render.film_transparent = False
scene.frame_set(frames // 4)
png = os.path.join(out_dir, f"{recipe['id']}.png")
scene.render.filepath = png
bpy.ops.render.render(write_still=True)
t_render = time.time() - t0 - t_build - t_export

stats = {
    'engine': scene.render.engine,
    'blender': bpy.app.version_string,
    'build_s': round(t_build, 2), 'export_s': round(t_export, 2), 'render_s': round(t_render, 2),
    'glb_bytes': os.path.getsize(glb),
    'bones': len(rig.data.bones), 'frames': frames,
}
print('PROBE_STATS ' + json.dumps(stats))
