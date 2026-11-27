# Surveille les connexions TCP d'un process (et de ses enfants) toutes les 200 ms et
# consigne toute extremite distante non-loopback. Pas d'admin requis (pktmon l'exige).
# Usage : powershell -File netwatch.ps1 -ProcessId 1234 -Seconds 300 -Out log.txt
param([int]$ProcessId, [int]$Seconds = 300, [string]$Out)
$seen = @{}
$polls = 0
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }
    $ids = @($ProcessId) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" | ForEach-Object ProcessId)
    foreach ($c in Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess }) {
        $r = $c.RemoteAddress
        if ($r -in '127.0.0.1', '::1', '0.0.0.0', '::') { continue }
        $k = "$r`:$($c.RemotePort) $($c.State) pid=$($c.OwningProcess)"
        if (-not $seen.ContainsKey($k)) { $seen[$k] = Get-Date -Format o; Add-Content -Path $Out -Value "$($seen[$k]) EGRESS $k" }
    }
    $polls++
    Start-Sleep -Milliseconds 200
}
Add-Content -Path $Out -Value "$(Get-Date -Format o) FIN polls=$polls egress_distinct=$($seen.Count)"
