# Import MSVC environment variables
$vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$tempFile = [System.IO.Path]::GetTempFileName()

# Run vcvars64.bat and capture environment
cmd /c "`"$vcvarsPath`" && set > `"$tempFile`""

# Parse and set environment variables
Get-Content $tempFile | ForEach-Object {
    if ($_ -match "^([^=]+)=(.*)$") {
        $name = $matches[1]
        $value = $matches[2]
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}
Remove-Item $tempFile

Write-Host "MSVC environment loaded."

# CRITICAL: Use rustup's cargo/rustc, not Chocolatey's GNU version.
# The rustup shims in .cargo\bin may be missing — fall back to the MSVC
# toolchain's bin directory, which contains the real cargo.exe/rustc.exe.
$rustupBin = "$env:USERPROFILE\.cargo\bin"
if (-not (Test-Path "$rustupBin\cargo.exe")) {
    $toolchainBin = "$env:USERPROFILE\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"
    if (Test-Path "$toolchainBin\cargo.exe") {
        $rustupBin = $toolchainBin
    } else {
        Write-Host "ERROR: cargo.exe not found in $rustupBin or $toolchainBin"
        Write-Host "Reinstall Rust via rustup: https://rustup.rs (choose the MSVC toolchain)"
        exit 1
    }
}
$env:PATH = "$rustupBin;$env:PATH"

Write-Host "Using rustup toolchain ($rustupBin):"
& "$rustupBin\rustc.exe" --version --verbose | Select-String "host:"

# Set local target directory to avoid network drive issues (building into Z:\
# goes over the network share and is slow/flaky)
$localTarget = "$env:USERPROFILE\.cargo-target\reader"
$env:CARGO_TARGET_DIR = $localTarget
Write-Host "CARGO_TARGET_DIR = $localTarget"

Set-Location "Z:\Programiren\git\reader"

# Build with tauri --no-bundle to skip bundler
Write-Host "`nBuilding Tauri (without bundler)..."
npx tauri build --no-bundle

Write-Host "`nChecking for executable..."
$exePath = "$localTarget\release\reader.exe"
if (Test-Path $exePath) {
    Write-Host "SUCCESS: $exePath"
    & cmd /c "dir `"$exePath`""
} else {
    Write-Host "ERROR: reader.exe not found at expected location"
    Write-Host "Searching for any reader* files..."
    & cmd /c "dir /s /b `"$localTarget\release\reader*`""
}
