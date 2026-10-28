"""Expand public AL/GA catalogs without rebuilding or relabeling the core map packs.

Agency object IDs are paged explicitly, every page is checked, old IDs are retained,
and all results are staged in memory before replacing the public catalogs.
"""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
import math
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from coverage_manifest import build_coverage_manifest

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'public/data'
CACHE = ROOT / 'pipeline/cache/statewide'
CACHE.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
GA = 'https://services6.arcgis.com/9QlSLDqa0P1cHLhu/ArcGIS/rest/services/'
AL = 'https://conservationgis.alabama.gov/adcnrweb/rest/services/'
CRD = 'https://services3.arcgis.com/r9yUQy2Mlp8XERvO/arcgis/rest/services/'
SOURCES = {
    'al_access': (AL+'DCNRBoatRamps/MapServer/0', 'Alabama DCNR'),
    'ga_access': (GA+'WRD_Water_Access_Points/FeatureServer/0', 'Georgia DNR Wildlife Resources'),
    'al_structures': (AL+'FishAttractors/MapServer/0', 'Alabama DCNR'),
    'ga_structures': (GA+'Fish_Attractors_View/FeatureServer/0', 'Georgia DNR Wildlife Resources'),
    'al_reefs': (AL+'ArtificialReefs/MapServer/0', 'Alabama Marine Resources Division'),
    'ga_reefs': (CRD+'ArtificialOffshoreReefs/FeatureServer/0', 'Georgia DNR Coastal Resources'),
    'ga_habitat': (GA+'Aquatic_Vegetation_view/FeatureServer/0', 'Georgia DNR Wildlife Resources'),
    'al_waters': (AL+'PublicFishingLakes/MapServer/0', 'Alabama DCNR'),
    'ga_waters': (GA+'WRD_Waterbodies/FeatureServer/0', 'Georgia DNR Wildlife Resources'),
}

def get(url, params=None):
    full = url + ('?' + urlencode(params) if params else '')
    path = CACHE / (hashlib.sha256(full.encode()).hexdigest()+'.json')
    if path.exists() and time.time()-path.stat().st_mtime < 86400:
        return json.loads(path.read_text(encoding='utf8'))
    for attempt in range(3):
        try:
            request = Request(url, data=urlencode(params).encode(), headers={'User-Agent':'LongleafAtlasPublicCatalog/1.0','Content-Type':'application/x-www-form-urlencoded'}) if len(full)>1800 else Request(full, headers={'User-Agent':'LongleafAtlasPublicCatalog/1.0'})
            with urlopen(request, timeout=75) as response:
                value = json.load(response)
            if value.get('error'):
                raise RuntimeError(f"{url}: {value['error']}")
            path.write_text(json.dumps(value), encoding='utf8')
            return value
        except Exception as error:
            if attempt == 2: raise RuntimeError(f'Could not fetch {url}: {error}') from error
            time.sleep(1+attempt)

def layer(item):
    key, (url, agency) = item
    metadata = get(url, {'f':'json'})
    where = "GNIS_Name IS NOT NULL AND GNIS_Name <> '' AND AreaSqKm >= 0.08" if key == 'ga_waters' else '1=1'
    ids = get(url+'/query', {'f':'json','where':where,'returnIdsOnly':'true'}).get('objectIds')
    if not ids: raise RuntimeError(f'Empty or incomplete source: {key}')
    oid = metadata.get('objectIdField') or metadata.get('objectIdFieldName') or next(f['name'] for f in metadata['fields'] if f['type']=='esriFieldTypeOID')
    records = []
    for offset in range(0, len(ids), 400):
        chunk = ids[offset:offset+400]
        params = {'f':'json','objectIds':','.join(map(str,chunk)), 'outFields':'*','outSR':4326,'returnGeometry':'true'}
        if key == 'ga_waters': params.update(returnCentroid='true', returnGeometry='false')
        response = get(url+'/query',params)
        page = response.get('features',[])
        if {str(f['attributes'][oid]) for f in page} != {str(i) for i in chunk}:
            raise RuntimeError(f'Missing records in {key}, page {offset}')
        records.extend(page)
    changed = metadata.get('editingInfo',{}).get('lastEditDate')
    edition = datetime.fromtimestamp(changed/1000,timezone.utc).isoformat() if changed else None
    print(f'{key}: fetched {len(records)} agency records',flush=True)
    return key, {'url':url,'agency':agency,'oid':oid,'records':records,'source_updated':edition,'source_count':len(ids),'domains':{f['name']:{str(v['code']):v['name'] for v in (f.get('domain') or {}).get('codedValues',[])} for f in metadata['fields']}}

