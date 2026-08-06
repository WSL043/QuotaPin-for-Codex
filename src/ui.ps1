$script:QuotaPinUiLanguage = $null

function Get-QuotaPinUiLanguage {
    if ($script:QuotaPinUiLanguage) { return $script:QuotaPinUiLanguage }
    $Name = [Globalization.CultureInfo]::CurrentUICulture.Name
    if ($Name.StartsWith('zh', [StringComparison]::OrdinalIgnoreCase)) {
        $script:QuotaPinUiLanguage = 'zh-CN'
    }
    elseif ($Name.StartsWith('ja', [StringComparison]::OrdinalIgnoreCase)) {
        $script:QuotaPinUiLanguage = 'ja'
    }
    else {
        $script:QuotaPinUiLanguage = 'en'
    }
    $script:QuotaPinUiLanguage
}

function Get-QuotaPinUiText([string]$Key) {
    $Strings = @{
        en = @{
            ReadyTitle = 'QuotaPin is ready'
            ReadyBody = 'This Codex window was already open when QuotaPin started. You can keep working; QuotaPin will appear after the next restart.'
            RestartWarning = 'Restarting now closes every Codex window and may interrupt running tasks.'
            Later = 'Later'
            RestartNow = 'Restart Codex now…'
            RestartConfirmTitle = 'Restart Codex?'
            RestartConfirmBody = 'All Codex windows will close now. Running tasks may stop and unsent input may be lost. Continue?'
            ConnectingTitle = 'Opening QuotaPin settings'
            ConnectingBody = 'Connecting to Codex and preparing the settings panel…'
            ConnectingHint = 'If Codex is already open, keep it open. QuotaPin will ask before any restart.'
            Cancel = 'Cancel'
            Incomplete = 'QuotaPin is incomplete. Reinstall it, then try again.'
            LauncherMissing = 'QuotaPin could not find its launcher. Reinstall it, then try again.'
            SettingsUnavailable = 'QuotaPin could not open settings yet. Keep Codex open until the account row appears, then choose Open settings again. If it still does not open, fully quit and reopen Codex.'
            ConnectionMissing = 'QuotaPin connected to Codex but could not locate its local settings connection. Fully quit and reopen Codex, then try again.'
            SettingsNoResponse = 'QuotaPin settings did not respond. Keep Codex open and try once more; if the problem continues, fully quit and reopen Codex.'
        }
        'zh-CN' = @{
            ReadyTitle = 'QuotaPin 已准备好'
            ReadyBody = 'QuotaPin 启动时，这个 Codex 窗口已经处于打开状态。你可以继续工作；下次重新打开 Codex 后，额度显示会自动出现。'
            RestartWarning = '现在重启会关闭所有 Codex 窗口，并可能中断正在运行的任务。'
            Later = '稍后'
            RestartNow = '现在自动重启…'
            RestartConfirmTitle = '确定重启 Codex？'
            RestartConfirmBody = '所有 Codex 窗口都会立即关闭。正在运行的任务可能中断，尚未发送的输入可能丢失。是否继续？'
            ConnectingTitle = '正在打开 QuotaPin 设置'
            ConnectingBody = '正在连接 Codex 并准备设置面板…'
            ConnectingHint = '如果 Codex 已经打开，请保持原样。需要重启时，QuotaPin 会先征求你的确认。'
            Cancel = '取消'
            Incomplete = 'QuotaPin 安装不完整。请重新安装后再试。'
            LauncherMissing = 'QuotaPin 找不到启动组件。请重新安装后再试。'
            SettingsUnavailable = '暂时无法打开 QuotaPin 设置。请保持 Codex 打开，等账户栏出现后再次选择“打开设置”。如果仍然无法打开，请完全退出并重新打开 Codex。'
            ConnectionMissing = 'QuotaPin 已连接 Codex，但找不到本地设置连接。请完全退出并重新打开 Codex，然后再试。'
            SettingsNoResponse = 'QuotaPin 设置没有响应。请保持 Codex 打开并再试一次；如果问题仍然存在，请完全退出并重新打开 Codex。'
        }
        ja = @{
            ReadyTitle = 'QuotaPin の準備ができました'
            ReadyBody = 'QuotaPin の起動前からこの Codex ウィンドウが開いていました。作業はそのまま続けられます。次回 Codex を起動し直すと、残量表示が自動で有効になります。'
            RestartWarning = '今すぐ再起動すると、すべての Codex ウィンドウが閉じ、実行中のタスクが中断される場合があります。'
            Later = '後で'
            RestartNow = 'Codex を今すぐ再起動…'
            RestartConfirmTitle = 'Codex を再起動しますか？'
            RestartConfirmBody = 'すべての Codex ウィンドウが閉じます。実行中のタスクが中断され、未送信の入力が失われる場合があります。続行しますか？'
            ConnectingTitle = 'QuotaPin の設定を開いています'
            ConnectingBody = 'Codex に接続し、設定パネルを準備しています…'
            ConnectingHint = 'Codex がすでに開いている場合は、そのままにしてください。再起動が必要なときは、QuotaPin が先に確認します。'
            Cancel = 'キャンセル'
            Incomplete = 'QuotaPin のインストールが不完全です。再インストールしてから、もう一度お試しください。'
            LauncherMissing = 'QuotaPin の起動コンポーネントが見つかりません。再インストールしてから、もう一度お試しください。'
            SettingsUnavailable = 'QuotaPin の設定をまだ開けません。Codex を開いたまま、アカウント欄が表示されてからもう一度「設定を開く」を選んでください。それでも開かない場合は、Codex を完全に終了して開き直してください。'
            ConnectionMissing = 'Codex には接続しましたが、ローカルの設定接続が見つかりません。Codex を完全に終了して開き直してから、もう一度お試しください。'
            SettingsNoResponse = 'QuotaPin の設定が応答しませんでした。Codex を開いたままもう一度お試しください。解決しない場合は、Codex を完全に終了して開き直してください。'
        }
    }
    $Language = Get-QuotaPinUiLanguage
    $Text = $Strings[$Language][$Key]
    if (-not $Text) { $Text = $Strings.en[$Key] }
    [string]$Text
}

