<h1 align="center">QuotaPin for Codex</h1>

<p align="center">
  <strong>メニューを開かず、Codex の残量を確認。</strong><br>
  QuotaPin は残りのパーセントを、いつものアカウント欄に追加します。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img alt="Windows 11 で確認済み" src="https://img.shields.io/badge/Windows_11-確認済み-111827?style=flat-square">
  <img alt="macOS CI 検証済み" src="https://img.shields.io/badge/macOS-CI_検証済み-111827?style=flat-square">
  <img alt="データはローカルのみ" src="https://img.shields.io/badge/データ-ローカルのみ-10b981?style=flat-square">
  <img alt="MIT ライセンス" src="https://img.shields.io/badge/ライセンス-MIT-6366f1?style=flat-square">
  <a href="https://github.com/WSL043/QuotaPin-for-Codex/releases/latest"><img alt="最新リリース" src="https://img.shields.io/github/v/release/WSL043/QuotaPin-for-Codex?display_name=tag&sort=semver&style=flat-square"></a>
  <a href="https://github.com/WSL043/QuotaPin-for-Codex/actions/workflows/check.yml"><img alt="CI ステータス" src="https://img.shields.io/github/actions/workflow/status/WSL043/QuotaPin-for-Codex/check.yml?branch=main&style=flat-square&label=CI"></a>
</p>

<p align="center">
  <img src="assets/screenshots/product-ja.png" width="960" alt="アカウントメニューを開かず、Codex のアカウント欄に残り1パーセントを表示する QuotaPin">
</p>

**最新安定版：v1.1.0。** Windows は実機確認済み。macOS パッケージは CI 検証済みで、サインイン済み実機での受け入れ確認を待っています。

| プラットフォーム | 現在の状態 |
|---|---|
| Windows 11 x64 | ✅ 安定 / 確認済み |
| Windows 10 x64（2004 以降） | ⚠️ ベストエフォート |
| Windows ARM64 | ❌ 未対応 |
| macOS Apple シリコン / Intel | 🧪 公開パッケージ / CI 検証済み |

## クイックスタート

**Windows — PowerShell**

```powershell
irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1 | iex
```

**macOS — ターミナル**

```bash
curl -fsSL https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install-macos.sh | bash
```