def clean(value):
    if value is None:return ''
    value = str(value).strip()
    return '' if value.lower() in ('null','none','unknown','n/a','<null>') else value

def norm(value):
    key=re.sub(r'[^a-z0-9]','',re.sub(r'\b(lake|reservoir|public fishing area|pfa|public fishing|county public fishing)\b','',value.lower()))
    return {'harris':'wedowee','biglazer':'biglazercreek','barbourpfl':'barbourcounty','leepfl':'leecounty','chamberspfl':'chamberscounty'}.get(key,key)

def yes(value):return str(value).strip().lower() in ('y','yes','true','1')

def coords(raw):
    g = raw.get('centroid') or raw.get('geometry') or {}
    p = raw['attributes']
    x, y = p.get('X',g.get('x')), p.get('Y',g.get('y'))
    if not isinstance(x,(int,float)) or not isinstance(y,(int,float)):return None
    # Includes coastal/offshore waters but rejects default 0/0, swapped axes and bad surveys.
    if not (-88.65 <= x <= -79.5 and 28.5 <= y <= 35.1):return None
    return [round(x,6),round(y,6)]

def date(value):
    if isinstance(value,(int,float)) and value>0:return datetime.fromtimestamp(value/1000,timezone.utc).date().isoformat()
    return clean(value)

def point(ident, xy, properties):
    return {'type':'Feature','id':ident,'geometry':{'type':'Point','coordinates':xy},'properties':dict(record_id=ident,**properties)}

def provenance(source):
    return {'data_source':source['agency'],'source_url':source['url'],'retrieved_at':NOW, 'source_updated':source['source_updated']}

def distance(a,b):
    return math.hypot((a[0]-b[0])*math.cos(math.radians(a[1])),a[1]-b[1])*111000

SPECIES = {'Largemouth':'Largemouth bass','Smallmouth':'Smallmouth bass','ShoalBass':'Shoal bass','SpotBass':'Spotted bass','WhiteBass':'White bass','StripBass':'Striped bass','HybStrpBas':'Hybrid striped bass','ChannelCat':'Channel catfish','Flathead':'Flathead catfish','BlueCat':'Blue catfish','WhiteCrap':'White crappie','BlackCrap':'Black crappie','Bluegill':'Bluegill','Redbreast':'Redbreast sunfish','RedearSun':'Redear sunfish','Warmouth':'Warmouth','BrownTrout':'Brown trout','RbwTrout':'Rainbow trout','BrookTrout':'Brook trout','Walleye':'Walleye','Yell_Perch':'Yellow perch','ChainPick':'Chain pickerel','Redfish':'Red drum','SeaTrout':'Spotted seatrout','Flounder':'Flounder','Sheepshead':'Sheepshead','ChattBass':'Chattahoochee bass','Bartrams':'Bartrams bass','Tallapoosa':'Tallapoosa bass','AltamahaBass':'Altamaha bass'}

