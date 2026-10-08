param([string]$Path, [string]$Out)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($Path)
function ReadEntry($name) { $e = $z.GetEntry($name); if (-not $e) { return $null }; $sr = New-Object IO.StreamReader($e.Open()); $s = $sr.ReadToEnd(); $sr.Close(); return $s }
$ss = @()
$ssx = ReadEntry "xl/sharedStrings.xml"
if ($ssx) { foreach ($m in [regex]::Matches($ssx, '<si>(.*?)</si>', 'Singleline')) { $txt = ([regex]::Matches($m.Groups[1].Value, '<t[^>]*>(.*?)</t>', 'Singleline') | ForEach-Object { $_.Groups[1].Value }) -join ''; $ss += [Net.WebUtility]::HtmlDecode($txt) } }
$wb = ReadEntry "xl/workbook.xml"
$rels = ReadEntry "xl/_rels/workbook.xml.rels"
$sb = New-Object Text.StringBuilder
foreach ($sm in [regex]::Matches($wb, '<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"')) {
  $name = $sm.Groups[1].Value; $rid = $sm.Groups[2].Value
  $target = [regex]::Match($rels, 'Id="' + $rid + '"[^>]*Target="([^"]+)"').Groups[1].Value
  if (-not $target) { $target = [regex]::Match($rels, 'Target="([^"]+)"[^>]*Id="' + $rid + '"').Groups[1].Value }
  $target = $target -replace '^/?xl/', ''
  $xml = ReadEntry ("xl/" + $target)
  [void]$sb.AppendLine("=================== SHEET: $name ===================")
  if (-not $xml) { continue }
  foreach ($row in [regex]::Matches($xml, '<row [^>]*>(.*?)</row>', 'Singleline')) {
    $cells = @()
    foreach ($c in [regex]::Matches($row.Groups[1].Value, '<c ([^>]*?)(?:/>|>(.*?)</c>)', 'Singleline')) {
      $attrs = $c.Groups[1].Value; $inner = $c.Groups[2].Value
      $type = [regex]::Match($attrs, 't="([^"]+)"').Groups[1].Value
      $v = [regex]::Match($inner, '<v>(.*?)</v>', 'Singleline').Groups[1].Value
      $val = ''
      if ($type -eq 's' -and $v -ne '') { $val = $ss[[int]$v] }
      elseif ($type -eq 'inlineStr') { $val = ([regex]::Matches($inner, '<t[^>]*>(.*?)</t>') | ForEach-Object { $_.Groups[1].Value }) -join '' }
      else { $val = [Net.WebUtility]::HtmlDecode($v) }
      $cells += ($val -replace "[\r\n]+", ' ')
    }
    $line = ($cells -join "`t").TrimEnd("`t")
    if ($line.Trim() -ne '') { [void]$sb.AppendLine($line) }
  }
}
$z.Dispose()
[IO.File]::WriteAllText($Out, $sb.ToString())
