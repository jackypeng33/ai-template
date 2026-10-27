# Offline reference voice. Does not call a music or video API.
Add-Type -AssemblyName System.Speech
$rapRoot = Split-Path -Parent $PSScriptRoot
$rapAudioPath = Join-Path $rapRoot 'inputs/rap-audio'
New-Item -ItemType Directory -Force -Path $rapAudioPath | Out-Null
$rapVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $rapVoice.SelectVoice('Microsoft Zira Desktop')
  $rapVoice.Rate = 2
  $rapLines = @('Two faces, one beat.', 'Step in, feel the heat.', 'Side by side, we shine.', 'Your crew, your time.')
  for ($rapIndex = 0; $rapIndex -lt $rapLines.Count; $rapIndex++) {
    $rapVoice.SetOutputToWaveFile((Join-Path $rapAudioPath ('line-' + $rapIndex + '.wav')))
    $rapVoice.Speak($rapLines[$rapIndex])
    $rapVoice.SetOutputToNull()
  }
} finally { $rapVoice.Dispose() }
