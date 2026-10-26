$ErrorActionPreference='Stop'
$candidates=Get-Content 'tools/species-photo-candidates.json' -Raw | ConvertFrom-Json -AsHashtable
$choices=@{
  'Largemouth bass'=1; 'Spotted bass'=0; 'Hybrid striped bass'=0; 'Striped bass'=1;
  'Black crappie'=0; 'White crappie'=0; 'Channel catfish'=0; 'Blue catfish'=1;
  'Flathead catfish'=2; 'Bluegill'=0; 'Redear sunfish'=2; 'Redbreast sunfish'=1;
  'Shoal bass'=0; 'Alabama bass'=0; 'White bass'=2; 'Tallapoosa bass'=0
}
New-Item -ItemType Directory -Force public/species,tools/species-originals | Out-Null
$manifest=@{}
foreach($name in ($choices.Keys|Sort-Object)) {
  $id=$name.ToLower().Replace(' ','-')
  $photo=$candidates[$name][$choices[$name]]
  if(!$photo){throw "Missing photograph for $name"}
  if($photo.license -notmatch 'Public domain|CC0|CC BY'){throw "Unreviewed license for $name"}
  $url=($photo.thumb -split '\?')[0]
  if(([uri]$url).Host -notin @('upload.wikimedia.org','thumb.wikimedia.org')){throw 'Unexpected photo host'}
  $target="tools/species-originals/$id"
  $valid=$false
  if(Test-Path $target) { $bytes=[System.IO.File]::ReadAllBytes((Join-Path $PWD $target)); $valid=($bytes.Length -gt 3 -and (($bytes[0] -eq 255 -and $bytes[1] -eq 216) -or ($bytes[0] -eq 137 -and $bytes[1] -eq 80))) }
  if(!$valid) {
    Start-Sleep -Seconds 10
    try { Invoke-WebRequest $url -OutFile $target -TimeoutSec 30 }
    catch { throw "Photo download failed for $name. Wait before retrying; existing downloads are preserved." }
  }
  $credit=[System.Net.WebUtility]::HtmlDecode(($photo.artist -replace '<[^>]*>',''))
  if(!$credit){$credit='Wikimedia Commons · photographer not listed'}
  $manifest[$id]=@{file="species/$id.jpg";credit=$credit;license=$photo.license;licenseUrl=$photo.licenseUrl;page=$photo.page;changes='Resized and converted to JPEG; no content edits.'}
  Write-Output "Prepared $name"
}
$manifest|ConvertTo-Json -Depth 5|Set-Content 'src/data/species-photos.json'
python -c "from pathlib import Path; from PIL import Image,ImageOps,ImageDraw; files=sorted(Path('tools/species-originals').iterdir()); sheet=Image.new('RGB',(1000,((len(files)+3)//4)*180),'white'); d=ImageDraw.Draw(sheet); [(lambda im,p,i: (im.thumbnail((960,640)),im.save(Path('public/species')/(p.name+'.jpg'),quality=86,optimize=True),sheet.paste(ImageOps.contain(im,(240,145)),((i%4)*250,(i//4)*180)),d.text(((i%4)*250+4,(i//4)*180+150),p.name,fill='black')))(Image.open(p).convert('RGB'),p,i) for i,p in enumerate(files)]; sheet.save('tools/species-contact.jpg')"
