"""Author the local Pikachu fan-art mesh. No downloaded character geometry.

Blender 4.5: blender -b --python scripts/build-pikachu.py -- /tmp/pikachu
All surfaces, facial morphs, and articulated component pivots are generated here.
"""
import bpy, math, os, sys
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def rgba(h):
    cs=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in cs)+(1,)

def mat(name,color,rough=.55,coat=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=rgba(color)
    bs.inputs['Roughness'].default_value=rough
    bs.inputs['Coat Weight'].default_value=coat
    bs.inputs['Coat Roughness'].default_value=.2
    return m

yellow=mat('Warm golden velvet','#ffd234',.56,.07)
bs=yellow.node_tree.nodes.get('Principled BSDF')
bs.inputs['Sheen Weight'].default_value=.20
bs.inputs['Subsurface Weight'].default_value=.035
bs.inputs['Subsurface Radius'].default_value=(.7,.32,.1)
black=mat('Ear tips — soft charcoal','#29201d',.62)
eye=mat('Obsidian eyes','#100d0b',.14,.55)
iris=mat('Warm eye depth','#573320',.24,.4)
glint=mat('Eye catchlights','#fff8e7',.14,.1)
brown=mat('Tail root and back markings','#805020',.68)
mouthmat=mat('Mouth interior','#482327',.83)
tonguemat=mat('Soft coral tongue','#e97582',.63)
nosemat=mat('Nose','#281b18',.37,.2)
gold=mat('Paw creases','#c99321',.75)
cheek=mat('Painted vermilion cheeks','#ed4934',.64)

def mesh(name,verts,faces,material):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    me.materials.append(material)
    for p in me.polygons:p.use_smooth=True
    return ob

def pivot(name,at,parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=at
    bpy.context.view_layer.update()
    if parent:keep_parent(o,parent)
    return o

def keep_parent(o,p):
    bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=p;o.matrix_world=world

def sphere(name,at,scale,material,parent=None,segments=64,rings=40):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=at)
    o=bpy.context.object;o.name=name;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    for p in o.data.polygons:p.use_smooth=True
    if parent:keep_parent(o,parent)
    return o

root=pivot('Pikachu',(0,0,0))
bodyroot=pivot('BodyPivot',(0,0,.53),root)
headroot=pivot('HeadPivot',(0,-.015,1.30),bodyroot)

def head_radius(z):
    c=max(-.99999,min(.99999,(z-1.32)/.445))
    s=math.sqrt(1-c*c)
    return .646*s**.70*(1+.055*math.exp(-((c+.28)/.38)**2)), .425*s**.77

def face_y(x,z):
    rx,ry=head_radius(z)
    v=min(.9999,abs(x)/max(.001,rx))
    return -.025-ry*max(.0001,1-v**(2/.87))**(.91/2)

verts=[];faces=[];N=128;M=72
for j in range(M+1):
    theta=.0001+(math.pi-.0002)*j/M;z=1.32+.445*math.cos(theta);rx,ry=head_radius(z)
    for i in range(N):
        phi=2*math.pi*i/N;sn,cs=math.sin(phi),math.cos(phi)
        verts.append((rx*math.copysign(abs(sn)**.87,sn),-.025+ry*math.copysign(abs(cs)**.91,cs),z))
for j in range(M):
    for i in range(N):
        a=j*N+i;b=j*N+(i+1)%N;faces.append((a,b,b+N,a+N))
head=mesh('Head',verts,faces,yellow);keep_parent(head,headroot)

# A pear-shaped torso: broad hips, soft shoulders, and no cylindrical joints.
verts=[];faces=[];N=96;M=64
for j in range(M+1):
    t=.0001+(math.pi-.0002)*j/M;c=math.cos(t);s=math.sin(t)
    for i in range(N):
        phi=2*math.pi*i/N
        verts.append((.49*s*(1-.20*c)*math.cos(phi),.045+.325*s*(1-.15*c)*math.sin(phi),.605+.525*c))
for j in range(M):
    for i in range(N):a=j*N+i;b=j*N+(i+1)%N;faces.append((a,a+N,b+N,b))
body=mesh('Body',verts,faces,yellow);keep_parent(body,bodyroot)

def tube(name,points,radii,material,parent=None,depth=1,segments=40):
    vv=[];ff=[]
    for j,p in enumerate(points):
        p=Vector(p);tangent=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(j-1,0)])
        tangent.normalize();a=tangent.cross(Vector((0,1,0))).normalized();b=tangent.cross(a).normalized()
        for i in range(segments):
            angle=2*math.pi*i/segments;vv.append(p+a*math.cos(angle)*radii[j]+b*math.sin(angle)*radii[j]*depth)
    for j in range(len(points)-1):
        for i in range(segments):a=j*segments+i;b=j*segments+(i+1)%segments;ff.append((a,b,b+segments,a+segments))
    ob=mesh(name,vv,ff,material)
    if parent:keep_parent(ob,parent)
    return ob

