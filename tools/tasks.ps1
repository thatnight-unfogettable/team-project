# 项目命令入口（Windows PowerShell）
# 用法：
#   powershell -File tools/tasks.ps1 test      # 断言 + 数据守卫
#   powershell -File tools/tasks.ps1 serve     # 起本地服务器（手机同网段可访问）
#   powershell -File tools/tasks.ps1 build     # 离线重建 shadows/routes/basemap
#   powershell -File tools/tasks.ps1 preview   # 出 14:00 的 PNG（不依赖浏览器）
#   powershell -File tools/tasks.ps1 clean     # 删 build.py 的自动备份与临时文件
#   powershell -File tools/tasks.ps1 all       # test
param(
  [Parameter(Position = 0)]
  [ValidateSet('test', 'serve', 'build', 'preview', 'clean', 'all', '')]
  [string]$Task = 'test',
  [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

switch ($Task) {
  'test' {
    if (Have node) { node tools/smoke.js; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
    else { Write-Warning ' 未找到 node，跳过 smoke.js' }
    $py = if (Have python) { 'python' } elseif (Have python3) { 'python3' } else { $null }
    if ($py) { & $py tools/ci/check_data.py; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
    else { Write-Warning ' 未找到 python，跳过 check_data.py' }
  }
  'serve' {
    # 页面本身 file:// 双击就能用；起服务器只是为了手机真机测试
    $py = if (Have python) { 'python' } elseif (Have python3) { 'python3' } else { $null }
    if (-not $py) { throw '需要 Python 才能起服务器：python -m http.server' }
    Write-Host "http://localhost:$Port/  （同网段手机用 http://<本机IP>:$Port/）"
    & $py -m http.server $Port
  }
  'build' {
    if (-not (Have python)) { throw '需要 python' }
    python tools/build.py shadows
    python tools/build.py routes
    python tools/build.py basemap
    node tools/smoke.js
  }
  'preview' {
    python tools/preview.py
  }
  'clean' {
    if (Test-Path data/.bak) { Remove-Item -Recurse -Force data/.bak; Write-Host '已删 data/.bak/' }
    Get-ChildItem -Recurse -Filter *.tmp | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host '临时文件清理完成'
  }
  'all' {
    & $PSCommandPath test
  }
  default { & $PSCommandPath test }
}