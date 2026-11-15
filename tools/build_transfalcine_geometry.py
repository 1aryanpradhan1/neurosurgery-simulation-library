"""Build approach-specific atlas cutaways and illustrative instruments."""
import argparse
import base64
import json
import math
import re
from functools import lru_cache
from pathlib import Path

import numpy as np

REGIONS = {
    'anterior': {'z': 2.56, 'half': .68, 'floor': 1.2, 'deep': .38, 'target': 1.72,
                 'figure': 1, 'page': 2, 'falx_z': 1.83, 'falx_half': .53, 'falx_top': 2.56},
    'middle': {'z': 1.05, 'half': .76, 'floor': 1.55, 'deep': .92, 'target': .12,
               'figure': 2, 'page': 3, 'falx_z': .52, 'falx_half': .61, 'falx_top': 2.62},
    'posterior': {'z': -4.02, 'half': .66, 'floor': .34, 'deep': .11, 'target': -2.17,
                  'figure': 3, 'page': 4, 'falx_z': -2.76, 'falx_half': .69, 'falx_top': 1.46},
}

def decode(mesh):
    return np.frombuffer(base64.b64decode(mesh['data']), dtype='<f4').reshape(-1, 3, 6)

def encode(mesh, triangles):
    points = np.asarray(triangles, dtype='<f4').reshape(-1, 6)
    if not len(points):
        return None
    assert np.isfinite(points).all(), mesh['id']
    bounds = [points[:, :3].min(0), points[:, :3].max(0)]
    center = np.mean(bounds, axis=0)
    anchor = points[np.argmin(np.sum((points[:, :3] - center)**2, axis=1)), :3]
    return dict(mesh, count=len(points), data=base64.b64encode(points.tobytes()).decode(),
                bounds=[point.tolist() for point in bounds], anchor=anchor.tolist())

def cut(triangles, axis, threshold, positive):
    """Split a triangle soup against one plane, interpolating vertex attributes."""
    if not len(triangles):
        return triangles, triangles
    dist = (triangles[:, :, axis] - threshold) * (1 if positive else -1)
    inside = (dist >= 0).all(1)
    outside = (dist < 0).all(1)
    kept, rejected = [triangles[inside]], [triangles[outside]]
    for tri, ds in zip(triangles[~(inside | outside)], dist[~(inside | outside)]):
        a, b = [], []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            (a if ds[i] >= 0 else b).append(tri[i])
            if (ds[i] >= 0) != (ds[j] >= 0):
                hit = tri[i] + (tri[j] - tri[i]) * (ds[i] / (ds[i] - ds[j]))
                a.append(hit)
                b.append(hit)
        for poly, group in ((a, kept), (b, rejected)):
            if len(poly) >= 3:
                group.append(np.asarray([[poly[0], poly[i], poly[i+1]] for i in range(1, len(poly)-1)]))
    return np.concatenate(kept), np.concatenate(rejected)

def partition(triangles, planes):
    outside = []
    for axis, coordinate, positive in planes:
        triangles, rejected = cut(triangles, axis, coordinate, positive)
        outside.append(rejected)
    return triangles, np.concatenate(outside)

def flat(triangles):
    points = np.asarray(triangles)
    normals = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
    mag = np.linalg.norm(normals, axis=1)
    good = mag > 1e-9
    return np.concatenate((points[good], np.repeat((normals[good] / mag[good, None])[:, None, :], 3, axis=1)), axis=2)

