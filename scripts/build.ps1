# Windows equivalent of build.sh. Run from PowerShell after activating emsdk.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {
    throw "emcc not found. Run: C:\emsdk\emsdk_env.ps1"
}

$want = (Get-Content .emscripten-version).Trim()
$have = ((emcc --version | Select-Object -First 1) -replace '.*?(\d+\.\d+\.\d+).*', '$1')
if ($want -ne $have) { Write-Warning "pinned Emscripten is $want but you have $have" }

# Every libs/<name>/include directory goes on the include path.
$inc = @()
if (Test-Path libs) {
    foreach ($d in Get-ChildItem libs -Directory) {
        if (Test-Path "libs/$($d.Name)/include") { $inc += "-Ilibs/$($d.Name)/include" }
    }
}

$out = "site/wasm"
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($src in Get-ChildItem wasm -Filter *.cpp) {
    $name = $src.BaseName
    Write-Host "building $name"
    # Modules named *_verify inject exceptions, so they need C++ exceptions enabled.
    $extra = @()
    if ($name -like '*_verify') { $extra += '-fwasm-exceptions' }
    emcc "wasm/$($src.Name)" -o "$out/$name.js" `
        -std=c++23 -O2 -Wall -Wextra `
        $inc $extra `
        "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sWASM_BIGINT=1" `
        "-sEXPORT_NAME=create_$name" `
        "-sENVIRONMENT=web,worker,node" `
        "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap" `
        "-sALLOW_MEMORY_GROWTH=1"
    if ($LASTEXITCODE -ne 0) { throw "build failed for $name" }
}
Write-Host "done -> $out"
