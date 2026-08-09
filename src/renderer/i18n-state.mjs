export function createI18nToolkit() {
  function parseVersion(value) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(String(value ?? ""));
    if (!match) return null;
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] };
  }

  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;
    for (let index = 0; index < a.core.length; index += 1) {
      if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
    }
    if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
    const length = Math.max(a.pre.length, b.pre.length);
    for (let index = 0; index < length; index += 1) {
      const l = a.pre[index];
      const r = b.pre[index];
      if (l === undefined || r === undefined) return l === r ? 0 : l === undefined ? -1 : 1;
      if (l === r) continue;
      const ln = /^\d+$/.test(l) ? Number(l) : null;
      const rn = /^\d+$/.test(r) ? Number(r) : null;
      if (ln !== null || rn !== null) {
        if (ln === null || rn === null) return ln === null ? 1 : -1;
        return ln < rn ? -1 : 1;
      }
      return l < r ? -1 : 1;
    }
    return 0;
  }

  function updateIntent(currentVersion, selectedVersion) {
    const comparison = compareVersions(selectedVersion, currentVersion);
    return comparison === 1 ? "update" : comparison === -1 ? "rollback" : comparison === 0 ? "repair" : "unknown";
  }

  const selectOptions = {
    window: [["auto", "All returned"], ["shortest", "Shortest"], ["longest", "Longest"]],
    identity: [["show", "Show identity"], ["hideName", "Hide name"], ["hideAvatar", "Hide avatar"], ["quotaOnly", "Quota only"]],
    avatarShape: [["native", "Codex default"], ["rounded", "Rounded square"], ["square", "Square"]],
    accountRowMode: [["legacy", "Legacy"], ["beta", "Beta"]],
    valueColor: [["severity", "By quota"], ["accent", "Accent"], ["muted", "Muted"], ["custom", "Custom"]],
    dotColor: [["severity", "By quota"], ["match", "Match value"], ["accent", "Accent"], ["muted", "Muted"], ["custom", "Custom"]],
    identityColor: [["inherit", "Inherit"], ["severity", "By quota"], ["match", "Match value"], ["accent", "Accent"], ["muted", "Muted"], ["custom", "Custom"]],
    effect: [["none", "None"], ["pulse", "Pulse"], ["blink", "Blink"], ["rainbow", "Rainbow"]],
    effectTarget: [["dot", "Dot"], ["value", "Value"], ["both", "Both"]],
    effectAt: [["always", "Always"], ["warning", "Warning"], ["critical", "Critical"]],
    overdriveEffect: ["menuFire"],
  };
  const translations = {
    "zh-CN": {
      "All returned": "全部窗口", "Shortest": "最短窗口", "Longest": "最长窗口",
      "Show identity": "显示身份", "Hide name": "隐藏名称", "Hide avatar": "隐藏头像", "Quota only": "仅额度",
      "By quota": "随额度", "Accent": "强调色", "Muted": "弱化色", "Custom": "自定义", "Match value": "跟随数字", "Inherit": "跟随 Codex",
      "None": "无", "Pulse": "呼吸", "Blink": "闪烁", "Rainbow": "彩虹", "Dot": "圆点", "Value": "数字", "Both": "两者", "Always": "始终",
      "Warning": "提醒", "Critical": "危险", "Saved views, not fixed presets": "保存搭配，不限预设",
      "Quick": "快速", "Customize": "自定义", "Badge": "额度标记", "Place": "位置", "Account": "账号", "Composition": "组合", "Color": "颜色", "Motion": "动态", "Current view": "当前搭配",
      "Percentage": "百分比", "Countdown": "剩余时间", "Seconds": "秒级倒计时", "Date": "日期", "Reset": "重置时间", "Show value": "显示数字", "Show status dot": "状态圆点", "Show quota bar": "额度线", "Show window label": "窗口标记", "Show countdown": "显示剩余时间", "Show compact countdown": "显示紧凑时间（d / h）", "Show local countdown": "显示中文时间", "4 days 8 hours": "4天8小时", "Show seconds": "显示秒级倒计时", "Show reset date": "显示重置日期", "Show reset time": "显示重置时间", "Show today's tokens": "今日 token", "Show lifetime tokens": "累计 token",
      "Avatar": "头像", "Name": "用户名", "Avatar shape": "头像形状", "Codex default": "Codex 默认", "Rounded square": "圆角方形", "Square": "方形", "Auto": "自动", "Free": "自由", "Quiet": "弱化", "Calm": "安静", "Low-key": "低调", "Loud": "醒目", "Off": "关闭",
      "Done": "完成", "Copy": "复制", "Delete": "删除", "Manage": "管理", "Duplicate this view": "复制当前搭配", "Delete this view": "删除当前搭配", "View actions": "搭配操作",
      "Content": "内容", "Look": "外观", "Layout": "布局", "Style": "外观", "Behavior": "行为", "Details": "细节", "Colors": "颜色", "Alerts": "提醒", "Visual": "界面", "Editor": "编辑", "Code": "代码", "View name": "搭配名称", "Template": "显示格式",
      "Hover text": "悬浮信息", "Empty disables hover text": "留空即关闭悬浮信息", "Quota window": "额度窗口", "Usage window": "额度周期",
      "Identity": "身份信息", "Value color": "数字颜色", "Dot color": "圆点颜色", "Name color": "用户名颜色",
      "Badge size": "额度字号", "Quota": "额度", "Account row": "账户栏", "Account row mode": "账户栏模式", "Legacy": "Legacy", "Beta": "Beta", "Applies to every saved view.": "对所有已保存搭配生效。", "Beta hides Help and gives short/hold gestures the whole footer.": "Beta 会隐藏问号，并让整段底栏都能识别短按与长按。", "Order": "顺序", "Visible modules": "可见模块", "Click to show or hide. Drag the live row below to arrange.": "点击显示或隐藏；拖动下方真实账户栏调整顺序。", "Drag modules to arrange the account row": "拖动模块调整账户栏顺序", "Drag modules with alignment guides": "拖到边缘、中线或附近模块即可对齐", "Drag modules to place them freely": "拖动模块自由定位", "Drop anywhere · Collisions make room": "落在任意位置 · 重叠时自动让位", "Precise placement · Collisions make room": "精确落点 · 重叠时自动让位", "Drop anywhere · Aligns near edges or modules": "自由落点 · 靠近边缘或模块时自动对齐", "Magnetic alignment · Left, center, right, or nearby modules": "磁性对齐 · 左、中、右或附近模块",
      "This sidebar is too narrow for every selected module. Widen it or hide a module.": "当前侧栏放不下全部模块，请加宽侧栏或隐藏一个模块。",
      "Attention": "提醒效果", "Animate": "作用对象", "Start at": "触发级别", "Choose an attention effect first.": "请先选择提醒效果。",
      "Starting points": "配置起点", "Glance": "一眼看清", "Reset time": "重置时间", "View": "搭配", "Minimal": "极简", "Deadline": "倒计时", "Signal": "状态灯",
      "Configuration JSON": "配置 JSON", "Configuration reference": "参数参考", "Apply JSON": "应用 JSON", "Invalid JSON": "JSON 格式无效", "Applied": "已应用", "Applied with adjustments": "已应用并规范化", "Format": "格式化", "Format JSON": "格式化 JSON", "Revert draft": "撤销草稿", "Draft formatted": "草稿已格式化",
      "Draft updated": "草稿已更新", "Code draft not applied": "代码草稿尚未应用", "Reset view": "重置搭配", "Restore view defaults": "恢复搭配默认值", "Reset layout": "重置布局", "Center": "居中", "Undo": "撤销", "Reset this view to defaults?": "将当前搭配恢复为默认值？",
      "Warning at": "提醒阈值", "Critical at": "危险阈值", "Severity colors": "额度状态颜色", "Normal": "正常",
      "Short click: Codex menu · Hold: QuotaPin": "短按：Codex 菜单 · 长按：QuotaPin", "Language": "语言", "Codex remaining quota": "Codex 剩余额度",
      "Panel theme": "面板主题", "Dark": "暗色", "Light": "亮色",
      "Saving": "正在保存", "Saved": "已保存", "Save failed": "保存失败", "Config recovered": "配置已恢复", "Config is read-only": "配置为只读",
      "Updates": "更新", "Close": "关闭",
      "QuotaPin settings modes": "QuotaPin 设置模式", "QuotaPin updates": "QuotaPin 更新", "Release version": "发布版本", "Current": "当前", "Selected": "已选择", "Check": "检查", "Check for updates": "检查更新", "Checking for updates": "正在检查更新…", "Checking": "检查中…", "Update available": "有新版本", "Up to date": "已是最新版", "Update": "更新", "Repair": "修复", "Roll back": "回退", "Updating to": "正在更新到", "Repairing": "正在修复", "Rolling back to": "正在回退到", "Confirm": "确认", "Cancel": "取消", "Install": "安装", "Installing": "安装中…", "Installing version": "正在安装", "Preparing update": "正在准备更新", "Downloading update": "正在下载更新", "Verifying update": "正在校验更新", "Installing update": "正在安装更新", "Reconnecting to Codex": "正在重新接入 Codex", "Try again": "重试", "Update check failed": "检查更新失败", "Last checked": "上次检查", "Last check failed. Showing the last verified result.": "本次检查失败，仍显示上次确认的结果。", "Updates are installed only when you choose them.": "只有你确认后才会安装更新。", "Install QuotaPin version": "安装 QuotaPin", "Codex stays open and your settings are kept.": "Codex 会保持打开，现有设置也会保留。", "QuotaPin could not check for updates.": "QuotaPin 暂时无法检查更新。", "Choose a supported QuotaPin release first.": "请先选择当前支持的 QuotaPin 版本。", "The QuotaPin update helper is unavailable. Run the install command once to repair it.": "更新组件不可用，请重新运行一次安装命令进行修复。", "QuotaPin could not start the update.": "QuotaPin 无法启动更新。", "QuotaPin updated successfully.": "QuotaPin 已更新。", "QuotaPin updated without restarting Codex.": "QuotaPin 已更新，Codex 无需重启。", "QuotaPin updated. The new version will join the next Codex launch.": "QuotaPin 已更新，新版本会在下次启动 Codex 时接入。", "QuotaPin updated. Attachment will retry on the next Codex launch.": "QuotaPin 已更新，将在下次启动 Codex 时重新接入。", "QuotaPin could not complete the update. Open the version menu to retry.": "QuotaPin 更新失败，请打开版本菜单重试。", "QuotaPin could not confirm the update result.": "QuotaPin 无法确认更新结果。",
    },
    ja: {
      "All returned": "すべて", "Shortest": "最短", "Longest": "最長",
      "Show identity": "アカウント表示", "Hide name": "名前を隠す", "Hide avatar": "画像を隠す", "Quota only": "残量のみ",
      "By quota": "残量に連動", "Accent": "アクセント", "Muted": "控えめ", "Custom": "カスタム", "Match value": "数値に合わせる", "Inherit": "Codex に合わせる",
      "None": "なし", "Pulse": "パルス", "Blink": "点滅", "Rainbow": "レインボー", "Dot": "ドット", "Value": "数値", "Both": "両方", "Always": "常時",
      "Warning": "警告", "Critical": "危険", "Saved views, not fixed presets": "プリセットではなく、保存ビュー",
      "Quick": "かんたん", "Customize": "カスタマイズ", "Badge": "残量表示", "Place": "位置", "Account": "アカウント", "Composition": "構成", "Color": "カラー", "Motion": "動き", "Current view": "現在のビュー",
      "Percentage": "パーセント", "Countdown": "残り時間", "Seconds": "秒カウント", "Date": "日付", "Reset": "リセット時刻", "Show value": "数値を表示", "Show status dot": "状態ドット", "Show quota bar": "残量バー", "Show window label": "期間ラベル", "Show countdown": "残り時間を表示", "Show compact countdown": "コンパクト表示（d / h）", "Show local countdown": "日本語の残り時間を表示", "4 days 8 hours": "4日8時間", "Show seconds": "秒カウントを表示", "Show reset date": "リセット日を表示", "Show reset time": "リセット時刻を表示", "Show today's tokens": "今日のトークン", "Show lifetime tokens": "累計トークン",
      "Avatar": "画像", "Name": "名前", "Avatar shape": "画像の形", "Codex default": "Codex の標準", "Rounded square": "角丸四角", "Square": "四角", "Auto": "自動", "Free": "自由", "Quiet": "控えめ", "Calm": "静か", "Low-key": "控えめ", "Loud": "目立つ", "Off": "オフ",
      "Done": "完了", "Copy": "複製", "Delete": "削除", "Manage": "管理", "Duplicate this view": "このビューを複製", "Delete this view": "このビューを削除", "View actions": "ビュー操作",
      "Content": "内容", "Look": "外観", "Layout": "レイアウト", "Style": "外観", "Behavior": "動作", "Details": "詳細", "Colors": "カラー", "Alerts": "通知", "Visual": "表示", "Editor": "編集", "Code": "コード", "View name": "ビュー名", "Template": "表示形式",
      "Hover text": "ホバー情報", "Empty disables hover text": "空欄でホバー情報を無効化", "Quota window": "上限ウィンドウ", "Usage window": "利用枠の期間",
      "Identity": "アカウント", "Value color": "数値の色", "Dot color": "ドットの色", "Name color": "ユーザー名の色",
      "Badge size": "残量の文字サイズ", "Quota": "残量", "Account row": "アカウント欄", "Account row mode": "アカウント欄モード", "Legacy": "Legacy", "Beta": "Beta", "Applies to every saved view.": "保存したすべてのビューに適用されます。", "Beta hides Help and gives short/hold gestures the whole footer.": "Beta はヘルプを隠し、フッター全体で短押しと長押しを判定します。", "Order": "並び順", "Visible modules": "表示する項目", "Click to show or hide. Drag the live row below to arrange.": "クリックで表示を切り替え、下の実際のアカウント欄をドラッグして並べ替えます。", "Drag modules to arrange the account row": "ドラッグして並び順を変更", "Drag modules with alignment guides": "端・中央・近くの項目に合わせて配置", "Drag modules to place them freely": "ドラッグして自由に配置", "Drop anywhere · Collisions make room": "好きな位置に配置 · 重なると自動で間隔を確保", "Precise placement · Collisions make room": "正確に配置 · 重なると自動で間隔を確保", "Drop anywhere · Aligns near edges or modules": "自由に配置 · 端や項目の近くで自動整列", "Magnetic alignment · Left, center, right, or nearby modules": "磁気整列 · 左・中央・右・近くの項目",
      "This sidebar is too narrow for every selected module. Widen it or hide a module.": "選んだ項目をすべて表示するには幅が足りません。サイドバーを広げるか、項目を減らしてください。",
      "Attention": "通知効果", "Animate": "対象", "Start at": "開始レベル", "Choose an attention effect first.": "先に通知効果を選んでください。",
      "Starting points": "設定の出発点", "Glance": "ひと目", "Reset time": "リセット時刻", "View": "ビュー", "Minimal": "ミニマル", "Deadline": "カウントダウン", "Signal": "ステータスライト",
      "Configuration JSON": "設定 JSON", "Configuration reference": "設定リファレンス", "Apply JSON": "JSON を適用", "Invalid JSON": "JSON が正しくありません", "Applied": "適用しました", "Applied with adjustments": "調整して適用しました", "Format": "整形", "Format JSON": "JSON を整形", "Revert draft": "下書きを破棄", "Draft formatted": "下書きを整形しました",
      "Draft updated": "下書きを更新しました", "Code draft not applied": "コードの下書きは未適用です", "Reset view": "ビューをリセット", "Restore view defaults": "ビューを初期設定に戻す", "Reset layout": "配置をリセット", "Center": "中央", "Undo": "元に戻す", "Reset this view to defaults?": "このビューを初期設定に戻しますか？",
      "Warning at": "警告しきい値", "Critical at": "危険しきい値", "Severity colors": "残量ステータス色", "Normal": "通常",
      "Short click: Codex menu · Hold: QuotaPin": "短押し：Codex メニュー · 長押し：QuotaPin", "Language": "言語", "Codex remaining quota": "Codex の残り使用量",
      "Panel theme": "パネルテーマ", "Dark": "ダーク", "Light": "ライト",
      "Saving": "保存中", "Saved": "保存しました", "Save failed": "保存できませんでした", "Config recovered": "設定を復元しました", "Config is read-only": "設定は読み取り専用です",
      "Updates": "アップデート", "Close": "閉じる",
      "QuotaPin settings modes": "QuotaPin の設定モード", "QuotaPin updates": "QuotaPin の更新", "Release version": "リリース版", "Current": "現在", "Selected": "選択中", "Check": "確認", "Check for updates": "更新を確認", "Checking for updates": "更新を確認しています…", "Checking": "確認中…", "Update available": "新しいバージョンがあります", "Up to date": "最新版です", "Update": "更新", "Repair": "修復", "Roll back": "元に戻す", "Updating to": "更新中", "Repairing": "修復中", "Rolling back to": "戻しています", "Confirm": "確認", "Cancel": "キャンセル", "Install": "インストール", "Installing": "インストール中…", "Installing version": "インストール中", "Preparing update": "更新を準備しています", "Downloading update": "更新をダウンロードしています", "Verifying update": "更新を検証しています", "Installing update": "更新をインストールしています", "Reconnecting to Codex": "Codex に再接続しています", "Try again": "再試行", "Update check failed": "更新を確認できませんでした", "Last checked": "前回の確認", "Last check failed. Showing the last verified result.": "今回の確認に失敗したため、前回確認済みの結果を表示しています。", "Updates are installed only when you choose them.": "選択して確認した場合のみ更新します。", "Install QuotaPin version": "QuotaPin をインストール", "Codex stays open and your settings are kept.": "Codex は開いたままで、設定も保持されます。", "QuotaPin could not check for updates.": "QuotaPin の更新を確認できませんでした。", "Choose a supported QuotaPin release first.": "現在サポートされている QuotaPin リリースを選択してください。", "The QuotaPin update helper is unavailable. Run the install command once to repair it.": "更新コンポーネントが見つかりません。インストールコマンドをもう一度実行して修復してください。", "QuotaPin could not start the update.": "QuotaPin の更新を開始できませんでした。", "QuotaPin updated successfully.": "QuotaPin を更新しました。", "QuotaPin updated without restarting Codex.": "Codex を再起動せずに QuotaPin を更新しました。", "QuotaPin updated. The new version will join the next Codex launch.": "QuotaPin を更新しました。新しいバージョンは次回の Codex 起動時に接続します。", "QuotaPin updated. Attachment will retry on the next Codex launch.": "QuotaPin を更新しました。次回 Codex 起動時に再接続します。", "QuotaPin could not complete the update. Open the version menu to retry.": "QuotaPin を更新できませんでした。バージョンメニューから再試行してください。", "QuotaPin could not confirm the update result.": "QuotaPin の更新結果を確認できませんでした。",
    },
  };
  return {
    selectOptions,
    updateIntent,
    translate(locale, text) {
      return translations[locale]?.[text] ?? text;
    },
  };
}