function Initialize-QuotaPinForms {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
}

function Show-QuotaPinInformation([string]$MessageKey) {
    Initialize-QuotaPinForms
    [void][System.Windows.Forms.MessageBox]::Show(
        (Get-QuotaPinUiText $MessageKey),
        'QuotaPin',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    )
}

function New-QuotaPinRelaunchForm([string]$IconPath) {
    Initialize-QuotaPinForms

    $Form = New-Object System.Windows.Forms.Form
    $Form.Name = 'quotapin-relaunch'
    $Form.Text = 'QuotaPin'
    $Form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    $Form.AutoSize = $true
    $Form.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $Form.MinimumSize = New-Object System.Drawing.Size(460, 0)
    $Form.MaximumSize = New-Object System.Drawing.Size(660, 0)
    $Form.Padding = New-Object System.Windows.Forms.Padding(22)
    $Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $Form.MaximizeBox = $false
    $Form.MinimizeBox = $false
    $Form.ShowInTaskbar = $true
    $Form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $Form.TopMost = $true
    $Form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
        try { $Form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($IconPath) } catch {}
    }

    $Layout = New-Object System.Windows.Forms.TableLayoutPanel
    $Layout.Name = 'quotapin-relaunch-layout'
    $Layout.AutoSize = $true
    $Layout.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $Layout.ColumnCount = 1
    $Layout.RowCount = 4
    $Layout.Dock = [System.Windows.Forms.DockStyle]::Fill
    $Layout.Margin = New-Object System.Windows.Forms.Padding(0)
    [void]$Layout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))

    $ContentWidth = 560

    $Heading = New-Object System.Windows.Forms.Label
    $Heading.AutoSize = $true
    $Heading.MaximumSize = New-Object System.Drawing.Size($ContentWidth, 0)
    $Heading.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)
    $Heading.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12)
    $Heading.Text = Get-QuotaPinUiText 'ReadyTitle'

    $Body = New-Object System.Windows.Forms.Label
    $Body.AutoSize = $true
    $Body.MaximumSize = New-Object System.Drawing.Size($ContentWidth, 0)
    $Body.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 12)
    $Body.Text = Get-QuotaPinUiText 'ReadyBody'

    $Warning = New-Object System.Windows.Forms.Label
    $Warning.AutoSize = $true
    $Warning.MaximumSize = New-Object System.Drawing.Size($ContentWidth, 0)
    $Warning.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 16)
    $Warning.ForeColor = [System.Drawing.Color]::FromArgb(112, 72, 0)
    $Warning.Text = Get-QuotaPinUiText 'RestartWarning'

    $ButtonRow = New-Object System.Windows.Forms.FlowLayoutPanel
    $ButtonRow.Name = 'quotapin-relaunch-actions'
    $ButtonRow.AutoSize = $true
    $ButtonRow.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $ButtonRow.Dock = [System.Windows.Forms.DockStyle]::Fill
    $ButtonRow.FlowDirection = [System.Windows.Forms.FlowDirection]::RightToLeft
    $ButtonRow.WrapContents = $false
    $ButtonRow.Margin = New-Object System.Windows.Forms.Padding(0)

    $Later = New-Object System.Windows.Forms.Button
    $Later.Name = 'quotapin-later'
    $Later.AutoSize = $true
    $Later.MinimumSize = New-Object System.Drawing.Size(92, 32)
    $Later.Margin = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
    $Later.Text = Get-QuotaPinUiText 'Later'
    $Later.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $Restart = New-Object System.Windows.Forms.Button
    $Restart.Name = 'quotapin-restart'
    $Restart.AutoSize = $true
    $Restart.MinimumSize = New-Object System.Drawing.Size(108, 32)
    $Restart.Margin = New-Object System.Windows.Forms.Padding(0)
    $Restart.Text = Get-QuotaPinUiText 'RestartNow'
    $Restart.DialogResult = [System.Windows.Forms.DialogResult]::Yes

    [void]$ButtonRow.Controls.Add($Restart)
    [void]$ButtonRow.Controls.Add($Later)
    [void]$Layout.Controls.Add($Heading, 0, 0)
    [void]$Layout.Controls.Add($Body, 0, 1)
    [void]$Layout.Controls.Add($Warning, 0, 2)
    [void]$Layout.Controls.Add($ButtonRow, 0, 3)
    $Form.AcceptButton = $Later
    $Form.CancelButton = $Later
    [void]$Form.Controls.Add($Layout)
    $Form.Add_Shown({
        $DefaultButton = $this.Controls.Find('quotapin-later', $true) | Select-Object -First 1
        if ($DefaultButton) { $DefaultButton.Focus() }
    })
    $Form
}

