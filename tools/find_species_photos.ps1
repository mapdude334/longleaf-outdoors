$ErrorActionPreference = 'Stop'
$names = @('Largemouth bass','Spotted bass','Hybrid striped bass','Striped bass','Black crappie','White crappie','Channel catfish','Blue catfish','Flathead catfish','Bluegill','Redear sunfish','Redbreast sunfish','Shoal bass','Alabama bass','Tallapoosa bass','White bass')
$all = @{}
if (Test-Path 'tools/species-photo-candidates.json') { $all = Get-Content 'tools/species-photo-candidates.json' -Raw | ConvertFrom-Json -AsHashtable }
foreach ($name in $names) {
  if ($all.ContainsKey($name)) { continue }
  Start-Sleep -Seconds 10
  $query = [uri]::EscapeDataString('"' + $name + '" filetype:bitmap -drawing -illustration -map -distribution -Raver')
  $uri = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=' + $query + '&gsrlimit=3&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=800'
  $j = Invoke-RestMethod $uri -Headers @{'User-Agent'='LongleafOutdoors/0.1 educational species guide'}
  $all[$name] = @($j.query.pages.PSObject.Properties.Value | Sort-Object index | ForEach-Object {
    $i=$_.imageinfo[0]; $m=$i.extmetadata
    @{ title=$_.title; url=$i.url; thumb=$i.thumburl; page=$i.descriptionurl; artist=$m.Artist.value; description=$m.ImageDescription.value; license=$m.LicenseShortName.value; licenseUrl=$m.LicenseUrl.value }
  })
  $all | ConvertTo-Json -Depth 7 | Set-Content 'tools/species-photo-candidates.json'
  Write-Output ('Found candidates: ' + $name)
}
$all | ConvertTo-Json -Depth 7 | Set-Content 'tools/species-photo-candidates.json'
$all.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Name; $_.Value | ForEach-Object { '  ' + $_.title + ' | ' + $_.license } }