def main():
    old = {name:json.loads((DATA/(name+'.json')).read_text(encoding='utf-8-sig')) for name in ['access','fish-structures','restrooms','habitat','waters','state-boundaries','coverage']}
    sources = dict(concurrent.futures.ThreadPoolExecutor(6).map(layer,SOURCES.items()))
    # Official generalized state outlines are for display, not a survey or jurisdiction ruling.
    boundaries = get('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query',{'f':'geojson','where':"STUSAB IN ('AL','GA')",'outFields':'STUSAB,NAME','outSR':4326,'returnGeometry':'true','maxAllowableOffset':0.003,'geometryPrecision':5})
    if len(boundaries.get('features',[])) != 2:raise RuntimeError('State boundary download incomplete')
    refreshed_states = {'AL', 'GA'}
    preserved_boundaries = [feature for feature in old['state-boundaries'].get('features', []) if feature.get('properties', {}).get('STUSAB') not in refreshed_states]
    boundaries['features'] = boundaries['features'] + preserved_boundaries
    boundaries['source_url']='https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0'
    boundaries['retrieved_at']=NOW
    access = [f for f in old['access']['features'] if not str(f.get('id','')).startswith(('ga-access-','al-access-'))]
    structures = {str(f.get('id')):f for f in old['fish-structures']['features'] if not str(f.get('id','')).startswith(('ga-structures-','al-reefs-','ga-reefs-'))}
    toilets = {str(f.get('id')):f for f in old['restrooms']['features']}
    habitat = [f for f in old['habitat'].get('features', []) if not str(f.get('id','')).startswith(('ga-habitat-','ga-improvement-'))]
    groups = defaultdict(lambda:{'points':[],'species':set(),'links':{},'state':set(),'types':set(),'access':[]})
    group_keys = defaultdict(list)
    stats = {}

    def group(name,xy,state,source,species=(),kind='',feature=None,confirmed=False):
        if not clean(name) or not norm(name):return
        base=norm(name)
        if base in ('coastal','water','river','pond','unnamed','unknown'):return
        # Identically named small waters in different towns must not become one lake.
        candidates=group_keys[base]
        major={'guntersville','wheeler','pickwick','demopolis','smith','hartwell','lanier','allatoona','clarkshill','russell','sinclair','oconee','seminole'}
        threshold=150000 if base in major or re.search(r'river|trout stream|coastal|major reservoir',kind,re.I) else 30000
        ranked=sorted((min(distance(xy,p) for p in groups[key]['points']),key) for key in candidates)
        key=ranked[0][1] if ranked and ranked[0][0] <= threshold else base+(f'~{len(candidates)+1}' if candidates else '')
        if key not in candidates:candidates.append(key)
        entry=groups[key]
        entry.setdefault('name',clean(name))
        entry['points'].append(xy);entry['state'].add(state);entry['species'].update(species)
        entry['links'][source['agency']]=source['url']
        entry['confirmed']=entry.get('confirmed',False) or confirmed
        if kind:entry['types'].add(kind)
        if feature:entry['access'].append(feature)
        return entry

    for key in ['al_access','ga_access']:
        source=sources[key];state='AL' if key.startswith('al') else 'GA'; accepted=0
        for raw in source['records']:
            xy=coords(raw);p=raw['attributes']
            if not xy:continue
            if state=='GA' and clean(p.get('Draw')).lower() not in ('public',''):continue
            name=clean(p.get('Name' if state=='GA' else 'Access_Are')) or 'Agency-mapped water access'
            water=clean(p.get('Waterbody'));ident=key.replace('_','-')+'-'+str(p[source['oid']])
            kind='boat_ramp' if state=='AL' or yes(p.get('Ramp')) else 'paddle_launch' if yes(p.get('CanoeAcc')) else 'marina' if yes(p.get('Marina')) else 'fishing'
            species=[name for field,name in SPECIES.items() if yes(p.get(field))] if state=='GA' else []
            props=dict(name=name,kind=kind,waterbody=water,state=state,county=clean(p.get('County')),operator=clean(p.get('Operator')) or source['agency'],status=clean(p.get('Status')),surface=clean(p.get('RampType')),lanes=p.get('NumLanes',p.get('Launch_Lan')),parking=p.get('Parking_sp',p.get('Parking')),toilets=p.get('Restroom',p.get('Bathrooms')),fee=p.get('Fee'),species_summary=', '.join(species),description=clean(p.get('MoreInfo')),**provenance(source))
            for field in ('Link1','Link2'):
                link=clean(p.get(field))
                if link.startswith(('https://','http://')):props.setdefault('website',link)
            feature=point(ident,xy,props)
            existing=next((f for f in access if f['properties'].get('kind')==kind and distance(f['geometry']['coordinates'],xy)<65),None)
            if existing:
                existing['properties'].update({k:v for k,v in feature['properties'].items() if v not in ('',None)})
                feature=existing
            else:access.append(feature)
            group(water,xy,state,source,species,clean(p.get('WaterType')),feature,confirmed=True)
            if yes(props['toilets']):
                toilet=point(ident+'-restroom',xy,dict(name='Restrooms at '+name,kind='restroom',facility=name,waterbody=water,state=state,operator=props['operator'],location_accuracy='facility point (restroom may be nearby)',status=props['status'],**provenance(source)))
                toilets[toilet['id']]=toilet
            accepted+=1
        stats[key]={'source_count':source['source_count'],'accepted':accepted}

    for key in ['al_structures','ga_structures','al_reefs','ga_reefs']:
        source=sources[key];accepted=0;skipped_corners=0;state='AL' if key.startswith('al') else 'GA'
        for raw in source['records']:
            xy=coords(raw);p=raw['attributes']
            if not xy:continue
            if key=='ga_structures' and p.get('activity') not in ('attractor','trout_structure'):
                if p.get('activity') in ('planting','spring_restoration','stream_restoration'):
                    activity=source['domains'].get('activity',{}).get(p['activity'],p['activity'])
                    water=clean(p.get('waterbody'))
                    ident='ga-improvement-'+str(p[source['oid']])
                    habitat.append(point(ident,xy,dict(name=f'{water or "Georgia water"} — {activity}',kind='habitat',waterbody=water,state='GA',habitat_type=activity,observed_at=date(p.get('placement_date')),description=clean(p.get('note')),source_note='Historical habitat improvement record. It is not a current habitat survey, depth survey or boating route.',**provenance(source))))
                skipped_corners+=1
                continue
            material=clean(p.get('Structure') or p.get('Material') or p.get('attractor_code_other') or source['domains'].get('attractor_code',{}).get(str(p.get('attractor_code')))) or 'Reported structure'
            if key=='ga_reefs' and re.search(r'corner|permitted reef area',material,re.I):skipped_corners+=1;continue
            if key=='al_reefs' and clean(p.get('Reef_Type')).upper()=='NAVAIDS':skipped_corners+=1;continue
            water=clean(p.get('Waterbody') or p.get('waterbody') or p.get('Name'))
            if key=='al_reefs':water='Alabama Gulf public reefs' if xy[1]<30.20 else 'Alabama inshore public reefs'
            name=clean(p.get('Reef_Name') or p.get('note')) or f'{water} — {material}'
            ident=('al-dcnr-' if key=='al_structures' else key.replace('_','-')+'-')+str(p[source['oid']])
            note='Agency-reported habitat installation. Position and material may have changed; this is not a navigational chart or a current depth survey.'
            if key=='ga_reefs':note+=' This legacy agency GIS layer is named GA_OAR_12122016; verify current CRD coordinates before boating.'
            props=dict(name=name,kind='fish_structure',waterbody=water,state=state,structure=material,quantity=p.get('Amount',p.get('units_no',p.get('No__of_Mod'))),installed=date(p.get('Installati',p.get('placement_date',p.get('Year')))),source_note=note,marine=key.endswith('reefs'),**provenance(source))
            if key=='ga_structures':props['source_activity']=p['activity']
            # Do not assume depth units where the service only labels the field "Depth".
            if key=='al_structures':props['depth_ft']=p.get('Depth_at_F') or 0
            elif p.get('deep',p.get('Depth')):props['reported_depth']=p.get('deep',p.get('Depth'));props['depth_unit']='not specified in source field'
            structures[ident]=point(ident,xy,props)
            group(water,xy,state,source,kind='coastal reef area' if key.endswith('reefs') else '',confirmed=key.endswith('reefs'))
            accepted+=1
        stats[key]={'source_count':source['source_count'],'accepted':accepted,'non_structure_markers_excluded':skipped_corners}

    source=sources['ga_habitat'];accepted=0;rejected=0
    for raw in source['records']:
        xy=coords(raw);p=raw['attributes']
        if not xy:rejected+=1;continue
        ident='ga-habitat-'+str(p[source['oid']]);water=clean(p.get('waterbody'));veg=clean(p.get('emerge_veg_type_other') or p.get('veg_type_other') or p.get('emerge_veg_type')).replace('_',' ')
        feature=point(ident,xy,dict(name=f'{water or "Georgia water"} — {veg or "aquatic vegetation survey"}',kind='habitat',waterbody=water,state='GA',habitat_type=veg or 'Aquatic vegetation survey',observed_at=date(p.get('collection_date')),origin=clean(p.get('origination')),description=clean(p.get('notes')),source_note='Historical vegetation survey point; it does not establish current plant coverage, navigability, habitat quality or permission to enter.',**provenance(source)))
        habitat.append(feature);accepted+=1
    stats['ga_habitat']={'source_count':source['source_count'],'accepted':accepted,'invalid_or_out_of_area_rejected':rejected}

    waters=[w for w in old['waters']['waters'] if not w['id'].startswith('water-')];aliases={norm(name):w for w in waters for name in [w['name'],*w.get('gnis_names',[])]}
    for key in ['al_waters','ga_waters']:
        source=sources[key];state='AL' if key.startswith('al') else 'GA'
        for raw in source['records']:
            xy=coords(raw);p=raw['attributes']
            if not xy:continue
            name=clean(p.get('Name') or p.get('GNIS_Name'))
            entry=group(name,xy,state,source,kind=clean(p.get('d_FType')),confirmed=True)
            if not entry:continue
            entry['label_point']=xy
            if p.get('AreaSqKm'):entry['acres']=round(p['AreaSqKm']*247.105)
            link=clean(p.get('Link'))
            if link.startswith(('https://','http://')):entry['links']['Official lake information']=link.replace('http://','https://')

    for key,entry in sorted(groups.items()):
        existing=aliases.get(key)
        if not existing and not entry.get('confirmed'):continue
        xs=[p[0] for p in entry['points']];ys=[p[1] for p in entry['points']]
        bounds=[[min(xs),min(ys)],[max(xs),max(ys)]]
        center=entry.get('label_point') or [round((min(xs)+max(xs))/2,6),round((min(ys)+max(ys))/2,6)]
        if existing:
            water=existing
            if not water.get('center'):water['center']=center
            # Preserve all previously curated species and notes; only fill an empty list.
            if not water.get('species'):water['species']=[{'name':s}for s in sorted(entry['species'])]
        else:
            ident='water-'+re.sub('[^a-z0-9]+','-',entry['name'].lower()).strip('-')
            if any(w['id']==ident for w in waters):ident+='-'+hashlib.sha1(key.encode()).hexdigest()[:6]
            water={'id':ident,'name':entry['name'],'gnis_names':[entry['name']],'state':'/'.join(sorted(entry['state'])),'type':next(iter(sorted(entry['types'])),'water body'),'center':center,'species':[{'name':s}for s in sorted(entry['species'])],'notes':'Agency-mapped water destination. Review the source records, facility rules and current conditions before planning your trip.','links':[],'location_note':'Overview point from an agency water-body label or the extent of reported access/structure locations. It is not a shoreline survey.'}
            if entry.get('acres'):water['acres']=entry['acres']
            waters.append(water);aliases[key]=water
        editions={s['url']:s['source_updated'] for s in sources.values()}
        water['catalog_sources']=[{'label':label,'url':url,'source_updated':editions.get(url)}for label,url in entry['links'].items()]
        counties=sorted({f['properties'].get('county') for f in entry['access'] if f['properties'].get('county')})
        water['location_label']=(counties[0]+' County, ' if len(counties)==1 else '')+water['state']
        water['retrieved_at']=NOW
        if not water.get('species'):water['species_note']='This source does not verify a species list. Use the official agency information; no species have been inferred from nearby water.'
        elif not existing:water['species_note']='Species flagged by the agency at access sites on this water; seasonal presence and location can vary.'
        # Extents derived only from point records are not presented as water boundaries.
        if len(entry['points'])>1 and max(xs)-min(xs)<2.5 and max(ys)-min(ys)<2.5:water['bounds']=bounds
        for feature in entry['access']:feature['properties']['waterbody_id']=water['id']

    profiles=json.loads((ROOT/'pipeline/statewide-water-profiles.json').read_text(encoding='utf8'))
    for profile in profiles:
        for water in waters:
            if norm(profile['match']) not in {norm(n) for n in [water['name'],*water.get('gnis_names',[])]}:continue
            water['species']=[{'name':s} for s in profile['species']]
            water['notes']=profile['notes']
            water['species_note']='General species information from the linked agency profile, not a current catch forecast or a guarantee at every location.'
            if profile.get('acres'):water['acres']=profile['acres']
            water['links']=[link for link in water['links'] if link['url']!=profile['url']]+[{'label':'Official agency fishery profile','url':profile['url']}]

    def collection(features,source):
        return {'type':'FeatureCollection','updated':NOW,'source':source,'coverage':'Alabama and Georgia agency catalogs refreshed here; previously integrated South Carolina catalog records are preserved but not refreshed by this job. OSM supplementation retains its original regional coverage.','features':features}
    products={'access':collection(access,'Alabama DCNR; Georgia DNR; South Carolina DNR; OpenStreetMap contributors'),'fish-structures':collection(list(structures.values()),'Alabama DCNR; Georgia DNR Wildlife and Coastal Resources; South Carolina DNR; USACE'),'restrooms':collection(list(toilets.values()),'Alabama DCNR; Georgia DNR; South Carolina DNR; OpenStreetMap contributors'),'habitat':collection(habitat,'Georgia DNR aquatic vegetation survey; South Carolina DNR historical projects'),'state-boundaries':boundaries}
    old['waters']['updated']=NOW[:10];old['waters']['waters']=waters;products['waters']=old['waters']
    source_updates={key:{**stats.get(key,{}),'url':s['url'],'agency':s['agency'],'source_updated':s['source_updated']} for key,s in sources.items()}
    summary=build_coverage_manifest(products,old['coverage'],updated=NOW,scope='Alabama and Georgia statewide agency catalogs, plus selected South Carolina agency catalogs; records are source-limited and not an exhaustive inventory. Adjacent coastal and offshore sources are included where documented.',source_updates=source_updates)
    summary['offline_packs']='Existing regional archives are unchanged. Online maps and catalog points extend beyond them. Save map areas separately for expanded geography.'
    products['coverage']=summary
    for name,value in products.items():
        temp=DATA/(name+'.json.pending');temp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    for name in products:(DATA/(name+'.json.pending')).replace(DATA/(name+'.json'))
    print(json.dumps(summary['counts'],indent=2),flush=True)

if __name__=='__main__':main()