どちらも最新の安定版をインストールします。あとは、いつものアイコンから Codex を起動します。すでに動いている Codex は終了せず、QuotaPin は次回の通常起動を待ちます。過去版、プレリリース、ロールバックを指定する場合は、[設定ガイド](docs/configuration.md#updates-and-recovery-versions)の完全なコマンドを使用します。

通常のインストーラーなら、[最新の安定版](https://github.com/WSL043/QuotaPin-for-Codex/releases/latest)を開きます。Windows はバージョン付きの `.exe` を実行。macOS は Universal `.dmg` を開き、**QuotaPin Installer** をダブルクリックします。

どちらも同じプラットフォーム用パッケージを使います。PowerShell はトレイアイコンのない静かな watcher 構成、Windows EXE の案内付きセットアップはトレイ機能を有効にします。ブートストラップは変更不能な GitHub Release を解決し、GitHub の SHA-256 ダイジェストとパッケージ識別情報を確認してから、管理者権限なしでユーザー単位にインストールします。詳しくは[セキュリティ](SECURITY.md)をご覧ください。

<details>
<summary>ブートストラップ自体も v1.1.0 に固定する</summary>

```powershell
irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/v1.1.0/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/v1.1.0/install-macos.sh | bash
```

</details>

> [!IMPORTANT]
> QuotaPin は非公式のコミュニティプロジェクトです。OpenAI との提携、承認、サポート関係はありません。

## クリックをひとつ減らして、集中を守る

短押しは通常の Codex アカウントメニュー、長押しは QuotaPin。もう一度押すか、パネルの外をクリックすると閉じます。ヘルプボタン、アバター、アカウント名はそのままです。

<details>
<summary>動作要件と初回起動</summary>

- **確認済み：** x64 版 Windows 11 と、サインイン済みの Codex Desktop。
- **ベストエフォート：** x64 版 Windows 10 バージョン 2004（ビルド 19041）以降。Windows ARM64 は未対応です。
- **権限：** 現在のユーザーだけにインストールされ、管理者権限は不要です。
- **実行中の作業：** インストールと更新は Codex を終了・再起動しません。安全に接続できない場合は、次回の通常起動を待ちます。

リポジトリを取得済みの場合は、`Restricted` 実行ポリシーでも次のコマンドを利用できます：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

再インストールや更新でも、保存した表示設定は残ります。バージョン指定、ロールバック、設定の復旧は[設定ガイド](docs/configuration.md)をご覧ください。

</details>

## 最初はシンプル、必要なら細かく

初期状態では Codex 標準のアバターと名前を残し、パーセントだけを追加します。

<p align="center">
  <img src="assets/screenshots/states-ja.png" width="900" alt="QuotaPin の通常、注意、危険の3段階と、任意の残量ライン">
  <br><sub>初期値は 30% で注意、10% で危険。しきい値は変更できます。</sub>
</p>

<p align="center">
  <img src="assets/screenshots/examples-ja.png" width="900" alt="カウントダウン、ステータスのみ、並べ替えを含む QuotaPin の6つの表示例">
</p>

パーセント、ステータスドット、残量ライン、残り時間、秒単位カウントダウン、リセット日、リセット時刻は個別に表示・非表示・並べ替えができます。任意のトークンモジュールでは、この端末の本日分とアカウントの累計を表示できます。ホバーには正確な値と、本日分が端末単位であることも表示されます。コンパクト表示（`4d 8h`）は3言語共通で、日本語表示（`4日8時間`）は別のモジュールとして選べます。

<p align="center">
  <img src="assets/screenshots/drag-layout.gif" width="405" alt="QuotaPin のモジュールを左、右、中央へ動かすと、周りの項目が場所を空ける様子">
  <br><sub>左・右・中央へ。周りの項目が自然に場所を空けます。</sub>
</p>

- **かんたん：** 利用枠の期間、表示する項目、並びを決めます。
- **カスタマイズ：** 色、しきい値、ホバー内容、アバター形状、明暗、動きを調整します。
- **コード：** 検証済みの設定項目をすべて扱えます。崩れてもリセットできます。

よく使う組み合わせは、名前付きビューとして保存・切り替えできます。

## 読むのは残量だけです

QuotaPin が読むのは、この端末の Codex が返す残り使用量だけです。タスク内容、プロンプト、Cookie、アカウント情報は読み取らず、利用状況を外部へ送信しません。アカウント欄をひとつに特定できない場合は何も表示せず、Codex 公式パッケージも変更しません。

詳細：[設定](docs/configuration.md) · [セキュリティ](SECURITY.md) · [プライバシー](PRIVACY.md) · [構成](docs/architecture.md) · [確認済み互換性](docs/compatibility.md)

更新の確認は1日最大1回。確認なしでインストールすることも、Codex を再起動することもありません。その場で安全に接続できない場合、新版は次回の通常起動から有効になります。

## macOS 版

Universal DMG には Apple シリコン版と Intel 版が含まれ、ユーザー単位でインストールされます。`sudo`、Homebrew、別途ランタイムは不要です。GitHub Actions では macOS 15 と macOS 26 のネイティブ runner を使い、最終 DMG のインストール、更新、LaunchAgent 起動、設定保持、アンインストールまで確認します。現在の Codex のアカウント欄と Gatekeeper については、ログイン済みの実機確認がまだ必要です。実装範囲と確認項目は [macOS ガイド](docs/macos.md)を参照してください。結果は[匿名化した互換性レポート](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=macos-compatibility.yml)から共有できます。

## アイデアとコントリビューション

まず[既存のアイデアを検索](https://github.com/WSL043/QuotaPin-for-Codex/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc)し、同じ案には 👍 を。なければ[新しいアイデアを投稿](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=feature.yml)できます。コードを送る前に [CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

## アンインストール

Windows では **スタート > QuotaPin > Uninstall QuotaPin** を開くか、次を実行します：

```powershell
& "$env:LOCALAPPDATA\QuotaPin\unins000.exe"
```

macOS：

```bash
"$HOME/Library/Application Support/QuotaPin/uninstall.sh"
```

QuotaPin が削除するのは、自身のファイルとショートカットだけです。Codex はそのまま残ります。
