# StoryZLine server for laptops without Node.js. Needs only Windows PowerShell 5.1 (built into Windows 10/11).
# Serves public/ and proxies authenticated GETs to Bitbucket, with the same rules as server.js and lib/proxy.js.
# It uses a plain TCP socket on 127.0.0.1, so it needs no admin rights.
param(
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 5180 }),
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Public = [IO.Path]::GetFullPath((Join-Path $Root 'public'))
$MaxBytes = 5MB
$Types = @{ '.html' = 'text/html'; '.js' = 'text/javascript'; '.css' = 'text/css'; '.svg' = 'image/svg+xml' }
$Reasons = @{ 200 = 'OK'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed';
              413 = 'Payload Too Large'; 500 = 'Internal Server Error'; 502 = 'Bad Gateway' }

# Allow TLS 1.2 (older PowerShell defaults to TLS 1.0) and use the Windows proxy settings, like the browser.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Stop-WithStatus([int]$Status, [string]$Message) {
  $e = New-Object Exception $Message
  $e.Data['status'] = $Status
  throw $e
}

function Send-Response($Stream, [int]$Status, [byte[]]$Body, [string]$Type) {
  $head = "HTTP/1.1 $Status $($Reasons[$Status])`r`nContent-Type: $Type; charset=utf-8`r`n" +
          "Content-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $h = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($h, 0, $h.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

function Send-Json($Stream, [int]$Status, $Object) {
  Send-Response $Stream $Status ([Text.Encoding]::UTF8.GetBytes(($Object | ConvertTo-Json -Compress))) 'application/json'
}

function Read-Request($Stream) {
  $buf = New-Object byte[] 8192
  $ms = New-Object IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $Stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
    $text = [Text.Encoding]::ASCII.GetString($ms.ToArray())
    $headerEnd = $text.IndexOf("`r`n`r`n")
    if ($headerEnd -lt 0 -and $ms.Length -gt 65536) { return $null }
  }
  $lines = $text.Substring(0, $headerEnd) -split "`r`n"
  $parts = $lines[0] -split ' '
  $headers = @{}
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    $i = $line.IndexOf(':')
    if ($i -gt 0) { $headers[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim() }
  }
  $length = 0
  if ($headers['content-length']) { $length = [int]$headers['content-length'] }
  if ($length -gt 65536) { Stop-WithStatus 413 'Request too large.' }
  $all = $ms.ToArray()
  $body = New-Object IO.MemoryStream
  $body.Write($all, $headerEnd + 4, $all.Length - $headerEnd - 4)
  while ($body.Length -lt $length) {
    $n = $Stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $body.Write($buf, 0, $n)
  }
  return @{ Method = $parts[0]; Target = $parts[1]; Headers = $headers; Body = [Text.Encoding]::UTF8.GetString($body.ToArray()) }
}

# Only the StoryZLine page itself may call the API (blocks cross-site and DNS-rebinding requests).
function Test-OwnPage($Request) {
  $h = "$($Request.Headers['host'])".ToLower()
  if (@("127.0.0.1:$Port", "localhost:$Port") -notcontains $h) { return $false }
  if ("$($Request.Headers['content-type'])" -notmatch '^application/json\b') { return $false }
  $origin = $Request.Headers['origin']
  return (-not $origin) -or ($origin.ToLower() -eq "http://$h")
}

# Returns @{ status; contentType; body } for any HTTP reply; throws only when Bitbucket can't be reached.
function Invoke-BitbucketGet([string]$Url, $Conn) {
  $baseUrl = "$($Conn.baseUrl)".Trim()
  if ($baseUrl -notmatch '^https?://[^/\s]+') { Stop-WithStatus 400 'The Bitbucket URL must start with http:// or https://.' }
  if ($Url -notmatch '^https?://') { Stop-WithStatus 400 'Only http(s) URLs can be fetched.' }
  # The login may only ever be sent to the Bitbucket host the user typed (plus the Cloud API host).
  $target = ([Uri]$Url).Host.ToLower()
  $baseHost = ([Uri]$baseUrl).Host.ToLower()
  $cloud = $baseHost -match '(^|\.)bitbucket\.org$'
  if ($target -ne $baseHost -and -not ($cloud -and $target -eq 'api.bitbucket.org')) {
    Stop-WithStatus 403 "Refusing to send the login to `"$target`": it is not the Bitbucket host `"$baseHost`"."
  }

  $req = [Net.HttpWebRequest]::Create($Url)
  $req.Method = 'GET'
  $req.Accept = 'text/plain, application/json, */*'
  $req.UserAgent = 'StoryZLine'
  $req.Timeout = 20000
  $req.ReadWriteTimeout = 20000
  $proxy = [Net.WebRequest]::GetSystemWebProxy()
  $proxy.Credentials = [Net.CredentialCache]::DefaultCredentials
  $req.Proxy = $proxy
  $user = "$($Conn.user)".Trim()
  $pass = "$($Conn.password)"
  if ($user) {
    $req.Headers['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${user}:${pass}"))
  } elseif ($pass) {
    $req.Headers['Authorization'] = "Bearer $pass"
  }

  try {
    $res = $req.GetResponse()
  } catch {
    $we = $_.Exception
    while ($we -and -not ($we -is [Net.WebException])) { $we = $we.InnerException }
    if ($we -and $we.Response) { $res = $we.Response }
    else {
      $msg = if ($we) { $we.Message } else { $_.Exception.Message }
      Stop-WithStatus 502 "Could not reach Bitbucket at $($req.RequestUri.Authority): $msg"
    }
  }
  try {
    $status = [int]$res.StatusCode
    $contentType = "$($res.ContentType)"
    $in = $res.GetResponseStream()
    $ms = New-Object IO.MemoryStream
    $buf = New-Object byte[] 65536
    while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
      $ms.Write($buf, 0, $n)
      if ($ms.Length -gt $MaxBytes) { Stop-WithStatus 413 'File is larger than 5 MB.' }
    }
  } finally {
    $res.Close()
  }
  return @{ status = $status; contentType = $contentType; body = [Text.Encoding]::UTF8.GetString($ms.ToArray()) }
}

