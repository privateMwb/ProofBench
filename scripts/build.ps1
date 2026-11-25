# Windows equivalent of build.sh. Run from PowerShell after activating emsdk.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {
    throw "emcc not found. Run: C:\emsdk\emsdk_env.ps1"
}

$want = (Get-Content .emscripten-version).Trim()
$have = ((emcc --version | Select-Object -First 1) -replace '.*?(\d+\.\d+\.\d+).*', '$1')
if ($want -ne $have) { Write-Warning "pinned Emscripten is $want but you have $have" }

$out = "site/wasm"
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($src in Get-ChildItem wasm -Filter *.cpp) {
    $name = $src.BaseName
    Write-Host "building $name"
    emcc $src.FullName -o "$out/$name.js" `
        -std=c++20 -O2 -Wall -Wextra `
        -I libs `
        "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sWASM_BIGINT=1" `
        "-sEXPORT_NAME=create_$name" `
        "-sENVIRONMENT=web,worker,node" `
        "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap" `
        "-sALLOW_MEMORY_GROWTH=1"
    if ($LASTEXITCODE -ne 0) { throw "build failed for $name" }
}
Write-Host "done -> $out"
