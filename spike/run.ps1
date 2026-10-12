# Spike runner — boots the real headless profile with the out-of-tree probe.
#
# Answers exactly one question: can a plugin that lives OUTSIDE the dsh checkout
# load, resolve its `@deepseek-ai/dsh-*` imports against the running host, and
# receive the agent/request and agent/request-error waterfalls?
#
# No API key and no network model call: the shipped DeepSeek adapter is disabled
# by the overlay and the agent is pointed at the stub provider the probe
# registers. DSH_HOME is pinned to a local directory so the run is repeatable and
# leaves no state in the user's home.

$ErrorActionPreference = 'Continue'
$spike = $PSScriptRoot
# `session-persistence-jsonl` resolves `root: './.sessions'` against the process
# working directory, so pin it here. Without this the run writes into whatever
# directory the caller happened to be in.
Set-Location $spike
$env:DSH_HOME = Join-Path $spike '.dshhome'
$bin = Join-Path $spike 'node_modules\.bin\dsh.cmd'

if (-not (Test-Path $bin)) {
  Write-Output "FATAL: dsh CLI not installed at $bin"
  Write-Output "Run: npm install @deepseek-ai/dsh   in $spike"
  exit 2
}

Remove-Item (Join-Path $spike 'probe.log') -ErrorAction SilentlyContinue
Get-ChildItem $spike -Recurse -Filter 'probe.log' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $spike '.sessions') -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "=== spike boot: dsh --profile headless --patch ==="
Write-Output "cwd=$spike"
Write-Output "DSH_HOME=$env:DSH_HOME"
Write-Output ""

& $bin --profile headless --patch (Join-Path $spike 'cordis.patch.yml') 'reply with the single word OK' 2>&1
$code = $LASTEXITCODE

Write-Output ""
Write-Output "=== exit code: $code ==="
Write-Output ""
Write-Output "=== probe evidence (out-of-tree listeners) ==="
$probeLog = Get-ChildItem $spike -Recurse -Filter 'probe.log' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($probeLog) { Get-Content $probeLog.FullName } else { Write-Output 'NO probe.log — the plugin never ran' }
Write-Output ""
Write-Output "=== durable session events (routing-relevant) ==="
$sessions = Join-Path $spike '.sessions'
if (Test-Path $sessions) {
  Get-ChildItem $sessions -Recurse -Filter *.jsonl | ForEach-Object {
    Get-Content $_.FullName | ForEach-Object {
      try { $e = $_ | ConvertFrom-Json } catch { return }
      switch ($e.type) {
        'request/header'    { "request/header    provider={0} model={1}" -f $e.data.header.config.provider, $e.data.header.config.model }
        'assistant/attempt' {
          $fin = $e.data.stream | Where-Object { $_.chunk.type -eq 'finish' } | Select-Object -Last 1
          "assistant/attempt turn={0} step={1} finish={2} code={3}" -f $e.data.turn, $e.data.step, $fin.chunk.reason.kind, $fin.chunk.reason.failure.code
        }
        'llm/retry'         { "llm/retry          provider={0} mode={1} retry={2}/{3} code={4}" -f $e.data.provider, $e.data.mode, $e.data.retry, $e.data.maxRetries, $e.data.failure.code }
        'llm/retry-started' { "llm/retry-started  retry={0}" -f $e.data.retry }
        'assistant/message' { "assistant/message  provider={0} model={1} text={2}" -f $e.data.message.source.provider, $e.data.message.source.model, (($e.data.message.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text) }
        'turn/end'          { "turn/end           reason={0}" -f $e.data.reason.kind }
      }
    }
  }
} else {
  Write-Output "NO SESSION DIRECTORY — nothing was persisted"
}
