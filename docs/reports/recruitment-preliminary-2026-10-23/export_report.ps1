$ErrorActionPreference = 'Stop'
$deckFile = Join-Path $PSScriptRoot 'Recruitment_System_Bao_cao_so_bo.pptx'
$previewFolder = Join-Path $PSScriptRoot 'preview'
New-Item -ItemType Directory -Path $previewFolder -Force | Out-Null
$pptApp = New-Object -ComObject PowerPoint.Application
try {
    $deck = $pptApp.Presentations.Open($deckFile, 0, 0, 0)
    try {
        $deck.SaveAs([IO.Path]::ChangeExtension($deckFile, '.pdf'), 32)
        $deck.Export($previewFolder, 'PNG', 1600, 900)
        $measurements = @()
        foreach ($slide in $deck.Slides) {
            foreach ($shape in $slide.Shapes) {
                if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
                    $range = $shape.TextFrame.TextRange
                    $measurements += [PSCustomObject]@{
                        slide = $slide.SlideIndex
                        text = $range.Text
                        box_height = $shape.Height
                        text_height = $range.BoundHeight
                        box_width = $shape.Width
                        text_width = $range.BoundWidth
                    }
                }
            }
        }
        $measurements | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'text_measurements.json') -Encoding UTF8
        Write-Output ('Exported ' + $deck.Slides.Count + ' slides and PDF')
    } finally { $deck.Close() }
} finally { $pptApp.Quit() }
