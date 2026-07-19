param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$VoiceDisplayName = 'Microsoft Yaoyao',
  [double]$SpeakingRate = 1.03
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Wait-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Parameter(Mandatory = $true)][Type]$ResultType
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  if (-not $asTaskMethod) {
    throw 'Unable to locate the WinRT AsTask bridge.'
  }
  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

$synthType = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$streamType = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$voice = $synthType::AllVoices | Where-Object { $_.DisplayName -eq $VoiceDisplayName } | Select-Object -First 1
if (-not $voice) {
  throw "OneCore voice '$VoiceDisplayName' is not installed."
}

$synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
$synth.Voice = $voice
$synth.Options.SpeakingRate = $SpeakingRate
$operation = $synth.SynthesizeTextToStreamAsync($Text)
$speechStream = Wait-WinRtOperation -Operation $operation -ResultType $streamType

$parent = Split-Path -Parent $OutputPath
if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
$input = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($speechStream)
$output = [System.IO.File]::Create($OutputPath)
try {
  $input.CopyTo($output)
}
finally {
  $output.Dispose()
  $input.Dispose()
  $speechStream.Dispose()
  $synth.Dispose()
}
