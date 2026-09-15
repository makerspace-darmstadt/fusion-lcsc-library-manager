# Windows code signing via Azure Artifact Signing, invoked by tauri (bundle.windows.signCommand).
# Logs the tool's full output to $env:RUNNER_TEMP\sign-windows.log (or %TEMP%) because tauri only
# reports "failed to run <cmd>" on failure.
param([Parameter(Mandatory = $true)][string]$File)

$logDir = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$log = Join-Path $logDir 'sign-windows.log'
"=== $(Get-Date -Format o) signing $File" | Tee-Object -FilePath $log -Append

& artifact-signing-cli -e https://weu.codesigning.azure.net -a mksp-trusted-signing -c MKSP-Windows-Signature -d 'Fusion LCSC Library Manager' $File 2>&1 |
  Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE
"=== exit code $code" | Tee-Object -FilePath $log -Append
exit $code