function New-QuotaPinConnectingForm([string]$IconPath) {
    Initialize-QuotaPinForms

    $Form = New-Object System.Windows.Forms.Form
    $Form.Name = 'quotapin-connecting'
    $Form.Text = 'QuotaPin'
    $Form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    $Form.AutoSize = $true
    $Form.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $Form.MinimumSize = New-Object System.Drawing.Size(430, 0)
    $Form.MaximumSize = New-Object System.Drawing.Size(620, 0)
    $Form.Padding = New-Object System.Windows.Forms.Padding(20)
    $Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $Form.MaximizeBox = $false
    $Form.MinimizeBox = $false
    $Form.ShowInTaskbar = $true
    $Form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $Form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $Form.Tag = 'waiting'
    if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
        try { $Form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($IconPath) } catch {}
    }

    $Layout = New-Object System.Windows.Forms.TableLayoutPanel
    $Layout.Name = 'quotapin-connecting-layout'
    $Layout.AutoSize = $true
    $Layout.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $Layout.ColumnCount = 1
    $Layout.RowCount = 5
    $Layout.Dock = [System.Windows.Forms.DockStyle]::Fill
    $Layout.Margin = New-Object System.Windows.Forms.Padding(0)
    [void]$Layout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100)))

    $ContentWidth = 520
    $Heading = New-Object System.Windows.Forms.Label
    $Heading.Name = 'quotapin-connecting-title'
    $Heading.AutoSize = $true
    $Heading.MaximumSize = New-Object System.Drawing.Size($ContentWidth, 0)
    $Heading.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 9)
    $Heading.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
    $Heading.Text = Get-QuotaPinUiText 'ConnectingTitle'

    $Body = New-Object System.Windows.Forms.Label
    $Body.Name = 'quotapin-connecting-body'
    $Body.AutoSize = $true
    $Body.MaximumSize = New-Object System.Drawing.Size($ContentWidth, 0)
    $Body.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 12)
    $Body.Text = Get-QuotaPinUiText 'ConnectingBody'

    $Progress = New-Object System.Windows.Forms.ProgressBar
    $Progress.Name = 'quotapin-connecting-progress'
    $Progress.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
    $Progress.MarqueeAnimationSpeed = 24
    $Progress.Dock = [System.Windows.Forms.DockStyle]::Fill
    $Progress.Height = 7
    $Progress.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)

    $Hint = New-Object System.Windows.Forms.Label
    $Hint.Name = 'quotapin-connecting-hint'
    $Hint.AutoSize = $true
    $Hint.MaximumSize = New-Object System.Drawing.Size($ContentWidth, 0)
    $Hint.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 14)
    $Hint.ForeColor = [System.Drawing.SystemColors]::GrayText
    $Hint.Text = Get-QuotaPinUiText 'ConnectingHint'

    $Actions = New-Object System.Windows.Forms.FlowLayoutPanel
    $Actions.AutoSize = $true
    $Actions.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $Actions.Dock = [System.Windows.Forms.DockStyle]::Fill
    $Actions.FlowDirection = [System.Windows.Forms.FlowDirection]::RightToLeft
    $Actions.WrapContents = $false
    $Actions.Margin = New-Object System.Windows.Forms.Padding(0)

    $Cancel = New-Object System.Windows.Forms.Button
    $Cancel.Name = 'quotapin-connecting-cancel'
    $Cancel.AutoSize = $true
    $Cancel.MinimumSize = New-Object System.Drawing.Size(92, 32)
    $Cancel.Margin = New-Object System.Windows.Forms.Padding(0)
    $Cancel.Text = Get-QuotaPinUiText 'Cancel'
    $Cancel.Add_Click({
        $Owner = $this.FindForm()
        if ($Owner) {
            $Owner.Tag = 'cancelled'
            $Owner.Close()
        }
    })

    [void]$Actions.Controls.Add($Cancel)
    [void]$Layout.Controls.Add($Heading, 0, 0)
    [void]$Layout.Controls.Add($Body, 0, 1)
    [void]$Layout.Controls.Add($Progress, 0, 2)
    [void]$Layout.Controls.Add($Hint, 0, 3)
    [void]$Layout.Controls.Add($Actions, 0, 4)
    [void]$Form.Controls.Add($Layout)
    $Form.CancelButton = $Cancel
    $Form.Add_FormClosing({
        if ($this.Tag -eq 'waiting') { $this.Tag = 'cancelled' }
    })
    Write-Output -NoEnumerate $Form
}