for side,sgn in [('Left',-1),('Right',1)]:
    er=pivot('Ear'+side,(sgn*.425,-.015,1.63),headroot)
    points=[];radii=[]
    for j in range(49):
        t=j/48
        # One ear is slightly more upright; the asymmetry keeps the silhouette warm.
        extent=.37 if sgn<0 else .27
        x=sgn*(.425+extent*t+.025*math.sin(math.pi*t))
        z=1.63+(.79 if sgn<0 else .83)*t-.018*t*t
        y=-.005+.055*math.sin(t*math.pi)-.025*t
        points.append((x,y,z));radii.append(max(.001,.112*math.sin(math.pi*(.15+.85*t))**.72))
    ear=tube('EarSurface'+side,points,radii,yellow,er,depth=.53,segments=56)
    ear.data.materials.append(black)
    for p in ear.data.polygons:
        ring=p.index//56
        if ring>=34:p.material_index=1
    ar=pivot('Arm'+side,(sgn*.395,-.035,.88),bodyroot)
    points=[];radii=[]
    for j in range(33):
        t=j/32
        points.append((sgn*(.395+.11*math.sin(t*math.pi*.74)), -.035-.255*t, .91-.37*t))
        radii.append(max(.002,.132*math.sin(math.pi*t)**.45*(1-.13*t)))
    arm=tube('Paw'+side,points,radii,yellow,ar,depth=.87)
    foot=sphere('Foot'+side,(sgn*.255,-.115,.115),(.173,.274,.116),yellow,bodyroot)
    foot.rotation_euler.z=sgn*math.radians(12)
    # Two shallow creases suggest soft toes, without human fingers.
    for k in [-1,1]:
        x=sgn*.255+k*.051
        tube('Toe crease'+side+str(k),[(x,-.35,.153),(x,-.33,.17),(x,-.305,.184)],[.003,.004,.001],gold,bodyroot,segments=12)

# Cheeks lie on the face surface, with a painted edge instead of raised red buttons.
for side,sgn in [('Left',-1),('Right',1)]:
    vv=[];ff=[];N=64;R=12
    for j in range(R+1):
        r=max(.0001,j/R)
        for i in range(N):
            a=2*math.pi*i/N;x=sgn*.452+.123*r*math.cos(a);z=1.20+.108*r*math.sin(a)
            vv.append((x,face_y(x,z)-.0025-.005*(1-r*r),z))
    for j in range(R):
        for i in range(N):a=j*N+i;b=j*N+(i+1)%N;ff.append((a,a+N,b+N,b))
    ob=mesh('Cheek'+side,vv,ff,cheek);keep_parent(ob,headroot)

for side,sgn in [('Left',-1),('Right',1)]:
    x=sgn*.278;z=1.432;y=face_y(x,z)-.010
    ep=pivot('Eye'+side,(x,y,z),headroot)
    sphere('EyeSurface'+side,(x,y,z),(.084,.030,.098),eye,ep)
    sphere('EyeWarmth'+side,(x,y-.026,z-.033),(.054,.006,.040),iris,ep,segments=40,rings=24)
    sphere('EyePupil'+side,(x,y-.030,z+.008),(.060,.007,.064),eye,ep,segments=40,rings=24)
    sphere('EyeGlint'+side,(x-.025,y-.038,z+.042),(.024,.006,.028),glint,ep,segments=32,rings=20)
    sphere('EyeGlintSmall'+side,(x+.029,y-.034,z-.038),(.010,.004,.010),glint,ep,segments=24,rings=16)

# Small rounded triangular nose.
z=1.315;y=face_y(0,z)-.012
ob=mesh('Nose',[(-.029,y,z+.013),(.029,y,z+.013),(0,y-.004,z-.023),(-.023,y+.02,z+.01),(.023,y+.02,z+.01),(0,y+.018,z-.018)],[(0,2,1),(0,1,4,3),(1,2,5,4),(2,0,3,5),(3,4,5)],nosemat)
bev=ob.modifiers.new('Soft nose corners','BEVEL');bev.width=.009;bev.segments=3
bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=bev.name);keep_parent(ob,headroot)

SHAPES={'aa':(.135,.115),'E':(.165,.051),'I':(.172,.029),'O':(.089,.094),'U':(.070,.060),'PP':(.137,.001),'SS':(.152,.019),'TH':(.145,.040),'DD':(.144,.032),'FF':(.147,.014),'kk':(.135,.072),'nn':(.136,.022),'RR':(.111,.068),'CH':(.106,.055),'sil':(.143,.002)}
MZ=1.183

