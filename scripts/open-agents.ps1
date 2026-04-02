#Requires -Version 5.1
<#
.SYNOPSIS
    Nucleus Portal - Multi-Agent Claude Code Workspace Launcher

.DESCRIPTION
    Creates a Windows Terminal tab with 4 panes:

    +----------------------+---------------------+
    |                      |  AGENT-1  BACKEND   |
    |        MASTER        +---------------------+
    |    (claude code)     |  AGENT-2  FRONTEND  |
    |      LEFT 50%        +---------------------+
    |                      |  AGENT-3  INFRA     |
    +----------------------+---------------------+

    Layout math (right column):
      Step 2: split-pane -V -s 0.5   -> MASTER=50%, RIGHT=50%
      Step 3: split-pane -H -s 0.667 -> AGENT-1=33.3% top, new=66.7% bottom
      Step 4: split-pane -H -s 0.5   -> AGENT-2=33.3%, AGENT-3=33.3%
    Result: 3 equal right panes (~33.3% each). Exact thirds impossible
    in binary float; 0.667/0.5 is the closest exact-halving solution.

    Focus chain (WT always focuses the newly created pane):
      After step 2: focus -> AGENT-1 BACKEND  (right)
      After step 3: focus -> AGENT-2 FRONTEND (mid-right)
      After step 4: focus -> AGENT-3 INFRA    (bottom-right)
    All horizontal splits land in the right column because focus stays there.

.NOTES
    Requires: Windows Terminal 1.7+, PowerShell 5.1+ (7+ recommended)
    Usage:    pwsh -File Z:\nucleus-portal\scripts\open-agents.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -- Project paths -------------------------------------------------------------
$root     = 'Z:\nucleus-portal'
$backend  = "$root\packages\backend"
$frontend = "$root\packages\frontend"
$infra    = "$root\agent"

# -- Timing constants (ms) -----------------------------------------------------
# Increase INIT_WAIT on slow machines or first-launch (WT cold start).
# Increase SPLIT_WAIT if panes launch in wrong positions.
$INIT_WAIT  = 2500   # wait after new-tab for WT window to be ready
$SPLIT_WAIT = 1000   # wait between each split-pane for focus to settle

# -- Path validation -----------------------------------------------------------
$missingPaths = @($root, $backend, $frontend, $infra) |
    Where-Object { -not (Test-Path -LiteralPath $_ -PathType Container) }

if ($missingPaths.Count -gt 0) {
    Write-Warning "The following directories do not exist. Affected panes will open in the default directory:"
    $missingPaths | ForEach-Object { Write-Warning "  Missing: $_" }
    Write-Host ""
}

# -- Duplicate session guard ---------------------------------------------------
# wt.exe does not expose pane/session state via CLI.
# We count active 'claude' processes as a proxy: 4+ likely means a full
# workspace is already running. This is best-effort, not a hard lock.
$claudeCount = @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue).Count
if ($claudeCount -ge 4) {
    Write-Warning "Detected $claudeCount active 'claude' process(es). A workspace may already be running."
    $answer = Read-Host "Continue and open a new workspace? [y/N]"
    if ($answer -notmatch '^[yY]$') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
}

# -- Header --------------------------------------------------------------------
Write-Host "Nucleus Portal - Agent Workspace" -ForegroundColor Cyan
Write-Host "---------------------------------" -ForegroundColor DarkGray
Write-Host ""

# -- PANE 1: MASTER ------------------------------------------------------------
# new-tab opens in the current WT window (or creates a new one if none exists).
# --maximized maximizes the window. --title sets the tab/pane title.
# -d sets the working directory. pwsh launches claude and keeps the pane alive.
# Single quotes around 'claude' are intentional: -Command receives it as a
# literal string, not a PowerShell expression. This is correct and safe.
Write-Host "[1/4] MASTER           $root" -ForegroundColor Green
& wt.exe --maximized new-tab `
    --title 'MASTER' `
    -d $root `
    pwsh.exe -NoExit -Command 'claude'

# Wait for WT to create the window, render it, and make it the active window
# for --window 0 targeting. wt.exe returns immediately (fire-and-forget).
# Too short = subsequent --window 0 commands target the wrong window.
Write-Host "  Waiting for WT window initialization..." -ForegroundColor DarkGray
Start-Sleep -Milliseconds $INIT_WAIT

# -- PANE 2: AGENT-1 BACKEND ---------------------------------------------------
# Vertical split (-V) of the focused MASTER pane (left side).
# -s 0.5: new right pane = 50% of total width. MASTER keeps left 50%.
# After this, WT moves focus to the new right pane (AGENT-1).
# All future -H splits will operate on this right column.
Write-Host "[2/4] AGENT-1 BACKEND  $backend" -ForegroundColor Green
& wt.exe --window 0 split-pane -V -s 0.5 `
    --title 'AGENT-1 BACKEND' `
    -d $backend `
    pwsh.exe -NoExit -Command 'claude'

# Wait for WT to finalize the split and settle focus on AGENT-1 (right pane).
# The next split must originate from AGENT-1, not MASTER.
Start-Sleep -Milliseconds $SPLIT_WAIT

# -- PANE 3: AGENT-2 FRONTEND --------------------------------------------------
# Horizontal split (-H) of the focused AGENT-1 pane (right column, full height).
# -s 0.667: new bottom pane = 66.7% of AGENT-1's height.
# AGENT-1 keeps top 33.3% of right column height.
# After this, WT moves focus to the new bottom pane (AGENT-2, 66.7% tall).
Write-Host "[3/4] AGENT-2 FRONTEND $frontend" -ForegroundColor Green
& wt.exe --window 0 split-pane -H -s 0.667 `
    --title 'AGENT-2 FRONTEND' `
    -d $frontend `
    pwsh.exe -NoExit -Command 'claude'

# Wait for focus to settle on AGENT-2 (the 66.7% pane).
# The next split must originate from AGENT-2, not AGENT-1.
Start-Sleep -Milliseconds $SPLIT_WAIT

# -- PANE 4: AGENT-3 INFRA -----------------------------------------------------
# Horizontal split (-H) of the focused AGENT-2 pane (66.7% of right col).
# -s 0.5: new bottom pane = 50% of 66.7% = 33.3% of right column height.
# AGENT-2 keeps 33.3% of right column height.
# Final right column: AGENT-1=33.3%, AGENT-2=33.3%, AGENT-3=33.3%.
Write-Host "[4/4] AGENT-3 INFRA    $infra" -ForegroundColor Green
& wt.exe --window 0 split-pane -H -s 0.5 `
    --title 'AGENT-3 INFRA' `
    -d $infra `
    pwsh.exe -NoExit -Command 'claude'

# -- Done ----------------------------------------------------------------------
Write-Host ""
Write-Host "Workspace ready. 4 panes active." -ForegroundColor Cyan
Write-Host ""
Write-Host "  MASTER           $root" -ForegroundColor White
Write-Host "  AGENT-1 BACKEND  $backend" -ForegroundColor White
Write-Host "  AGENT-2 FRONTEND $frontend" -ForegroundColor White
Write-Host "  AGENT-3 INFRA    $infra" -ForegroundColor White
Write-Host ""
Write-Host "Tip: to re-launch, close this pane and re-run the script." -ForegroundColor DarkGray
