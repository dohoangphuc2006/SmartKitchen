param([int]$Port = 8000, [switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PIP_CONFIG_FILE = 'NUL'
Remove-Item Env:PYTHONPATH, Env:PYTHONHOME -ErrorAction SilentlyContinue
$root = $PSScriptRoot
$venv = Join-Path $root '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$versionProbe = 'import sys, sysconfig; raise SystemExit(not (sys.implementation.name == ''cpython'' and sys.version_info[:2] == (3, 14) and sysconfig.get_platform() == ''win-amd64''))'

function Find-Python {
    $candidates = @()
    foreach ($name in @('py.exe', 'python3.14.exe', 'python.exe')) {
        foreach ($command in @(Get-Command $name -All -ErrorAction SilentlyContinue)) {
            $arguments = @()
            if ($name -eq 'py.exe') { $arguments = @('-3.14') }
            $candidates += [pscustomobject]@{ Path = $command.Source; Arguments = $arguments }
        }
    }
    foreach ($hive in @('HKCU:', 'HKLM:')) {
        $key = Get-Item -LiteralPath "$hive\Software\Python\PythonCore\3.14\InstallPath" -ErrorAction SilentlyContinue
        if ($key -and $key.GetValue('ExecutablePath')) {
            $candidates += [pscustomobject]@{ Path = $key.GetValue('ExecutablePath'); Arguments = @() }
        }
    }
    if ($env:LOCALAPPDATA) {
        foreach ($pattern in @('Python\pythoncore-3.14*\python.exe', 'Programs\Python\Python314\python.exe')) {
            foreach ($item in @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA $pattern) -File -ErrorAction SilentlyContinue)) {
                $candidates += [pscustomobject]@{ Path = $item.FullName; Arguments = @() }
            }
        }
    }
    foreach ($candidate in $candidates) {
        try {
            $arguments = $candidate.Arguments
            & $candidate.Path @arguments -I -c $versionProbe 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { continue }
    }
    throw 'Cần cài CPython 3.14 64-bit. Xem liên kết cài đặt trong README.md.'
}

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments, [string]$Failure)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Failure (mã $LASTEXITCODE)." }
}

function Get-Sha256 {
    param([string]$Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $hash.Dispose()
    }
}

try {
    if ($env:OS -ne 'Windows_NT' -or 'AMD64' -notin @($env:PROCESSOR_ARCHITECTURE, $env:PROCESSOR_ARCHITEW6432)) {
        throw 'Gói này yêu cầu Windows x64 (Intel hoặc AMD).'
    }
    $manifestPath = Join-Path $root 'release\SHA256_MANIFEST.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'Thiếu release\SHA256_MANIFEST.json. Hãy giải nén đầy đủ ZIP phát hành.'
    }
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    if ($manifest.files.Count -lt 1 -or $manifest.files.Count -ne $manifest.file_count) {
        throw 'Danh sách SHA-256 không hợp lệ. Hãy giải nén lại ZIP phát hành.'
    }
    foreach ($entry in $manifest.files) {
        $path = Join-Path $root $entry.path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Thiếu tệp $($entry.path). Hãy giải nén lại ZIP phát hành." }
        if ((Get-Item -LiteralPath $path).Length -ne $entry.bytes -or
            (Get-Sha256 $path) -ne $entry.sha256) {
            throw "Sai SHA-256 hoặc dung lượng của $($entry.path). Hãy giải nén lại ZIP phát hành."
        }
    }
    Write-Host "SHA-256 PASS ($($manifest.file_count) tệp)."

    if (-not $CheckOnly) {
        if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
            $base = Find-Python
            Write-Host 'Đang tạo môi trường .venv trong thư mục dự án...'
            Invoke-Checked $base.Path ($base.Arguments + @('-m', 'venv', $venv)) 'Không thể tạo .venv'
        }
        Invoke-Checked $python @('-I', '-c', $versionProbe) 'Môi trường .venv cần CPython 3.14 64-bit. Hãy đổi tên .venv cũ và chạy lại'
        $requirements = Join-Path $root 'app\requirements-vision.txt'
        Write-Host 'Đang cài thư viện gợi ý món và nhận diện ảnh/webcam thử nghiệm...'
        Invoke-Checked $python @('-I', '-X', 'utf8', '-m', 'pip', '--isolated', '--disable-pip-version-check',
            'install', '--index-url', 'https://pypi.org/simple', '--no-cache-dir', '--only-binary=:all:',
            '--timeout', '20', '--retries', '2', '-r', $requirements) 'Cài thư viện thất bại. Hãy kiểm tra kết nối đến PyPI và thử lại'
        Invoke-Checked $python @('-m', 'pip', 'check') 'Môi trường có phụ thuộc không tương thích'
    } elseif (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        throw 'Chưa có .venv. Hãy chạy setup_env.ps1 trước.'
    } else {
        Invoke-Checked $python @('-I', '-c', $versionProbe) 'Môi trường .venv cần CPython 3.14 64-bit. Hãy đổi tên .venv cũ và chạy lại'
    }

    Invoke-Checked $python @('-B', '-s', '-X', 'utf8', (Join-Path $root 'app\run_app.py'), '--profile', 'recipe', '--with-yolo', '--check', '--port', "$Port") 'Preflight thất bại. Xem lỗi phía trên'
    if (-not $CheckOnly) {
        Write-Host 'Cài đặt hoàn tất. Chạy Start_Smart_Kitchen.cmd để mở ứng dụng.'
    }
    exit 0
} catch {
    [Console]::Error.WriteLine("LỖI SMART KITCHEN: $($_.Exception.Message)")
    exit 1
}