def mouth_contour(width,height):
    points=[]
    # Characteristic gentle double curve, retained across the vowel shapes.
    for i in range(33):
        u=-1+2*i/32;x=width*u
        top=.018*u*u-.009*math.sin(math.pi*abs(u))
        points.append((x,MZ+top))
    for i in range(33):
        u=1-2*i/32;x=width*u
        top=.018*u*u-.009*math.sin(math.pi*abs(u))
        points.append((x,MZ+top-.006-height*max(0,1-u*u)**.75))
    cx=sum(p[0] for p in points)/len(points);cz=sum(p[1] for p in points)/len(points)
    return [(cx,face_y(cx,cz)-.011,cz)]+[(x,face_y(x,z)-.010,z) for x,z in points]

vv=mouth_contour(.143,.002);ff=[(0,1 if i==len(vv)-1 else i+1,i) for i in range(1,len(vv))]
mouth=mesh('Mouth',vv,ff,mouthmat)
mouth.shape_key_add(name='Basis')
for name,(w,h) in SHAPES.items():
    key=mouth.shape_key_add(name='viseme_'+name)
    for p,co in zip(key.data,mouth_contour(w,h)):p.co=co
keep_parent(mouth,headroot)

def tongue_shape(w,h):
    cy=MZ-.006-h*.65;rx=w*.59;rz=h*.235
    if h<.024:rx=.00001;rz=.00001
    vv=[(0,face_y(0,cy)-.014,cy)]
    for i in range(64):
        a=math.pi*2*i/64;x=rx*math.cos(a);z=cy+rz*math.sin(a)
        vv.append((x,face_y(x,z)-.014-.002*math.sin(a),z))
    return vv
vv=tongue_shape(.143,.002);tongue=mesh('Tongue',vv,[(0,i,1 if i==64 else i+1) for i in range(1,65)],tonguemat)
tongue.shape_key_add(name='Basis')
for name,(w,h) in SHAPES.items():
    key=tongue.shape_key_add(name='viseme_'+name)
    for p,co in zip(key.data,tongue_shape(w,h)):p.co=co
keep_parent(tongue,headroot)

# Subtle lower-face movement accompanies articulation; the eye region stays fixed.
head.shape_key_add(name='Basis')
for name,(w,h) in SHAPES.items():
    key=head.shape_key_add(name='viseme_'+name)
    for p,base in zip(key.data,head.data.vertices):
        x,y,z=base.co
        factor=math.exp(-(x/.27)**2)*max(0,min(1,(1.23-z)/.18))*max(0,min(1,-y/.2))
        p.co.z-=h*.12*factor

tailroot=pivot('TailPivot',(.31,.205,.34),bodyroot)
coords=[(.00,.00),(.24,.055),(.22,.30),(.47,.28),(.38,.64),(.77,.79),(.68,1.24),(.35,1.10),(.43,.77),(.15,.81),(.20,.43),(-.055,.38)]
vv=[(.31+x,.245+d,.34+z) for d in [-.045,.045] for x,z in coords];n=len(coords)
ff=[tuple(range(n)),tuple(range(2*n-1,n-1,-1))]+[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
tail=mesh('LightningTail',vv,ff,yellow);tail.data.materials.append(brown)
bev=tail.modifiers.new('Soft tail bevel','BEVEL');bev.width=.027;bev.segments=4
bpy.context.view_layer.objects.active=tail;bpy.ops.object.modifier_apply(modifier=bev.name)
for p in tail.data.polygons:
    if p.center.z<.58:p.material_index=1
keep_parent(tail,tailroot)

# Soft-edged brown back bands, visible as the body turns.
for j,z in enumerate([.59,.79]):
    ob=sphere('Back stripe '+str(j),(0,.34,z),(.32,.017,.055),brown,bodyroot,segments=48,rings=20)

for ob in bpy.context.scene.objects:
    if ob.type=='MESH':
        # glTF honors smooth normals and the compact material definitions.
        for p in ob.data.polygons:p.use_smooth=True

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'pikachu.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'pikachu.glb'),export_format='GLB',export_animations=False,export_morph=True,export_yup=True)
print('EXPORTED PIKACHU',flush=True)

# Offline preview uses the same camera direction and a neutral warm studio.
world=bpy.data.worlds.new('Warm studio');bpy.context.scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.32,.29,.22,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4
def area(name,at,power,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.location=at;ob.rotation_euler=(Vector((0,0,1.2))-ob.location).to_track_quat('-Z','Y').to_euler()
area('Large softbox',(-3,-4,5),450,4,(1,.92,.78));area('Fill',(3,-2,3),260,3,(.82,.9,1));area('Ear rim',(0,3,4),650,3,(1,.82,.52))
bpy.ops.object.camera_add(location=(.12,-6.8,2.1));cam=bpy.context.object;cam.rotation_euler=(Vector((.1,0,1.24))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.75;bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_x=800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(OUT,'pikachu-preview.png');bpy.ops.render.render(write_still=True)
