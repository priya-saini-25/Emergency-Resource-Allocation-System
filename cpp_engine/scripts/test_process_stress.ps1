# Phase 3.13: End-to-End Process Stress, Reliability & Benchmarking Harness
# Tests the compiled C++ executable (bin/engine.exe) via stdin/stdout pipe redirection.

param (
    [string]$EnginePath = ".\bin\engine.exe",
    [string]$DataDir = ".\data"
)

$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
$ErrorActionPreference = "Continue"
$global:PassCount = 0
$global:FailCount = 0

function Assert-Test {
    param(
        [bool]$Condition,
        [string]$Message
    )
    if ($Condition) {
        Write-Host "  [PASS] $Message" -ForegroundColor Green
        $global:PassCount++
    } else {
        Write-Host "  [FAIL] $Message" -ForegroundColor Red
        $global:FailCount++
        throw "Assertion failed: $Message"
    }
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  PHASE 3.13 END-TO-END PROCESS STRESS & BENCHMARKING HARNESS    " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "Engine: $EnginePath"
Write-Host "DataDir: $DataDir"

# Ensure temp directory exists
$tempDir = Join-Path $PSScriptRoot "temp_fixtures"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

try {
    # =========================================================================
    # PART 1: SPECIAL CLI MODES & STREAM INTEGRITY
    # =========================================================================
    Write-Host "`n--- PART 1: Special CLI Modes & Stream Integrity ---" -ForegroundColor Yellow

    # 1.1 --version
    $verOut = & $EnginePath --version
    $verExit = $LASTEXITCODE
    Assert-Test ($verExit -eq 0) "--version returns exit code 0"
    $verJson = $verOut | ConvertFrom-Json
    Assert-Test ($verJson.protocol_version -eq "1.0") "--version outputs protocol_version 1.0"
    Assert-Test ($verJson.engine -like "*Jodhpur Emergency Dispatch Engine*") "--version outputs correct engine name"

    # 1.2 --help
    $helpOut = & $EnginePath --help
    $helpExit = $LASTEXITCODE
    Assert-Test ($helpExit -eq 0) "--help returns exit code 0"
    Assert-Test ([bool]($helpOut -join "`n" -match "Usage:")) "--help outputs usage manual"

    # =========================================================================
    # PART 2: MALFORMED & ADVERSARIAL INPUT TESTING
    # =========================================================================
    Write-Host "`n--- PART 2: Malformed & Adversarial Input Testing ---" -ForegroundColor Yellow

    $adversarialCases = @(
        @{ Name = "Empty Input"; Input = ""; ExpectedExit = 1; ExpectedCode = "EMPTY_INPUT" },
        @{ Name = "Whitespace Only"; Input = "   `t`n`r  "; ExpectedExit = 1; ExpectedCode = "EMPTY_INPUT" },
        @{ Name = "Malformed JSON Syntax"; Input = "{ invalid json "; ExpectedExit = 1; ExpectedCode = "INVALID_JSON" },
        @{ Name = "Truncated JSON"; Input = "{ `"protocol_version`": `"1.0`", `"payload`": {"; ExpectedExit = 1; ExpectedCode = "INVALID_JSON" },
        @{ Name = "Top-level Array"; Input = "[1, 2, 3]"; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Missing request_id"; Input = '{"protocol_version":"1.0","operation":"dispatch_batch","payload":{}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Empty request_id"; Input = '{"protocol_version":"1.0","request_id":"","operation":"dispatch_batch","payload":{}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Unsupported protocol_version"; Input = '{"protocol_version":"9.9","request_id":"R1","operation":"dispatch_batch","payload":{}}'; ExpectedExit = 1; ExpectedCode = "INVALID_PROTOCOL_VERSION" },
        @{ Name = "Unknown operation"; Input = '{"protocol_version":"1.0","request_id":"R2","operation":"unknown_op","payload":{}}'; ExpectedExit = 1; ExpectedCode = "UNKNOWN_OPERATION" },
        @{ Name = "Non-object payload"; Input = '{"protocol_version":"1.0","request_id":"R3","operation":"dispatch_batch","payload":"string"}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Missing evaluated_at_ms"; Input = '{"protocol_version":"1.0","request_id":"R4","operation":"dispatch_batch","payload":{"incidents":[]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Empty incidents array"; Input = '{"protocol_version":"1.0","request_id":"R5","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Invalid incident category"; Input = '{"protocol_version":"1.0","request_id":"R6","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"VOLCANO","severity":3,"latitude":26.27,"longitude":73.01}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Severity out of bounds (0)"; Input = '{"protocol_version":"1.0","request_id":"R7","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"MEDICAL","severity":0,"latitude":26.27,"longitude":73.01}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Severity out of bounds (6)"; Input = '{"protocol_version":"1.0","request_id":"R8","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"MEDICAL","severity":6,"latitude":26.27,"longitude":73.01}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Duplicate incident IDs"; Input = '{"protocol_version":"1.0","request_id":"R9","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":10,"category":"MEDICAL","severity":3,"latitude":26.27,"longitude":73.01},{"incident_id":10,"category":"FIRE","severity":3,"latitude":26.28,"longitude":73.02}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Duplicate resource IDs"; Input = '{"protocol_version":"1.0","request_id":"R10","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"MEDICAL","severity":3,"latitude":26.27,"longitude":73.01}],"resources":[{"resource_id":50,"resource_type":"ALS_AMBULANCE","latitude":26.27,"longitude":73.01},{"resource_id":50,"resource_type":"BLS_AMBULANCE","latitude":26.28,"longitude":73.02}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Duplicate hospital IDs"; Input = '{"protocol_version":"1.0","request_id":"R11","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"MEDICAL","severity":3,"latitude":26.27,"longitude":73.01}],"hospitals":[{"hospital_id":77,"name":"H1","latitude":26.27,"longitude":73.01},{"hospital_id":77,"name":"H2","latitude":26.28,"longitude":73.02}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" },
        @{ Name = "Out-of-range latitude (95.0)"; Input = '{"protocol_version":"1.0","request_id":"R12","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"MEDICAL","severity":3,"latitude":95.0,"longitude":73.01}]}}'; ExpectedExit = 1; ExpectedCode = "INVALID_REQUEST" }
    )

    foreach ($tc in $adversarialCases) {
        $outFile = Join-Path $tempDir "adv_out.json"
        $errFile = Join-Path $tempDir "adv_err.log"

        $tc.Input | & $EnginePath --data-dir $DataDir 1> $outFile 2> $errFile
        $exitCode = $LASTEXITCODE

        Assert-Test ($exitCode -eq $tc.ExpectedExit) "$($tc.Name) returned exit code $($tc.ExpectedExit)"
        $raw = Get-Content $outFile -Raw
        $json = $raw | ConvertFrom-Json
        Assert-Test ($json.status -eq "error") "$($tc.Name) emitted status=error"
        Assert-Test ($json.error.code -eq $tc.ExpectedCode) "$($tc.Name) emitted error code $($tc.ExpectedCode)"
    }

    # Test Missing Dataset Directory (ExitCode 2)
    $tcDataErr = @{ Name = "Missing Dataset Dir"; Input = '{"protocol_version":"1.0","request_id":"R_DATA_ERR","operation":"dispatch_batch","payload":{"batch_id":1,"evaluated_at_ms":1000,"incidents":[{"incident_id":1,"category":"MEDICAL","severity":3,"created_at_ms":1000,"latitude":26.27,"longitude":73.01}]}}' }
    $tcDataErr.Input | & $EnginePath --data-dir "C:\nonexistent_path_abc" 1> (Join-Path $tempDir "data_err.json") 2> (Join-Path $tempDir "data_err.log")
    $exitCodeData = $LASTEXITCODE
    Assert-Test ($exitCodeData -eq 2) "Missing Dataset Dir returned exit code 2 (INITIALIZATION_OR_DATA_ERR)"
    $jsonDE = Get-Content (Join-Path $tempDir "data_err.json") -Raw | ConvertFrom-Json
    Assert-Test ($jsonDE.error.code -eq "DATASET_LOAD_ERROR") "Missing Dataset Dir emitted DATASET_LOAD_ERROR"

    # =========================================================================
    # PART 3: END-TO-END VALID REQUEST WORKLOAD MATRIX (1, 5, 10, 25, 50 Incidents)
    # =========================================================================
    Write-Host "`n--- PART 3: End-to-End Valid Request Workload Matrix ---" -ForegroundColor Yellow

    function Generate-ValidBatchJson {
        param([int]$IncidentCount)

        $categories = @("MEDICAL", "ROAD_ACCIDENT", "FIRE", "INDUSTRIAL")
        $incidents = @()
        for ($i = 1; $i -le $IncidentCount; $i++) {
            $cat = $categories[$i % 4]
            $sev = 1 + ($i % 5)
            $vics = ($i % 4)
            $lat = 26.250 + ($i % 10) * 0.005
            $lon = 73.005 + [math]::Floor($i / 10) * 0.006

            $inc = @{
                incident_id = 1000 + $i
                category = $cat
                severity = $sev
                victim_count = $vics
                created_at_ms = 1700000000000 - ($i * 15000)
                latitude = $lat
                longitude = $lon
            }
            if ($cat -eq "FIRE") {
                $inc["resource_demands"] = @(@{ type = "FIRE_ENGINE"; quantity = 1 })
            }
            $incidents += $inc
        }

        $resources = @()
        $rId = 1
        for ($r = 0; $r -lt [math]::Max(10, $IncidentCount); $r++) {
            $type = if ($r % 4 -eq 0) { "ALS_AMBULANCE" } elseif ($r % 4 -eq 1) { "BLS_AMBULANCE" } elseif ($r % 4 -eq 2) { "FIRE_ENGINE" } else { "RESCUE_VEHICLE" }
            $resources += @{
                resource_id = 5000 + $rId++
                resource_type = $type
                status = "AVAILABLE"
                latitude = 26.260 + ($r % 6) * 0.005
                longitude = 73.008 + [math]::Floor($r / 6) * 0.005
            }
        }

        $hospitals = @(
            @{
                hospital_id = 701
                name = "MDM Hospital Jodhpur"
                latitude = 26.273
                longitude = 73.012
                status = "NORMAL"
                available_general_beds = 50
                available_icu_beds = 15
                available_oxygen_beds = 20
                capabilities = @("GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT")
            },
            @{
                hospital_id = 702
                name = "AIIMS Jodhpur"
                latitude = 26.248
                longitude = 73.003
                status = "NORMAL"
                available_general_beds = 80
                available_icu_beds = 25
                available_oxygen_beds = 40
                capabilities = @("GENERAL_EMERGENCY", "TRAUMA_CENTER", "CARDIAC_CARE", "BURN_UNIT", "PEDIATRIC_CARE")
            }
        )

        $reqObj = @{
            protocol_version = "1.0"
            request_id = "REQ-BATCH-$IncidentCount"
            operation = "dispatch_batch"
            payload = @{
                batch_id = $IncidentCount
                evaluated_at_ms = 1700000000000
                max_snap_distance_meters = 2500.0
                simulated_hospital_transit_speed_kmh = 35.0
                incidents = $incidents
                resources = $resources
                hospitals = $hospitals
            }
        }
        return ($reqObj | ConvertTo-Json -Depth 10)
    }

    $workloadCounts = @(1, 5, 10, 25, 50)
    foreach ($count in $workloadCounts) {
        $jsonStr = Generate-ValidBatchJson -IncidentCount $count
        $reqFile = Join-Path $tempDir "req_$count.json"
        $respFile = Join-Path $tempDir "resp_$count.json"
        $errFile = Join-Path $tempDir "err_$count.log"
        Set-Content -Path $reqFile -Value $jsonStr

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        Get-Content $reqFile | & $EnginePath --data-dir $DataDir 1> $respFile 2> $errFile
        $sw.Stop()
        $exitCode = $LASTEXITCODE

        Assert-Test ($exitCode -eq 0) "Batch size $count incidents exited with code 0 in $($sw.ElapsedMilliseconds) ms"
        $resp = Get-Content $respFile -Raw | ConvertFrom-Json
        Assert-Test ($resp.status -eq "success") "Batch size $count status == success"
        Assert-Test ($resp.request_id -eq "REQ-BATCH-$count") "Batch size $count request_id matches"
        Assert-Test ($resp.data.total_incidents_received -eq $count) "Batch size $count processed $count incidents"
        Assert-Test ($resp.data.incident_results.Count -eq $count) "Batch size $count returned $count incident results"

        # Check resource uniqueness invariant across batch
        $allocatedSet = [System.Collections.Generic.HashSet[int]]::new()
        foreach ($ir in $resp.data.incident_results) {
            foreach ($res in $ir.resource_allocation.allocated_resources) {
                $rid = [int]$res.resource_id
                Assert-Test (-not $allocatedSet.Contains($rid)) "Batch size $($count) - Resource $rid allocated at most once"
                $allocatedSet.Add($rid) | Out-Null
            }
        }
    }

    # =========================================================================
    # PART 4: REPEATED PROCESS EXECUTION (10, 50, 100 Sequential Invocations)
    # =========================================================================
    Write-Host "`n--- PART 4: Repeated Process Execution (10, 50, 100 Invocations) ---" -ForegroundColor Yellow

    $req5Json = Generate-ValidBatchJson -IncidentCount 5
    $req5File = Join-Path $tempDir "req_seq_5.json"
    Set-Content -Path $req5File -Value $req5Json

    $sequentialBatches = @(10, 50, 100)
    foreach ($seqTotal in $sequentialBatches) {
        Write-Host "Running $seqTotal sequential process invocations..."
        $seqFail = 0
        $seqTimes = @()
        $swSeq = [System.Diagnostics.Stopwatch]::StartNew()

        for ($i = 1; $i -le $seqTotal; $i++) {
            $sOut = Join-Path $tempDir "seq_out.json"
            $sErr = Join-Path $tempDir "seq_err.log"

            $iterSw = [System.Diagnostics.Stopwatch]::StartNew()
            Get-Content $req5File | & $EnginePath --data-dir $DataDir 1> $sOut 2> $sErr
            $iterSw.Stop()
            $seqTimes += $iterSw.ElapsedMilliseconds

            if ($LASTEXITCODE -ne 0) {
                $seqFail++
                continue
            }
            $raw = Get-Content $sOut -Raw
            if (-not $raw.StartsWith("{") -or -not $raw.Trim().EndsWith("}")) {
                $seqFail++
            }
        }
        $swSeq.Stop()

        Assert-Test ($seqFail -eq 0) "$seqTotal / $seqTotal sequential executions succeeded (0 failures)"
        $avgMs = [math]::Round(($seqTimes | Measure-Object -Average).Average, 1)
        Write-Host "  -> $seqTotal runs completed in $($swSeq.ElapsedMilliseconds) ms (Average: $avgMs ms/process)" -ForegroundColor Gray
    }

    # =========================================================================
    # PART 5: CONCURRENT PROCESS TESTING (2, 4, 8 Simultaneous Processes)
    # =========================================================================
    Write-Host "`n--- PART 5: Concurrent Process Testing (2, 4, 8 Processes) ---" -ForegroundColor Yellow

    $concurrencyLevels = @(2, 4, 8)
    foreach ($concurrency in $concurrencyLevels) {
        Write-Host "Testing $concurrency concurrent independent processes..."
        $processes = @()

        $swConc = [System.Diagnostics.Stopwatch]::StartNew()
        for ($p = 1; $p -le $concurrency; $p++) {
            $pReq = Generate-ValidBatchJson -IncidentCount (2 + $p)
            $pReqFile = Join-Path $tempDir "conc_req_$p.json"
            $pOutFile = Join-Path $tempDir "conc_out_$p.json"
            $pErrFile = Join-Path $tempDir "conc_err_$p.log"
            Set-Content -Path $pReqFile -Value $pReq

            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = (Resolve-Path $EnginePath).Path
            $psi.Arguments = "--data-dir `"$((Resolve-Path $DataDir).Path)`""
            $psi.RedirectStandardInput = $true
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true

            $proc = [System.Diagnostics.Process]::Start($psi)
            $processes += @{
                Process = $proc
                Input = $pReq
                OutFile = $pOutFile
                ErrFile = $pErrFile
                IncidentCount = (2 + $p)
            }
        }

        # Stream inputs to all concurrent processes
        foreach ($item in $processes) {
            $item.Process.StandardInput.Write($item.Input)
            $item.Process.StandardInput.Close()
        }

        # Await completion of all concurrent processes
        $concSuccess = 0
        foreach ($item in $processes) {
            $stdoutStr = $item.Process.StandardOutput.ReadToEnd()
            $stderrStr = $item.Process.StandardError.ReadToEnd()
            $item.Process.WaitForExit()
            Set-Content -Path $item.OutFile -Value $stdoutStr
            Set-Content -Path $item.ErrFile -Value $stderrStr
            if ($item.Process.ExitCode -eq 0) {
                $concSuccess++
            }
        }
        $swConc.Stop()

        Assert-Test ($concSuccess -eq $concurrency) "$concurrency / $concurrency concurrent processes exited with code 0"
        Write-Host "  -> $concurrency parallel processes completed in $($swConc.ElapsedMilliseconds) ms" -ForegroundColor Gray

        # Verify each process produced valid independent JSON without crosstalk
        for ($p = 1; $p -le $concurrency; $p++) {
            $pOut = Join-Path $tempDir "conc_out_$p.json"
            $raw = Get-Content $pOut -Raw
            $json = $raw | ConvertFrom-Json
            Assert-Test ($json.status -eq "success") "Concurrent process $p status == success"
            Assert-Test ($json.data.total_incidents_received -eq (2 + $p)) "Concurrent process $p incident count isolated and correct"
        }
    }

    # =========================================================================
    # PART 6: PROCESS LIFECYCLE & PERFORMANCE BENCHMARKING (35 Samples)
    # =========================================================================
    Write-Host "`n--- PART 6: Detailed Process Latency Benchmarking (35 Samples) ---" -ForegroundColor Yellow

    $benchTimes = @()
    $benchReqFile = Join-Path $tempDir "req_5.json"
    $benchOut = Join-Path $tempDir "bench_out.json"
    $benchErr = Join-Path $tempDir "bench_err.log"

    # Warm-up run
    Get-Content $benchReqFile | & $EnginePath --data-dir $DataDir 1> $benchOut 2> $benchErr | Out-Null

    for ($s = 1; $s -le 35; $s++) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        Get-Content $benchReqFile | & $EnginePath --data-dir $DataDir 1> $benchOut 2> $benchErr
        $sw.Stop()
        $benchTimes += $sw.ElapsedMilliseconds
    }

    $sortedTimes = $benchTimes | Sort-Object
    $minTime = $sortedTimes[0]
    $medianTime = $sortedTimes[17]
    $p95Time = $sortedTimes[33]
    $maxTime = $sortedTimes[34]
    $avgTime = [math]::Round(($benchTimes | Measure-Object -Average).Average, 2)

    Write-Host "  -> Process Invocation Latency across 35 independent process spawns:" -ForegroundColor Cyan
    Write-Host "     Min:    $minTime ms"
    Write-Host "     Avg:    $avgTime ms"
    Write-Host "     Median: $medianTime ms"
    Write-Host "     P95:    $p95Time ms"
    Write-Host "     Max:    $maxTime ms"

    Assert-Test ($avgTime -lt 5000) "Average process startup + load + execution latency is reasonable (< 5000 ms)"

    # Inspect internal orchestration telemetry from the last run
    $lastResp = Get-Content $benchOut -Raw | ConvertFrom-Json
    $internalOrchMs = $lastResp.metadata.total_execution_time_ms
    Write-Host "  -> Internal C++ Algorithmic Execution Time: $internalOrchMs ms" -ForegroundColor Cyan
    Assert-Test ($internalOrchMs -lt 50.0) "Internal C++ dispatch orchestration is sub-50ms (< 50.0 ms)"

} finally {
    # Clean up temp files
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "  HARNESS SUMMARY: $global:PassCount PASSED, $global:FailCount FAILED" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

if ($global:FailCount -gt 0) {
    exit 1
} else {
    exit 0
}