def tube(points, radius, sides=10):
    points = np.asarray(points, dtype=float)
    direction = points[-1] - points[0]
    direction /= np.linalg.norm(direction)
    axis = np.eye(3)[np.argmin(np.abs(direction))]
    a = np.cross(direction, axis)
    a /= np.linalg.norm(a)
    b = np.cross(direction, a)
    theta = np.arange(sides) * (2 * np.pi / sides)
    normal = np.cos(theta)[:, None] * a + np.sin(theta)[:, None] * b
    rows = [np.concatenate((point + radius * normal, normal), axis=1) for point in points]
    triangles = []
    for r, t in zip(rows, rows[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            triangles.extend(([r[j], r[k], t[j]], [r[k], t[k], t[j]]))
    caps = [[points[i], rows[i][j, :3], rows[i][(j+1) % sides, :3]] for i in [0, -1] for j in range(sides)]
    return np.concatenate((triangles, flat(caps)))

def native(records, medial_guide):
    previous = medial_guide.read_text()
    old = json.loads(re.search(r'id="mesh-data">(.*?)</script>', previous, re.S)[1])
    records.extend(dict(m, id='MED-'+m['id']) for m in old if m['id'] in {
        'ZA-15','ZA-18','ZA-27','ZA-46','ZA-47','ZA-58','ZA-63'
    })
    return records

def build(reference_json, medial_guide, output):
    atlas = native(json.loads(reference_json.read_text()), medial_guide)
    ids = {'ZA-3','ZA-22','ZA-23','CTX-20'}
    vault = [m for m in atlas if m['id'] in ids]
    bone = [m for m in atlas if m['group'] == 'bone' and m['id'].startswith(('ZA-', 'CTX-'))
            and not re.search(r'ethmoid|hyoid|incus|malleus|sinus of|stapes', m['name'], re.I)]
    cortex = [m for m in atlas if m['group'] == 'brain' and m['id'].startswith('CTX-')
              and re.search(r'gyrus|gyri|cuneus|parietal lobule|precuneus|occipital pole',m['name'],re.I)
              and not re.search(r'temporal|insul|orbital|rectus|fusiform|uncus',m['name'],re.I)
              and m['bounds'][1][1] > -.25]
    vascular = [m for m in atlas if m['id'] in {'CTX-405','CTX-406','CTX-417','CTX-418'}
                or m['id'].startswith('MED-') and m['id'] != 'MED-ZA-18']
    falx = next(m for m in atlas if m['id'] == 'MED-ZA-18')
    result = []
    def add(mesh):
        if mesh:
            result.append(mesh)
    def create(identifier, name, group, color, triangles, **extra):
        add(encode(dict(id=identifier,name=name,nativeName=name,group=group,color=color,
                        source='Illustrative geometry registered to native atlas landmarks',**extra), triangles))
    for m in bone + cortex + vascular:
        extra = {}
        if m in cortex or re.search(r'callosomarginal|pericallosal', m['name'], re.I):
            extra['gravitySide'] = 'right' if m['name'].startswith('Right') else 'left'
        add(dict(m, contextOnly=False, procedureSide='both', part='vaultOriginal' if m['id'] in ids else '',
                 group='brain' if m['id']=='MED-ZA-15' else m['group'], **extra))
    # Cast vertical rays through the native vault and cortex separately. Keep
    # both tables of the skull, with the presented cortical surface beneath them.
    def vertical_hits(vertices):
        low, high = vertices.min(1), vertices.max(1)
        bins = {}

        @lru_cache(maxsize=None)
        def hits(x, z):
            box = (math.floor(x*3), math.floor(z*3))
            if box not in bins:
                a, b = np.array(box)/3
                interval = (low[:,0]<=a+1/3)&(high[:,0]>=a)&(low[:,2]<=b+1/3)&(high[:,2]>=b)
                bins[box] = vertices[interval]
            t = bins[box]
            if not len(t):
                return ()
            p,b,c = t[:,0],t[:,1]-t[:,0],t[:,2]-t[:,0]
            determinant = b[:,0]*c[:,2]-b[:,2]*c[:,0]
            valid = abs(determinant)>1e-8
            p,b,c,determinant = p[valid],b[valid],c[valid],determinant[valid]
            u = ((x-p[:,0])*c[:,2]-(z-p[:,2])*c[:,0])/determinant
            v = (b[:,0]*(z-p[:,2])-b[:,2]*(x-p[:,0]))/determinant
            y = (p[:,1]+u*b[:,1]+v*c[:,1])[(u>=-1e-5)&(v>=-1e-5)&(u+v<=1.00001)]
            return tuple(sorted(map(float, y), reverse=True))
        return hits

    def native_hits(records):
        return vertical_hits(np.concatenate([decode(m)[:, :, :3] for m in records]))

    vault_hits, cortex_hits = native_hits(vault), native_hits(cortex)

    # The Pterional layers were fitted to this same skull. Reuse their
    # continuous outer surfaces and smooth normals, then cut the Transfalcine
    # flap from them. Retire the roof grid whose clipped cells made a sawtooth rim.
    scalp_center = np.array([0, -.4, -.4])
    scalp_surfaces, scalp_height = {}, {}
    for layer in ('skin', 'galea', 'pericranium'):
        surfaces = []
        for mesh in atlas:
            if mesh['group'] != layer or not mesh['id'].startswith('ILL-') or mesh.get('marker'):
                continue
            tri = decode(mesh)
            radial = tri[:, :, :3] - scalp_center
            normal = tri[:, :, 3:]
            # Outer sheet normals point away from the shell center. The
            # inward sheet and near-tangent seam walls belong to the old flap.
            alignment = np.sum(radial * normal, axis=2) / np.maximum(
                1e-8, np.linalg.norm(radial, axis=2) * np.linalg.norm(normal, axis=2))
            faces = np.cross(tri[:, 1, :3] - tri[:, 0, :3], tri[:, 2, :3] - tri[:, 0, :3])
            outward = np.sum(faces * radial.mean(axis=1), axis=1)
            surfaces.append(tri[(alignment > .40).all(axis=1) & (outward > 0)])
        if not surfaces:
            raise ValueError(f"Reference atlas is missing the fitted Pterional {layer} surfaces.")
        scalp_surfaces[layer] = np.concatenate(surfaces)
        scalp_height[layer] = vertical_hits(scalp_surfaces[layer][:, :, :3])

    def scalp_y(layer, x, z):
        hits = scalp_height[layer](float(x), float(z))
        return hits[0] if hits else float('nan')

    @lru_cache(maxsize=None)
    def tables(x, z):
        heights = vault_hits(float(x), float(z))
        if not heights:
            return float('nan'), float('nan')
        outer = heights[0]
        # Ignore near-coincident hits where two atlas bones meet at a suture.
        if z < -3.1:
            # The posterior vault is thicker and more oblique to these rays.
            # Prefer the inner-table band over close sutural crossings.
            expected = .40 + max(0, -z-4.02)*.45
            candidates = [y for y in heights[1:] if .19 < outer-y < 1.05]
            inner = min(candidates, key=lambda y: abs(outer-y-expected), default=outer-expected)
        else:
            inner = next((y for y in heights[1:] if .06 < outer-y < .59), outer-.17)
        return outer, inner

    def top(x, z):
        return tables(x, z)[0]

    def cranial_section(points, direction):
        rows = []
        for x, z in points:
            outer, inner = tables(x, z)
            rows.append(([x, outer, z], [x, inner, z]))
        faces = []
        for (a,b),(c,d) in zip(rows, rows[1:]):
            if np.isfinite([a,b,c,d]).all():
                for tri in ([a,b,c], [c,b,d]):
                    if np.dot(np.cross(np.subtract(tri[1],tri[0]),np.subtract(tri[2],tri[0])),direction) < 0:
                        tri = tri[::-1]
                    faces.append(tri)
        return flat(faces)

    @lru_cache(maxsize=None)
    def dura_height(x, z):
        # Fill isolated sutural variation with neighboring inner-table hits.
        outer, _ = tables(x,z)
        inner = np.median([tables(x+dx,z+dz)[1] for dx,dz in ((0,0),(-.022,0),(.022,0),(0,-.022),(0,.022))])
        brain = max((height for dx,dz in ((0,0),(-.037,0),(.037,0),(0,-.037),(0,.037))
                     for height in cortex_hits(float(x+dx),float(z+dz))), default=-math.inf)
        # The leaflet may enter the intended bone window's volume when the
        # source cortex crosses the inner table, while remaining under the exterior.
        return min(outer-.042, max(inner-.030,brain+.045))

    def sheet(x0,x1,z0,z1,offset, nx=26,nz=26, height=top):
        xs,zs=np.linspace(x0,x1,nx+1),np.linspace(z0,z1,nz+1)
        points=np.array([[[x,height(float(x),float(z))+offset,z] for z in zs] for x in xs])
        out=[]
        for i in range(nx):
            for j in range(nz):
                a,b,c,d=points[i,j],points[i,j+1],points[i+1,j+1],points[i+1,j]
                for tri in ((a,b,c),(a,c,d)):
                    if np.isfinite(tri).all() and np.max([np.linalg.norm(tri[k]-tri[k-1]) for k in range(3)]) < .65:
                        out.append(tri)
        return flat(out)
    for region,spec in REGIONS.items():
        z,h,floor=spec['z'],spec['half'],spec['floor']
        for side,sign in [('right',1),('left',-1)]:
            tag=f'{region}-{side}'
            x0,x1=sorted([-1.54*sign,.62*sign])
            z0,z1=z-h,z+h
            meta=dict(region=region,entrySide=side,procedureSide='both')
            def part(key,name,group,color,faces,**kw):
                create(tag+'-'+key,name,group,color,faces,**meta,**kw)
            # Opposite faces of the same narrow saw kerf. Keep the cut surface
            # separate from the native inner and outer cortical tables.
            kerf = .026
            cut_floor = .04 if region == 'posterior' else floor
            for m in vault:
                triangles = decode(m)
                _, outside = partition(triangles,[(0,x0,True),(0,x1,False),(2,z0,True),(2,z1,False),(1,cut_floor,True)])
                inside, _ = partition(triangles,[(0,x0+kerf,True),(0,x1-kerf,False),
                    (2,z0+kerf,True),(2,z1-kerf,False),(1,cut_floor,True)])
                add(encode(dict(m, id=tag+'-rim-'+m['id'],part='rim',contextOnly=False,**meta),outside))
                add(encode(dict(m, id=tag+'-flap-'+m['id'],part='boneFlap',contextOnly=False,**meta),inside))
            for key, inset, facing in [('rim',0,1),('boneFlap',kerf,-1)]:
                lo,hi,back,front = x0+inset,x1-inset,z0+inset,z1-inset
                edges = [
                    ([(lo,t) for t in np.linspace(back,front,66)], [facing,0,0]),
                    ([(hi,t) for t in np.linspace(back,front,66)], [-facing,0,0]),
                    ([(t,back) for t in np.linspace(lo,hi,84)], [0,0,facing]),
                    ([(t,front) for t in np.linspace(lo,hi,84)], [0,0,-facing]),
                ]
                faces = np.concatenate([cranial_section(points, direction) for points,direction in edges])
                part(key+'-section', 'Cut Calvarial Edge', 'bone', '#e2d5b8', faces,
                     part=key, boneSection=True)
            lower,upper=spec['deep'],spec['falx_top']
            fz,fh=spec['falx_z'],spec['falx_half']
            inside,outside=partition(decode(falx),[(1,lower,True),(1,upper,False),(2,fz-fh,True),(2,fz+fh,False)])
            add(encode(dict(falx,id=tag+'-falx',part='falxRim',**meta),outside))
            add(encode(dict(falx,id=tag+'-falx-leaf',name='Falcine window segment',part='falxLeaf',**meta),inside))
            entry_edge=-.16*sign
            leaf_edge = (-1.30 if region == 'posterior' else -1.36)*sign
            a,b=sorted([entry_edge,leaf_edge])
            zlo,zhi=z0+.14,z1-.14
            gap = .012
            lateral_gap = .060 if region == 'posterior' else .027
            spec.setdefault('boneHingeY', {})[side] = float(np.mean(tables(.62*sign,z)))
            part('dura','Sagittal sinus based dural flap','dura','#95b7bb',
                 sheet(a,b,zlo,zhi,0,height=dura_height),
                 part='dura',fold='dura',pivot=[entry_edge,dura_height(entry_edge,z),z],away=[-sign,0,0],lift=[0,1,0])
            part('dura-opposite','Opposite dural margin','dura','#95b7bb',
                 sheet(*sorted([entry_edge+.008*sign,.59*sign]),zlo,zhi,0,height=dura_height),part='duraMargin')
            # Continue the stationary membrane under the rim around the three
            # sides of the opening. The medial border remains the intact hinge.
            for label, rect in [
                ('lateral', (*sorted([-1.68*sign,leaf_edge-lateral_gap*sign]), z0-.12,z1+.12)),
                ('anterior', (a,b,zhi+gap,z1+.12)),
                ('posterior', (a,b,z0-.12,zlo-gap)),
            ]:
                part('dura-'+label,'Dural margin','dura','#95b7bb',
                     sheet(*rect,0,height=dura_height),part='duraMargin')

            # Skin and galea move together, with separate visibility and staged return.
            for layer,color in [('skin','#d3a486'),('galea','#cccfc4'),('pericranium','#ddd8df')]:
                cap = scalp_surfaces[layer]
                # The anterior cap is based toward the forehead. The middle and posterior
                # caps open laterally from a linear sagittal skin exposure.
                xa,xb=sorted([-2.48*sign,1.14*sign])
                if region=='anterior':
                    planes=[(0,xa,True),(0,xb,False),(2,z0-.27,True),(2,z1+.3,False)]
                    px,pz=0,z1+.3
                    away=[0,0,-1]
                else:
                    planes=[(0,xa,True),(0,xb,False),(2,z0-.29,True),(2,z1+.28,False)]
                    px,pz=xa if sign==1 else xb,z
                    away=[sign,0,0]
                flap,rest=partition(cap,planes)
                part(layer+'-rest','Vault '+layer,layer,color,rest,part='skinRest')
                pivot_y = scalp_y(layer, px, pz)
                if not math.isfinite(pivot_y):
                    # The pericranium tapers at the fascia. Use the nearest
                    # flap vertex when that layer ends just inside the hinge.
                    vertices = flap[:, :, :3].reshape(-1,3)
                    pivot_y = vertices[np.argmin((vertices[:,0]-px)**2+(vertices[:,2]-pz)**2),1]
                part(layer+'-flap','Reflected '+layer,layer,color,flap,part='skinFlap',fold=layer,
                     pivot=[px,float(pivot_y),pz],away=away,lift=[0,1,0])
            # Markings use the same surface sampler as the skin and bone cutaways.
            def chain(points,r):
                return np.concatenate([tube([a,b],r) for a,b in zip(points,points[1:]) if np.linalg.norm(np.array(a)-b)>.001])
            # Trace the U-shaped incision in cutting order from one end of the sinus hinge.
            dura_cut = ([(x,zlo) for x in np.linspace(entry_edge,leaf_edge,16,endpoint=False)] +
                        [(leaf_edge,t) for t in np.linspace(zlo,zhi,25,endpoint=False)] +
                        [(x,zhi) for x in np.linspace(leaf_edge,entry_edge,17)])
            for i, ((x,zq),(xx,zz)) in enumerate(zip(dura_cut,dura_cut[1:])):
                part(f'dura-cut-{i}','Dural incision','dura','#815850',
                     tube([[x,dura_height(x,zq)+.014,zq],[xx,dura_height(xx,zz)+.014,zz]],.012),
                     marker=True,markerStages=['dura'],markerAt=.28*(i+1)/(len(dura_cut)-1),markerUntil=.32)
            if region=='anterior':
                line=[[x,scalp_y("skin",x,z0-.18)+.020,z0-.18] for x in np.linspace(-2.25,2.25,41)]
            else:
                line=[[-.57*sign,scalp_y("skin",-.57*sign,t)+.020,t] for t in np.linspace(z0-.16,z1+.15,31)]
            part('incision','Planned scalp incision','skin','#d1ee9b',chain(line,.022),marker=True,markerAxis=0 if region=='anterior' else 2,
                 markerKind=2,markerRange=[min(c[0 if region=='anterior' else 2] for c in line),max(c[0 if region=='anterior' else 2] for c in line)],markerStages=['orient','incision'])
            corners=[(x0,z0),(x0,z1),(x1,z1),(x1,z0),(x0,z0)]
            path=[(np.linspace(ax,bx,19,endpoint=False),np.linspace(az,bz,19,endpoint=False)) for (ax,az),(bx,bz) in zip(corners,corners[1:])]
            trace=[[x,top(x,zz)+.018,zz] for xx,zs in path for x,zz in zip(xx,zs)]
            trace.append(trace[0])
            part('outline','Rectangular craniotomy outline','bone','#f0b356',chain(trace,.018),marker=True,markerStages=['burr','elevate'])
            holes=[(0,z),*((u*sign,t) for t in [z0+.12,z1-.12] for u in [-.50,.50])]
            for i,(x,zz) in enumerate(holes):
                circle=[[x+.105*math.cos(t),top(x+.105*math.cos(t),zz+.105*math.sin(t))+.027,zz+.105*math.sin(t)] for t in np.linspace(0,2*np.pi,17)]
                part(f'burr-{i}','Burr hole at the sinus' if not i else 'Paramedian burr hole','bone','#e8ae62',chain(circle,.016),
                     marker=True,markerStages=['burr','elevate'],markerAt=i/5)
                if not i:
                    y=top(x,zz)+.025
                    drill=np.concatenate((tube([[x,y,zz],[x,y+.52,zz]],.036),tube([[x,y+.51,zz],[x,y+1.20,zz]],.115)))
                    part('drill','Cranial drill','bone','#75d6e5',drill,instrument=True,instrumentStage='burr',travel=[0,.65,0])
            xa=-1.39*sign
            yy=top(xa,z)
            part('penfield','Penfield No. 3 dissector','bone','#75d6e5',tube([[xa,yy+.055,z],[xa-.37*sign,yy+.59,z],[xa-.76*sign,yy+1.08,z]],.038),
                 instrument=True,instrumentStage='separate',travel=[-.26*sign,.5,0])
            # Deep instruments show their distal working segments. The full shanks
            # are omitted where the atlas model does not establish their clearance.
            blade_z=fz+fh*.55-(.25 if region=='anterior' else 0)
            blade_y=upper-.15
            blade_tip=[-.056*sign,blade_y,blade_z]
            blade_neck=[-.37*sign,blade_y+.22,blade_z+.045]
            body=tube([blade_neck,[-.65*sign,blade_y+.39,blade_z+.09]],.035)
            edge_blade=flat([[blade_tip,[-.29*sign,blade_y-.055,blade_z+.055],blade_neck],
                             [blade_neck,[-.29*sign,blade_y-.055,blade_z+.055],[-.36*sign,blade_y+.15,blade_z+.095]]])
            part('blade','No. 11 blade tip','dura','#75d6e5',np.concatenate((body,edge_blade)),instrument=True,
                 instrumentStage='falx',to=.53,travel=[-.15*sign,.13,0])
            sc_y=upper-.44
            scissors=np.concatenate([
                tube([[-.59*sign,sc_y+.38,fz],[-.28*sign,sc_y+.15,fz]],.043),
                tube([[-.28*sign,sc_y+.15,fz],[-.04*sign,sc_y,fz+.055]],.020),
                tube([[-.28*sign,sc_y+.15,fz],[-.04*sign,sc_y,fz-.055]],.020)])
            part('scissors','Microscissors tips','dura','#75d6e5',scissors,instrument=True,
                 instrumentStage='falx',fromProgress=.54,travel=[-.15*sign,.13,0])
            # The arachnoid and small superficial veins are schematic. The native
            # sagittal and straight sinuses are retained in the common atlas frame.
            veil=[]
            for zz in np.linspace(fz-fh,fz+fh,15)[:-1]:
                zz2=zz+2*fh/14
                a,b,c,d=[[-.22*sign,upper-.22,zq] for zq in (zz,zz2)]+[[-.87*sign,upper-.29,zq] for zq in (zz2,zz)]
                veil.extend(((a,b,c),(a,c,d)))
            part('arachnoid','Interhemispheric arachnoid','arachnoid','#cfe3ea',flat(veil),part='corridorVeil',opacity=.44)
            sinus=next(m for m in vascular if m['id']=='MED-ZA-63')
            pts=decode(sinus).reshape(-1,6)[:,:3]
            if region!='posterior':
                for i, zz in enumerate([z-.31,z+.29] if region=='middle' else [z-.23]):
                    near=pts[np.abs(pts[:,2]-zz)<.15]
                    if len(near):
                        join=near[np.argmax(near[:,1])].tolist()
                        outer=[-.91*sign,top(-.91*sign,zz)-.43,zz-.19]
                        bridge=tube([join,[-.42*sign,join[1]-.10,zz-.09],outer],.046)
                        part(f'bridge-{i}','Cortical bridging vein','veins','#6679a8',bridge,gravitySide=side)
            edge=[[0,y,t] for y,t in [(lower,fz-fh),(upper,fz-fh),(upper,fz+fh),(lower,fz+fh),(lower,fz-fh)]]
            part('falx-outline','Falcine window boundaries','dura','#e8b862',chain(edge,.016),marker=True,markerStages=['falx'])
            for suffix,pt,color in [
                ('superior',[.18*sign,upper-.07,fz],'#e6cb74'),
                ('lateral',[.48*sign,lower+.10,fz],'#a7d6a7')]:
                # Pins identify the two levels in the scene. Reported distances are in the comparison table.
                part('limit-'+suffix,suffix.capitalize()+' comparison level','dura',color,tube([pt,[pt[0],pt[1]+.20,pt[2]]],.025),marker=True,markerStages=['limits'])
    assert len({m['id'] for m in result})==len(result)
    output.mkdir(parents=True, exist_ok=True)
    (output/'mesh-data.json').write_text(json.dumps(result,separators=(',',':')))
    (output/'regions.json').write_text(json.dumps(REGIONS,indent=2))
    print(len(result),sum(m['count'] for m in result),'vertices')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-json', type=Path, required=True, help='Atlas mesh records with the fitted Pterional scalp layers')
    parser.add_argument('--medial-guide', type=Path, required=True, help='Original guide with the native medial atlas records')
    parser.add_argument('--output', type=Path, required=True, help='Directory for mesh-data.json and regions.json')
    args = parser.parse_args()
    build(args.reference_json, args.medial_guide, args.output)