function Send-Static($Stream, [string]$Target) {
  $path = [Uri]::UnescapeDataString(($Target -split '\?')[0])
  if ($path -eq '/') { $path = '/index.html' }
  $file = [IO.Path]::GetFullPath([IO.Path]::Combine($Public, $path.TrimStart('/')))
  if (-not $file.StartsWith($Public + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    return Send-Response $Stream 403 ([Text.Encoding]::UTF8.GetBytes('Forbidden')) 'text/plain'
  }
  if (-not [IO.File]::Exists($file)) {
    return Send-Response $Stream 404 ([Text.Encoding]::UTF8.GetBytes('Not found')) 'text/plain'
  }
  $type = $Types[[IO.Path]::GetExtension($file).ToLower()]
  if (-not $type) { $type = 'application/octet-stream' }
  Send-Response $Stream 200 ([IO.File]::ReadAllBytes($file)) $type
}

function Invoke-Request($Stream) {
  $r = Read-Request $Stream
  if (-not $r) { return }
  if ($r.Method -eq 'POST' -and $r.Target.StartsWith('/api/')) {
    if (-not (Test-OwnPage $r)) { return Send-Json $Stream 403 @{ error = 'Requests must come from the StoryZLine page.' } }
    if ($r.Target -ne '/api/get') { return Send-Json $Stream 404 @{ error = 'Not found' } }
    $body = $r.Body | ConvertFrom-Json
    Send-Json $Stream 200 (Invoke-BitbucketGet "$($body.url)" $body.connection)
  } elseif ($r.Method -eq 'GET' -and $r.Target -eq '/api/config') {
    Send-Json $Stream 200 @{ server = 'powershell' }
  } elseif ($r.Method -eq 'GET') {
    Send-Static $Stream $r.Target
  } else {
    Send-Json $Stream 405 @{ error = 'Method not allowed' }
  }
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Host "Could not listen on port ${Port}: $($_.Exception.Message)"
  Write-Host "Another program (or StoryZLine) may already use it. Try: set PORT=5181"
  exit 1
}
Write-Host "StoryZLine (PowerShell) running at http://127.0.0.1:$Port  - close this window or press Ctrl+C to stop"
if ($Open) { Start-Process "http://127.0.0.1:$Port" }

# Browsers open spare connections that may never send a request, so only serve a
# connection once it has data, and drop idle ones; otherwise one idle socket would stall the server.
$clients = New-Object System.Collections.ArrayList
try {
  while ($true) {
    while ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      $c.ReceiveTimeout = 5000
      $c.SendTimeout = 5000
      [void]$clients.Add(@{ Client = $c; Since = [DateTime]::UtcNow })
    }
    foreach ($entry in @($clients)) {
      $c = $entry.Client
      if ($c.Available -gt 0) {
        [void]$clients.Remove($entry)
        $stream = $c.GetStream()
        try {
          Invoke-Request $stream
        } catch {
          $ex = $_.Exception
          $status = 500
          if ($ex.Data.Contains('status')) { $status = [int]$ex.Data['status'] }
          if ($status -eq 500) { Write-Host "Error: $($ex.Message)" }
          try { Send-Json $stream $status @{ error = $ex.Message } } catch { }
        } finally {
          $c.Close()
        }
      } elseif (([DateTime]::UtcNow - $entry.Since).TotalSeconds -gt 30) {
        [void]$clients.Remove($entry)
        $c.Close()
      }
    }
    Start-Sleep -Milliseconds 20
  }
} finally {
  foreach ($entry in $clients) { $entry.Client.Close() }
  $listener.Stop()
}