function Show-QuotaPinConnectingForm([string]$IconPath) {
    $Form = New-QuotaPinConnectingForm -IconPath $IconPath
    $Form.Show()
    $Form.Activate()
    [System.Windows.Forms.Application]::DoEvents()
    Write-Output -NoEnumerate $Form
}

function Close-QuotaPinForm($Form) {
    if (-not $Form -or $Form.IsDisposed) { return }
    $Form.Tag = 'complete'
    $Form.Close()
    $Form.Dispose()
    [System.Windows.Forms.Application]::DoEvents()
}

function Show-QuotaPinRelaunchPrompt([string]$IconPath) {
    $Form = New-QuotaPinRelaunchForm -IconPath $IconPath
    try {
        $Result = $Form.ShowDialog()
        if ($Result -ne [System.Windows.Forms.DialogResult]::Yes) { return $false }
        $Confirmation = [System.Windows.Forms.MessageBox]::Show(
            (Get-QuotaPinUiText 'RestartConfirmBody'),
            (Get-QuotaPinUiText 'RestartConfirmTitle'),
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning,
            [System.Windows.Forms.MessageBoxDefaultButton]::Button2
        )
        return $Confirmation -eq [System.Windows.Forms.DialogResult]::Yes
    }
    finally {
        $Form.Dispose()
    }
}
