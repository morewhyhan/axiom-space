param(
  [Parameter(Mandatory = $true)][string]$TextPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$Rate = 2
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.SelectVoice('Microsoft Huihui Desktop')
  $speaker.Rate = $Rate
  $speaker.Volume = 100
  $speaker.SetOutputToWaveFile($OutputPath)
  $speaker.Speak($text)
} finally {
  $speaker.Dispose()
}
