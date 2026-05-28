param(
    [string[]]$Locations = @("chvp-dvr-hbvnym", "shknaym-mtzpvr-ykr")
)

$BucketName = "amit-photos-images"
$OriginUrl  = "https://www.amitphotos.com"
$DbName     = "amit-photos-db"

foreach ($slug in $Locations) {
    Write-Host "`n=== Processing: $slug ===" -ForegroundColor Cyan

    # Get all location_photos for this slug
    $rawJson = npx wrangler d1 execute $DbName --remote `
        --command "SELECT id, url, sort_order FROM location_photos WHERE location_id = '$slug' ORDER BY sort_order" `
        --json 2>&1

    $parsed = $rawJson | Where-Object { $_ -match '^\[' } | ConvertFrom-Json
    $photos  = $parsed[0].results

    if (-not $photos) {
        Write-Host "No photos found for $slug" -ForegroundColor Yellow
        continue
    }

    Write-Host "Found $($photos.Count) photos" -ForegroundColor Green

    foreach ($photo in $photos) {
        $id  = $photo.id
        $url = $photo.url
        Write-Host "`n  [$($photo.sort_order)] $id"
        Write-Host "  src: $url"

        # Download to temp file
        $tempFile = [System.IO.Path]::Combine($env:TEMP, "$id.jpg")
        try {
            curl.exe -sL --max-time 60 -o $tempFile $url
            if (-not (Test-Path $tempFile) -or (Get-Item $tempFile).Length -lt 10000) {
                Write-Host "  FAILED to download (file too small or missing)" -ForegroundColor Red
                continue
            }
            Write-Host "  Downloaded: $([math]::Round((Get-Item $tempFile).Length / 1KB)) KB"
        } catch {
            Write-Host "  Download error: $_" -ForegroundColor Red
            continue
        }

        # Generate R2 key
        $uuid  = [guid]::NewGuid().ToString()
        $r2Key = "locations/$slug/$uuid.jpg"

        # Upload to R2
        Write-Host "  Uploading to R2: $r2Key"
        $uploadOut = npx wrangler r2 object put "$BucketName/$r2Key" `
            --file $tempFile `
            --content-type "image/jpeg" 2>&1
        Write-Host "  R2: $uploadOut"

        # Update D1 record in-place (preserves id, sort_order, for_sale)
        $newUrl = "$OriginUrl/photos/$r2Key"
        $escapedKey = $r2Key -replace "'", "''"
        $escapedUrl = $newUrl -replace "'", "''"

        $updateSql = "UPDATE location_photos SET type = 'exclusive', r2_key = '$escapedKey', url = '$escapedUrl', thumbnail = '$escapedUrl' WHERE id = '$id'"
        $updateOut = npx wrangler d1 execute $DbName --remote --command $updateSql 2>&1
        Write-Host "  D1 update: $updateOut"

        Remove-Item $tempFile -ErrorAction SilentlyContinue
        Write-Host "  Done." -ForegroundColor Green
    }
}

Write-Host "`n=== All done ===" -ForegroundColor Cyan
